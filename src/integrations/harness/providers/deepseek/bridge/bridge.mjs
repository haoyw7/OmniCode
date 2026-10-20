/** OmniCode's DSH 0.2.1-rc.2 plugin. Loaded by DSH, never by the UI bundle. */
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { getDshRuntimeVersion } from "@deepseek-ai/dsh-app-boot";

export const name = "omnicode-bridge";
export const inject = [
  "acpAppStartup",
  "agents",
  "llm",
  "sessions",
  "sessionPersistence",
  "attachments",
  "approval",
  "permissionPresets",
  "tools",
  "userQuestions",
  "planMode",
  "sessionProjections",
  "jobs",
];
export const PROTOCOL_VERSION = 1;
export const DSH_VERSION = "0.2.1-rc.2";

const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const requiredString = (value, label) => {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value;
};
const effects = new Set(["write", "edit", "bash", "pwsh", "run_code"]);
const edits = new Set(["write", "edit"]);

/** Exported for transport tests; the DSH loader supplies a real Cordis Context. */
export function apply(ctx) {
  const version = getDshRuntimeVersion();
  if (version !== DSH_VERSION)
    throw new Error(
      `OmniCode bridge requires dsh ${DSH_VERSION}; found ${version}`,
    );
  let session;
  let opening;
  let initialized = false;
  let closing = false;
  let nextRequest = 1;
  let output = Promise.resolve();
  let controls = Promise.resolve();
  const serial = (operation) => {
    const task = controls.then(operation);
    controls = task.catch(() => {});
    return task;
  };
  const pending = new Map();
  const claims = new Map();
  const descendants = new Set();
  const emit = (method, params) => write({ jsonrpc: "2.0", method, params });
  const write = (message) => {
    const line = JSON.stringify(message) + "\n";
    output = output.then(
      () =>
        new Promise((resolve, reject) => {
          process.stdout.write(line, (error) =>
            error ? reject(error) : resolve(),
          );
        }),
    );
    // Keep a broken pipe handled while preserving failure for completion/teardown.
    output.catch(() => {});
    return output;
  };
  const owned = (agent) =>
    session && (agent === session.handle.agent || descendants.has(agent));
  const activeJobs = () =>
    !session
      ? []
      : [session.handle.agent, ...descendants].flatMap((agent) =>
          ctx.jobs
            .list(agent.session.id)
            .filter(
              (job) =>
                job.owner === agent.session.id &&
                ["running", "stopping"].includes(job.status),
            ),
        );
  const cancelJobs = () => {
    for (const job of activeJobs())
      ctx.jobs.kill(job.id, job.owner, "OmniCode turn cancelled");
  };
  // Observe without using jobs.wait(): a model waiter suppresses the native completion notice.
  const waitForJobs = (jobs) =>
    new Promise((resolve) => {
      const pendingIds = new Set(jobs.map((job) => job.id));
      const stop = ctx.jobs.events.subscribe({ owners: "all" }, (event) => {
        if (event.type !== "settled" && event.type !== "removed") return;
        pendingIds.delete(event.job.id);
        if (!pendingIds.size) {
          stop();
          resolve();
        }
      });
      for (const job of jobs) {
        try {
          if (
            !["running", "stopping"].includes(
              ctx.jobs.get(job.id, job.owner).status,
            )
          )
            pendingIds.delete(job.id);
        } catch {
          pendingIds.delete(job.id);
        }
      }
      if (!pendingIds.size) {
        stop();
        resolve();
      }
    });
  const notify = (kind, data, source = session?.handle.agent) =>
    emit("session/event", {
      sessionId: session?.handle.agent.session.id,
      sourceSessionId: source?.session.id,
      runId: session?.run?.id,
      kind,
      data,
    });
  const ask = (method, params, signal) => {
    const id = nextRequest++;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!pending.delete(id)) return;
        signal?.removeEventListener("abort", abort);
        void notify("interaction.closed", { requestId: id }).catch(() => {});
        reject(signal?.reason ?? new Error("Interaction cancelled"));
      };
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      pending.set(id, {
        resolve: (result) => {
          signal?.removeEventListener("abort", abort);
          resolve(result);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      void write({ jsonrpc: "2.0", id, method, params }).catch((error) => {
        pending.get(id)?.reject(error);
        pending.delete(id);
      });
    });
  };
  const requireSession = (params) => {
    if (
      !session ||
      session.handle.agent.session.id !== params.sessionId ||
      closing
    )
      throw new Error("Unknown or closed DeepSeek session");
    if (ctx.agents.get(session.handle.agent.id) !== session.handle.agent)
      throw new Error("DeepSeek session was disposed");
    return session;
  };
  const cancelInteractions = () => {
    for (const [id, waiter] of pending) {
      waiter.reject(new Error("Interaction cancelled"));
      void notify("interaction.closed", { requestId: id }).catch(() => {});
    }
    pending.clear();
    for (const claim of claims.values()) claim.abort();
    claims.clear();
  };
  const wait = async (rec) => {
    const agent = rec.handle.agent;
    while (true) {
      await agent.whenIdle();
      const seq = agent.session.seq;
      const children = await ctx.get("subagents")?.waitForChildren(agent);
      const jobs = activeJobs();
      if (jobs.length) await waitForJobs(jobs);
      if (
        !children &&
        !jobs.length &&
        agent.status === "idle" &&
        agent.session.seq === seq
      )
        break;
    }
    await ctx.sessions.flush(agent.session);
    await output;
  };

  ctx.on(
    "agent/created",
    ({ agent }) => {
      const parent = agent.session.header.parentSession;
      if (
        !session ||
        !parent ||
        (parent !== session.handle.agent.session.id &&
          ![...descendants].some((child) => child.session.id === parent))
      )
        return;
      descendants.add(agent);
      void notify(
        "agent.started",
        { sessionId: agent.session.id, parentSessionId: parent },
        agent,
      ).catch(() => {});
    },
    { global: true },
  );
  ctx.on(
    "agent/disposed",
    ({ agent }) => {
      if (!descendants.delete(agent)) return;
      void notify(
        "agent.finished",
        { sessionId: agent.session.id },
        agent,
      ).catch(() => {});
    },
    { global: true },
  );
  ctx.on(
    "agent/status",
    ({ agent, status }) => {
      if (descendants.has(agent))
        void notify("agent.status", { status }, agent).catch(() => {});
    },
    { global: true },
  );
  ctx.jobs.events.subscribe({ owners: "all" }, (event) => {
    if (event.type === "output" || !session) return;
    const owner = event.job.owner;
    if (
      owner !== session.handle.agent.session.id &&
      ![...descendants].some((agent) => agent.session.id === owner)
    )
      return;
    void notify("jobs", { jobs: activeJobs() }).catch(() => {});
  });
  ctx.on(
    "agent/error",
    ({ agent, error }) => {
      if (!owned(agent)) return;
      const message = error instanceof Error ? error.message : String(error);
      if (agent === session.handle.agent && session.run)
        session.run.error = message;
      else void notify("agent.error", { message }, agent).catch(() => {});
    },
    { global: true },
  );
  ctx.on(
    "agent/assistant-stream",
    ({ agent, frame }) => {
      if (owned(agent))
        void notify("assistant.stream", frame, agent).catch(() => {});
    },
    { global: true },
  );
  // Durable events remain authoritative; image bytes are sent through the attachment store.
  let durableOutput = Promise.resolve();
  ctx.on(
    "session/event",
    (source, event) => {
      const agent = ctx.agents.get(source.id);
      if (!agent || !owned(agent)) return;
      if (
        agent === session.handle.agent &&
        session.run &&
        event.type === "turn/end" &&
        event.data.reason?.kind === "error"
      ) {
        session.run.error ??=
          event.data.reason.error?.message ?? "DeepSeek Harness turn failed";
      }
      durableOutput = durableOutput
        .catch(() => {})
        .then(async () => {
          await notify("durable", event, agent);
          const blocks =
            event.type === "assistant/message" || event.type === "tool/result"
              ? (event.data.message?.content ?? [])
              : [];
          for (const [index, block] of blocks.entries()) {
            if (block.type !== "image") continue;
            const image = await ctx.attachments.readImage(block.attachment);
            await notify(
              "image",
              {
                itemId: `${source.id}:${event.seq}:${index}`,
                data: Buffer.from(image.data).toString("base64"),
                mimeType: image.ref.mediaType,
                name: image.ref.name ?? "image.png",
              },
              agent,
            );
          }
        });
      durableOutput.catch((error) => {
        if (session?.run) session.run.error = error.message;
      });
    },
    { global: true },
  );
  ctx.on(
    "approval/request",
    async (request, next) => {
      if (!owned(request.agent)) return next();
      await durableOutput;
      try {
        const answer = await ask(
          "approval/request",
          {
            sessionId: session.handle.agent.session.id,
            sourceSessionId: request.agent.session.id,
            callId: request.callId,
            toolName: request.toolName,
            reason: request.reason,
          },
          request.signal,
        );
        return answer?.decision === "allow" ? "allowed-once" : "rejected";
      } catch {
        return "cancelled";
      }
    },
    { global: true },
  );
  ctx.on(
    "user-questions/request",
    async (request, next) => {
      if (!session || request.agent !== session.handle.agent) return next();
      await durableOutput;
      const callId =
        request.wait?.callId ??
        request.questions.find((question) => question.intent?.callId)?.intent
          .callId;
      let deadline;
      let timer;
      const timeout = new AbortController();
      if (request.wait?.timed) {
        const controller = new AbortController();
        claims.set(callId, {
          abort: () => {
            clearTimeout(timer);
            controller.abort();
          },
          hold: () => clearTimeout(timer),
        });
        // Claim before rendering the countdown; the DSH service owns its duration.
        const stream = ctx.userQuestions.attachWait(
          request.agent,
          callId,
          controller.signal,
        );
        const initial = await stream.next();
        if (!initial.done) {
          deadline = Date.now() + initial.value.remainingMs;
          timer = setTimeout(() => {
            const error = new Error("Question foreground wait ended");
            error.code = "ASK_TIMED_OUT";
            error.name = "UserQuestionError";
            timeout.abort(error);
          }, initial.value.remainingMs);
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            void stream.return?.().catch(() => {});
          },
          { once: true },
        );
      }
      try {
        const answer = await ask(
          "question/request",
          {
            sessionId: session.handle.agent.session.id,
            callId,
            questions: request.questions,
            autoResolveAt: deadline,
            allowLateReply: !!request.wait?.timed,
          },
          request.signal
            ? AbortSignal.any([request.signal, timeout.signal])
            : timeout.signal,
        );
        if (answer?.timedOut) {
          const error = new Error("Question foreground wait ended");
          error.code = "ASK_TIMED_OUT";
          error.name = "UserQuestionError";
          throw error;
        }
        return {
          answers: request.questions.map((question) => ({
            id: question.id,
            selected: Array.isArray(answer?.answers?.[question.id])
              ? answer.answers[question.id]
              : [],
            ...(typeof answer?.custom?.[question.id] === "string"
              ? { custom: answer.custom[question.id] }
              : {}),
          })),
        };
      } finally {
        clearTimeout(timer);
        claims.get(callId)?.abort();
        claims.delete(callId);
      }
    },
    { global: true },
  );

  // Add application mode prompts without bypassing sandbox/plan/monotonic guards.
  ctx.on(
    "tools/pre-execute",
    async (exec, next) => {
      const decision = await next();
      if (!owned(exec.agent) || decision.kind !== "allow") return decision;
      const mode = session.mode;
      const mutating =
        effects.has(exec.name) ||
        ![
          "read",
          "read_image",
          "glob",
          "grep",
          "web_search",
          "web_fetch",
          "todo_write",
          "ask_user_question",
          "exit_plan_mode",
          "job_list",
          "job_output",
        ].includes(exec.name);
      if (
        (mode === "supervised" && mutating) ||
        (mode === "auto-accept-edits" && mutating && !edits.has(exec.name))
      ) {
        return {
          kind: "ask",
          reason: "OmniCode execution mode requires approval for this action.",
        };
      }
      return decision;
    },
    { global: true },
  );

  async function catalog() {
    const groups = await Promise.all(
      ctx.llm.listProviders().map(async (provider) => {
        try {
          const listed = await ctx.llm.listModels(provider.id);
          const models = await Promise.all(
            listed.map(async (model) => ({
              ...model,
              ...(await ctx.llm.resolveModelInfo(provider.id, model.id)),
            })),
          );
          return { id: provider.id, name: provider.name, models };
        } catch {
          return { id: provider.id, name: provider.name, models: [] };
        }
      }),
    );
    return groups.filter((group) => group.models.length);
  }
  async function configure(rec, params) {
    if (rec.run)
      throw new Error(
        "Wait for the active run before changing DeepSeek configuration",
      );
    const selected = params.selection ?? rec.selection.current;
    const config = await ctx.llm.resolveCallConfig(selected);
    rec.selection.current = {
      provider: config.provider,
      model: config.model,
      ...(config.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: config.reasoningEffort }),
    };
    const mode = params.runtimeMode ?? rec.mode;
    if (
      !["supervised", "auto-accept-edits", "auto", "full-access"].includes(mode)
    )
      throw new Error("Unsupported OmniCode execution mode");
    // Native Auto is explicitly selected only for the application's AI-review mode.
    ctx.permissionPresets.set(
      rec.handle.agent.session,
      mode === "auto"
        ? "auto"
        : mode === "full-access"
          ? "danger-full-access"
          : "workspace-write",
    );
    rec.mode = mode;
    if (params.planning !== undefined) {
      if (!ctx.get("planMode"))
        throw new Error("DeepSeek plan mode service is unavailable");
      ctx.planMode.set(rec.handle.agent, params.planning === true);
    }
    const info = await ctx.llm.resolveModelInfo(config.provider, config.model);
    rec.image = info?.inputModalities?.includes("image") === true;
    return {
      selection: rec.selection.current,
      modelInfo: info,
      image: rec.image,
    };
  }
  async function open(params, resume) {
    if (session || opening || closing)
      throw new Error("DeepSeek bridge already owns a session");
    const cwd = await realpath(requiredString(params.cwd, "cwd"));
    if (!isAbsolute(params.cwd)) throw new Error("cwd must be absolute");
    const sessionId = resume
      ? requiredString(params.sessionId, "sessionId")
      : randomUUID();
    if (resume) {
      const stat = await ctx.sessionPersistence.stat(sessionId);
      if (
        !stat ||
        stat.header.origin === "subagent" ||
        stat.header.parentSession
      )
        throw new Error("DeepSeek session is not resumable");
      if ((await realpath(stat.header.cwd)) !== cwd)
        throw new Error("DeepSeek session workspace does not match");
    }
    const selection = {
      current: params.selection ?? {
        provider: "deepseek-official",
        model: "deepseek-v4-flash",
      },
      assembled: undefined,
    };
    const options = {
      agentOptions: selection.current,
      setup(agentCtx) {
        installModelSelection(agentCtx, selection);
      },
    };
    const task = resume
      ? ctx.agents.resume({ ...options, resumeSessionId: sessionId })
      : ctx.agents.create({ ...options, sessionId, meta: { cwd } });
    opening = task;
    try {
      const handle = await task;
      session = {
        handle,
        selection,
        cwd,
        mode: "supervised",
        run: undefined,
        image: false,
      };
      // Control-only creation must also work before credentials are configured.
      if (params.configure !== false) await configure(session, params);
      await ctx.sessions.flush(handle.agent.session);
      return {
        sessionId,
        ...(params.configure === false ? {} : await describe(session)),
      };
    } catch (error) {
      if (session) {
        await session.handle.dispose();
        session = undefined;
      }
      throw error;
    } finally {
      opening = undefined;
    }
  }
  async function describe(rec) {
    const selected = rec.selection.current;
    return {
      selection: selected,
      modelInfo: await ctx.llm.resolveModelInfo(
        selected.provider,
        selected.model,
      ),
      image: rec.image,
    };
  }
  async function submit(params, steer) {
    const rec = requireSession(params);
    if (!steer && rec.run) throw new Error("A DeepSeek run is already active");
    if (steer && !rec.run) throw new Error("No active DeepSeek run to steer");
    if (!Array.isArray(params.content) || !params.content.length)
      throw new Error("Prompt content is required");
    for (const part of params.content) {
      if (part.type !== "text" && part.type !== "image")
        throw new Error("Unsupported prompt content");
      if (part.type === "text" && typeof part.text !== "string")
        throw new Error("Invalid prompt text");
      if (part.type === "image" && !rec.image)
        throw new Error("The selected DeepSeek model does not accept images");
    }
    const epoch = rec.epoch ?? 0;
    const parts = await Promise.all(
      params.content.map(async (part) =>
        part.type === "image"
          ? {
              type: "image",
              data:
                typeof part.data === "string"
                  ? part.data
                  : Buffer.from(
                      await readFile(requiredString(part.path, "image path")),
                    ).toString("base64"),
              mediaType: part.mimeType,
            }
          : part,
      ),
    );
    const admitted = await ctx.attachments.admitPromptContent(parts);
    if (closing || session !== rec || (rec.epoch ?? 0) !== epoch)
      throw new Error("DeepSeek session cancelled during prompt admission");
    const message = createUserMessage({
      content: admitted,
      source: { kind: "user" },
    });
    const run = rec.run ?? {
      id: randomUUID(),
      cancelled: false,
      error: undefined,
      done: undefined,
    };
    rec.run = run;
    if (steer) rec.handle.agent.steer(message);
    else rec.handle.agent.followup(message);
    await ctx.sessions.flush(rec.handle.agent.session);
    // Defer completion until after the acceptance response has entered the output queue.
    if (!steer) trackRun(rec, run);
    return { runId: run.id, messageId: message.id };
  }
  function trackRun(rec, run) {
    run.start = () => {
      run.done = (async () => {
        try {
          await wait(rec);
          await durableOutput;
        } catch (error) {
          run.error ??= error.message;
        }
        if (rec.run === run) rec.run = undefined;
        await notify("run.completed", {
          runId: run.id,
          cancelled: run.cancelled,
          error: run.error,
        });
      })();
      run.done.catch(() => {});
    };
  }
  async function close() {
    cancelInteractions();
    const rec = session;
    if (!rec) return {};
    cancelJobs();
    rec.handle.agent.cancel({ kind: "user" });
    await ctx.get("subagents")?.drainDescendants([rec.handle.agent]);
    await rec.run?.done;
    await ctx.sessions.flush(rec.handle.agent.session);
    await rec.handle.dispose();
    await durableOutput.catch(() => {});
    session = undefined;
    descendants.clear();
    return {};
  }
  async function dispatch(method, params) {
    if (method === "initialize") {
      if (params.protocolVersion !== PROTOCOL_VERSION)
        throw new Error("Unsupported OmniCode bridge protocol version");
      // Owning stdio does not mean sibling provider/credential plugins are ready.
      // Wait outside apply() so our own fiber can finish loading too.
      await ctx.root.loader.await();
      initialized = true;
      return {
        protocolVersion: PROTOCOL_VERSION,
        runtimeVersion: version,
        capabilities: {
          steer: true,
          questions: true,
          planning: !!ctx.get("planMode"),
          images: true,
        },
        catalog: await catalog(),
      };
    }
    if (!initialized) throw new Error("Initialize the OmniCode bridge first");
    if (method === "session/new") return serial(() => open(params, false));
    if (method === "session/resume") return serial(() => open(params, true));
    if (method === "session/close") {
      requireSession(params);
      closing = true;
      try {
        await controls;
        return await close();
      } finally {
        closing = false;
      }
    }
    if (method === "shutdown") {
      closing = true;
      await controls;
      return close();
    }
    if (method === "session/configure")
      return serial(() => configure(requireSession(params), params));
    if (method === "session/prompt") return serial(() => submit(params, false));
    if (method === "session/steer") return serial(() => submit(params, true));
    if (method === "session/cancel") {
      const rec = requireSession(params);
      rec.epoch = (rec.epoch ?? 0) + 1;
      if (rec.run) rec.run.cancelled = true;
      cancelJobs();
      cancelInteractions();
      rec.handle.agent.cancel({ kind: "user" });
      await rec.run?.done;
      return {};
    }
    if (method === "question/claim") {
      requireSession(params);
      // The existing claim remains alive until answer/cancel; tell the UI to stop its countdown.
      if (claims.has(params.callId)) {
        claims.get(params.callId).hold();
        return { claimed: true };
      }
      return { claimed: false };
    }
    if (method === "question/answer")
      return serial(async () => {
        const rec = requireSession(params);
        const question = ctx.sessionProjections
          .stateOf(rec.handle.agent.session, "userQuestions")
          ?.questions.active.find(
            (question) =>
              question.callId === params.callId &&
              question.state === "continued",
          );
        if (!question)
          throw new Error("DeepSeek question is no longer answerable");
        const answer = params.answer;
        if (
          !record(answer) ||
          !record(answer.answers) ||
          (answer.custom !== undefined && !record(answer.custom))
        )
          throw new Error("Invalid question answer");
        const run = rec.run ?? {
          id: randomUUID(),
          cancelled: false,
          error: undefined,
        };
        const previous = rec.run;
        rec.run = run;
        try {
          const accepted = ctx.userQuestions.answer(
            rec.handle.agent,
            params.callId,
            {
              answers: question.questions.map((item) => ({
                id: item.id,
                selected: Array.isArray(answer.answers[item.id])
                  ? answer.answers[item.id]
                  : [],
                ...(typeof answer.custom?.[item.id] === "string"
                  ? { custom: answer.custom[item.id] }
                  : {}),
              })),
            },
          );
          if (!accepted)
            throw new Error("DeepSeek question is no longer answerable");
          await ctx.sessions.flush(rec.handle.agent.session);
          if (!previous) trackRun(rec, run);
          return { accepted, runId: run.id };
        } catch (error) {
          rec.run = previous;
          throw error;
        }
      });
    throw Object.assign(
      new Error(`Unknown OmniCode bridge method: ${method}`),
      { code: -32601 },
    );
  }
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    void (async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        await write({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Invalid JSON" },
        });
        return;
      }
      if (!record(message) || message.jsonrpc !== "2.0") return;
      if (typeof message.method !== "string") {
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          if (message.error)
            waiter.reject(
              new Error(message.error.message ?? "Client rejected interaction"),
            );
          else waiter.resolve(message.result);
        }
        return;
      }
      try {
        const result = await dispatch(
          message.method,
          record(message.params) ? message.params : {},
        );
        if (message.id !== undefined)
          await write({ jsonrpc: "2.0", id: message.id, result });
        session?.run?.start?.();
        if (session?.run) delete session.run.start;
      } catch (error) {
        if (message.id !== undefined)
          await write({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: error.code ?? -32603,
              message: error.message ?? String(error),
            },
          });
      }
    })().catch((error) => {
      ctx.logger.error(`OmniCode bridge transport failed: ${error.message}`);
    });
  });
  ctx.effect(
    () => async () => {
      closing = true;
      lines.close();
      cancelInteractions();
      await controls;
      await opening?.catch(() => {});
      await close();
    },
    "omnicode-bridge: transport and owned agent",
  );
}
