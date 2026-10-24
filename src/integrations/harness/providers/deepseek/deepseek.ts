import { JsonRpcClient, type JsonRpcHandlers, type JsonRpcId } from "../../core/jsonRpc";
import { killChild, prepareDeepseekBridge, selectedChildMachine, spawnChild, unwatchChild, watchChild } from "../../core/child";
import { measureGenerationTurn, generationStreamDelta, reportGenerationStreamUsage, generationRequestStarted } from "../../core/generationMetrics";
import { asRecord, DEEPSEEK_BRIDGE_PROTOCOL, DEEPSEEK_RUNTIME_VERSION, deepseekSelection, deepseekContent, deepseekQuestions, deepseekAnswer, deepseekErrorMessage, DeepseekEventMapper } from "./deepseekProtocol";
import type { ApprovalDecision, HarnessEvent } from "../../../../contracts/harness";
import type { SendTurnInput, SteerTurnInput } from "../../core/types";
import type { UserQuestionReply } from "../../../../contracts/session";
import { translate } from "../../../../shared/i18n/language";

type Live = {
  runtime: Runtime;
  handlers: JsonRpcHandlers;
  rpc: JsonRpcClient;
  root: string;
  cwd: string;
  emit: (event: HarnessEvent) => void;
  mapper: DeepseekEventMapper;
  requests: Map<
    number,
    { wire: JsonRpcId; kind: "approval" | "question"; callId?: string }
  >;
  done?: { resolve: () => void; reject: (error: Error) => void };
  completed: Map<string, { error?: string }>;
  cancelled: boolean;
  nextRequest: number;
  output: Promise<void>;
  runId?: string;
};
type Runtime = {
  key: string;
  id: string;
  rpc: JsonRpcClient;
  ready: Promise<void>;
  clients: Map<string, Live>;
  users: number;
};
const runtimes = new Map<string, Runtime>();
const lives = new Map<string, Live>();
const resumes = new Map<string, { root: string; cwd: string }>();
const cancelled = new Set<string>();
const starting = new Map<string, Promise<Live>>();
const CONTROL_TIMEOUT = 30_000;

export function sendDeepseekTurn(input: SendTurnInput): Promise<void> {
  return measureGenerationTurn(input, async (measured) => {
    const live = await ensureLive(measured);
    if (cancelled.delete(input.sessionId)) return;
    live.emit = measured.onEvent;
    live.cancelled = false;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    promise.catch(() => {});
    live.done = { resolve, reject };
    try {
      await live.rpc.request(
        "session/configure",
        {
          sessionId: live.root,
          selection: deepseekSelection(input.model, input.modelSettings),
          runtimeMode: input.runtimeMode,
          planning: input.intent === "plan",
        },
        CONTROL_TIMEOUT,
      );
      if (live.cancelled || cancelled.delete(input.sessionId)) return;
      const receipt = await live.rpc.request<{ runId: string }>(
        input.questionReply ? "question/answer" : "session/prompt",
        {
          sessionId: live.root,
          ...(input.questionReply
            ? {
                callId: input.questionReply.requestId,
                answer: deepseekAnswer(input.questionReply.reply),
              }
            : { content: deepseekContent(input.text, input.attachments) }),
        },
        CONTROL_TIMEOUT,
      );
      live.runId = receipt.runId;
      input.onAccepted?.();
      const completed = live.completed.get(receipt.runId);
      if (completed?.error && !live.cancelled) throw new Error(completed.error);
      if (!completed) await promise;
      live.completed.delete(receipt.runId);
      await live.output;
    } catch (error) {
      const wasCancelled = live.cancelled;
      await stopDeepseekSession(input.sessionId);
      if (!wasCancelled) throw error;
    } finally {
      live.done = undefined;
      live.runId = undefined;
    }
  }).catch((error) => {
    throw new Error(deepseekErrorMessage(error));
  });
}

async function ensureLive(input: SendTurnInput): Promise<Live> {
  const existing = lives.get(input.sessionId);
  if (existing) {
    if (existing.cwd !== input.cwd)
      throw new Error("DeepSeek session workspace does not match");
    return existing;
  }
  const pending = starting.get(input.sessionId);
  if (pending) return pending;
  const task = start(input);
  starting.set(input.sessionId, task);
  try {
    return await task;
  } finally {
    starting.delete(input.sessionId);
  }
}

async function start(input: SendTurnInput): Promise<Live> {
  const runtime = await acquireRuntime(input);
  const resume = resumes.get(input.sessionId);
  const live: Live = {
    runtime,
    handlers: {},
    rpc: runtime.rpc,
    root: resume?.root ?? crypto.randomUUID(),
    cwd: input.cwd,
    emit: input.onEvent,
    mapper: new DeepseekEventMapper(),
    requests: new Map(),
    completed: new Map(),
    cancelled: false,
    nextRequest: 1,
    output: Promise.resolve(),
  };
  const rpc = runtime.rpc;
  if (runtime.clients.has(live.root)) {
    await releaseRuntime(runtime);
    throw new Error(translate("DeepSeek session is already open"));
  }
  live.handlers = {
    onNotification(method, params) {
      if (method !== "session/event") return;
      const envelope = asRecord(params);
      if (live.root && envelope.sessionId !== live.root) return;
      if (envelope.kind === "run.completed") {
        const result = asRecord(envelope.data);
        if (typeof result.runId !== "string") return;
        live.completed.set(result.runId, result);
        if (live.completed.size > 8)
          live.completed.delete(live.completed.keys().next().value!);
        if (result.runId === live.runId) {
          if (result.error && !live.cancelled)
            live.done?.reject(new Error(result.error));
          else live.done?.resolve();
        }
        return;
      }
      if (envelope.kind === "interaction.closed") {
        const wire = asRecord(envelope.data).requestId;
        for (const [id, request] of live.requests)
          if (request.wire === wire) {
            live.requests.delete(id);
            live.emit(
              request.kind === "approval"
                ? {
                    type: "approval.resolved",
                    requestId: id,
                    decision: "cancelled",
                  }
                : {
                    type: "question.resolved",
                    requestId: id,
                    decision: "cancelled",
                  },
            );
          }
        return;
      }
      live.output = live.output.then(async () => {
        if (live.cancelled) return;
        if (
          envelope.sourceSessionId === live.root &&
          envelope.kind === "assistant.stream"
        ) {
          const frame = asRecord(envelope.data);
          if (frame.type === "start") generationRequestStarted(live.emit);
          if (frame.type === "chunk") {
            const chunk = asRecord(frame.chunk);
            if (chunk.type === "text-delta" || chunk.type === "reasoning-delta")
              generationStreamDelta(live.emit, chunk.text);
            else if (chunk.type === "tool-call-delta")
              generationStreamDelta(live.emit, chunk.argumentsDelta ?? "");
            else if (chunk.type === "usage")
              reportGenerationStreamUsage(live.emit, chunk.usage?.outputTokens);
          }
          if (frame.type === "end") reportGenerationStreamUsage(live.emit);
        }
        for (const event of live.mapper.events(params, live.root))
          live.emit(event);
      });
      live.output.catch((error) => live.done?.reject(error));
    },
    async onRequest(wire, method, value) {
      if (method !== "approval/request" && method !== "question/request") {
        await rpc.respondError(wire, {
          code: -32601,
          message: "Unknown bridge client method",
        });
        return;
      }
      await live.output;
      const params = asRecord(value);
      if (live.cancelled || params.sessionId !== live.root) {
        await rpc.respondError(wire, {
          code: -32800,
          message: "Interaction cancelled",
        });
        return;
      }
      const id = live.nextRequest++;
      live.requests.set(id, {
        wire,
        kind: method === "approval/request" ? "approval" : "question",
        callId: params.callId,
      });
      if (method === "approval/request") {
        const tool = live.mapper.tool(
          params.sourceSessionId ?? live.root,
          params.callId,
        );
        live.emit({
          type: "approval.requested",
          requestId: id,
          callId: tool?.callId,
          title:
            tool?.title ?? params.toolName ?? translate("Approval required"),
          kind: tool?.kind,
          preview: tool?.preview,
        });
      } else {
        const questions = deepseekQuestions(params.questions);
        live.emit({
          type: "question.asked",
          requestId: id,
          questions,
          callId: params.callId,
          providerQuestionId: params.allowLateReply ? params.callId : undefined,
          autoResolveAt: params.autoResolveAt,
          allowLateReply: params.allowLateReply,
        });
      }
    },
  };
  runtime.clients.set(live.root, live);
  try {
    const created = await rpc.request<{ sessionId: string }>(
      resume ? "session/resume" : "session/new",
      {
        sessionId: live.root,
        cwd: input.cwd,
        // sendDeepseekTurn applies the complete configuration once before prompt.
        configure: false,
        selection: deepseekSelection(input.model, input.modelSettings),
        runtimeMode: input.runtimeMode,
        planning: input.intent === "plan",
      },
      CONTROL_TIMEOUT,
    );
    if (created.sessionId !== live.root || rpc.isClosed)
      throw new Error(translate("DeepSeek session could not be opened"));
    resumes.set(input.sessionId, { root: live.root, cwd: input.cwd });
    lives.set(input.sessionId, live);
    input.onEvent({
      type: "session.providerBound",
      providerSessionId: live.root,
    });
    input.onEvent({ type: "session.started" });
    return live;
  } catch (error) {
    await rpc.request("session/close", { sessionId: live.root }, CONTROL_TIMEOUT).catch(() => {});
    runtime.clients.delete(live.root);
    await releaseRuntime(runtime);
    throw error;
  }
}

/** Catalog/account reads borrow the same transport without owning an Agent. */
export async function readDeepseekRuntime<T>(cwd: string, read: (rpc: JsonRpcClient) => Promise<T>): Promise<T> {
  const runtime = await acquireRuntime({ cwd });
  try {
    return await read(runtime.rpc);
  } finally {
    await releaseRuntime(runtime);
  }
}

async function acquireRuntime(input: { cwd: string; sessionId?: string }): Promise<Runtime> {
  const machine = selectedChildMachine();
  const launch = await prepareDeepseekBridge(input.cwd, input.sessionId);
  const key = JSON.stringify([machine, launch.runtimeKey ?? [launch.path, launch.args]]);
  let runtime = runtimes.get(key);
  if (!runtime) {
    const id = `omnicode-deepseek-runtime-${crypto.randomUUID()}`;
    const clients = new Map<string, Live>();
    const rpc = new JsonRpcClient(id, {
      onNotification: (method, params) =>
        clients.get(asRecord(params).sessionId)?.handlers.onNotification?.(method, params),
      onRequest: async (wire, method, params) => {
        const live = clients.get(asRecord(params).sessionId);
        if (live) await live.handlers.onRequest?.(wire, method, params);
        else await rpc.respondError(wire, { code: -32800, message: "Unknown DeepSeek session" });
      },
    });
    runtime = { key, id, rpc, ready: Promise.resolve(), clients, users: 0 };
    const current = runtime;
    runtimes.set(key, current);
    let stderr = "";
    watchChild(id, line => rpc.pushLine(line), (_code, error) => {
      failRuntime(current, new Error(error ?? translate("DeepSeek Harness process exited")));
      unwatchChild(id);
    }, line => { stderr = `${stderr}\n${line}`.slice(-4000); });
    current.ready = (async () => {
      try {
        await spawnChild(id, launch.path, launch.args, launch.cwd ?? input.cwd, undefined, "deepseek", {
          environmentSessionId: input.sessionId,
          deepseekHome: launch.deepseekHome,
        });
        const initialized = await rpc.request<{
          protocolVersion: number; runtimeVersion: string; capabilities?: { multiplex?: boolean };
        }>("initialize", { protocolVersion: DEEPSEEK_BRIDGE_PROTOCOL, includeCatalog: false }, 60_000);
        if (initialized.protocolVersion !== DEEPSEEK_BRIDGE_PROTOCOL ||
            initialized.runtimeVersion !== DEEPSEEK_RUNTIME_VERSION || !initialized.capabilities?.multiplex)
          throw new Error(translate("Unsupported DeepSeek Harness bridge version"));
      } catch (error) {
        const failure = new Error(`${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`);
        failRuntime(current, failure);
        await killChild(id).catch(() => {});
        throw failure;
      }
    })();
  }
  runtime.users++;
  try {
    await runtime.ready;
    return runtime;
  } catch (error) {
    runtime.users--;
    throw error;
  }
}

function failRuntime(runtime: Runtime, error: Error): void {
  if (runtimes.get(runtime.key) === runtime) runtimes.delete(runtime.key);
  runtime.rpc.close(error);
  for (const [id, live] of lives) {
    if (live.runtime !== runtime) continue;
    lives.delete(id);
    live.done?.reject(error);
  }
}

async function releaseRuntime(runtime: Runtime): Promise<void> {
  runtime.users--;
  if (runtime.users > 0) return;
  if (runtimes.get(runtime.key) === runtime) runtimes.delete(runtime.key);
  await runtime.rpc.request("shutdown", {}, 5_000).catch(() => {});
  failRuntime(runtime, new Error(translate("DeepSeek Harness process exited")));
  unwatchChild(runtime.id);
  await killChild(runtime.id).catch(() => {});
}

export async function steerDeepseekTurn(input: SteerTurnInput) {
  const live = lives.get(input.sessionId);
  if (!live) throw new Error(translate("No active DeepSeek Harness session"));
  if (live.cwd !== input.cwd)
    throw new Error(translate("DeepSeek session workspace does not match"));
  await live.rpc.request(
    input.questionReply ? "question/answer" : "session/steer",
    {
      sessionId: live.root,
      ...(input.questionReply
        ? {
            callId: input.questionReply.requestId,
            answer: deepseekAnswer(input.questionReply.reply),
          }
        : { content: deepseekContent(input.text, input.attachments) }),
    },
    CONTROL_TIMEOUT,
  );
}
export async function cancelDeepseekTurn(id: string) {
  const live = lives.get(id);
  if (!live) {
    cancelled.add(id);
    return;
  }
  live.cancelled = true;
  await live.rpc.request(
    "session/cancel",
    { sessionId: live.root },
    CONTROL_TIMEOUT,
  );
}
export async function stopDeepseekBackgroundTask(id: string, taskId: string): Promise<void> {
  const live = lives.get(id);
  if (!live || live.cancelled) return;
  await live.rpc.request("job/stop", { sessionId: live.root, jobId: taskId }, CONTROL_TIMEOUT);
}
export function respondDeepseekApproval(
  id: string,
  requestId: number,
  decision: ApprovalDecision,
) {
  const live = lives.get(id);
  const request = live?.requests.get(requestId);
  if (!live || !request || request.kind !== "approval") return;
  live.requests.delete(requestId);
  void live.rpc
    .respond(request.wire, { decision })
    .catch((error) => live.done?.reject(error));
  live.emit({ type: "approval.resolved", requestId, decision });
}
export function respondDeepseekQuestion(
  id: string,
  requestId: number,
  reply: UserQuestionReply,
) {
  const live = lives.get(id);
  const request = live?.requests.get(requestId);
  if (!live || !request || request.kind !== "question") return;
  live.requests.delete(requestId);
  void live.rpc
    .respond(request.wire, deepseekAnswer(reply))
    .catch((error) => live.done?.reject(error));
  live.emit({
    type: "question.resolved",
    requestId,
    decision: reply.kind === "answered" ? "answered" : "skipped",
    ...(reply.kind === "answered" ? { reply } : {}),
  });
}
export function keepDeepseekQuestionOpen(id: string, requestId: number) {
  const live = lives.get(id);
  const request = live?.requests.get(requestId);
  if (!live || !request?.callId) return;
  void live.rpc
    .request<{ claimed: boolean }>(
      "question/claim",
      { sessionId: live.root, callId: request.callId },
      CONTROL_TIMEOUT,
    )
    .then((result) => {
      if (result.claimed && live.requests.get(requestId) === request)
        live.emit({
          type: "question.updated",
          requestId,
          autoResolveAt: undefined,
        });
    })
    .catch((error) => live.done?.reject(error));
}
export async function stopDeepseekSession(id: string) {
  cancelled.delete(id);
  const pending = starting.get(id);
  if (pending) await pending.catch(() => {});
  const live = lives.get(id);
  lives.delete(id);
  if (live) {
    live.cancelled = true;
    try {
      await live.rpc.request("session/close", { sessionId: live.root }, CONTROL_TIMEOUT);
    } catch (error) {
      // A wedged shared transport cannot safely leave an unowned Agent running.
      failRuntime(live.runtime, error instanceof Error ? error : new Error(String(error)));
      await killChild(live.runtime.id).catch(() => {});
    }
    live.runtime.clients.delete(live.root);
    live.done?.resolve();
    await releaseRuntime(live.runtime);
  }
}
export async function forgetDeepseekSession(id: string) {
  await stopDeepseekSession(id);
  resumes.delete(id);
}
export function bindDeepseekSession(id: string, root: string, cwd: string) {
  resumes.set(id, { root, cwd });
}
