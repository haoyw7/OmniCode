import { JsonRpcClient, type JsonRpcId } from "../../core/jsonRpc";
import {
  hasHeadlessChildBackend,
  killChild,
  prepareDeepseekBridge,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../core/child";
import {
  measureGenerationTurn,
  generationStreamDelta,
  reportGenerationStreamUsage,
  generationRequestStarted,
} from "../../core/generationMetrics";
import {
  asRecord,
  DEEPSEEK_BRIDGE_PROTOCOL,
  DEEPSEEK_RUNTIME_VERSION,
  deepseekSelection,
  deepseekContent,
  deepseekQuestions,
  deepseekAnswer,
  deepseekErrorMessage,
  DeepseekEventMapper,
} from "./deepseekProtocol";
import type {
  ApprovalDecision,
  HarnessEvent,
  SendTurnInput,
  SteerTurnInput,
  UserQuestionReply,
} from "../../core/types";
import {
  saveGeneratedImage,
  deleteGeneratedImages,
} from "../../../../platform/tauri/fs";
import { translate } from "../../../../shared/i18n/language";

type Live = {
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
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    promise.catch(() => {});
    live.done = { resolve, reject };
    try {
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
  const launch = await prepareDeepseekBridge(input.cwd, input.sessionId);
  const live: Live = {
    rpc: undefined!,
    root: "",
    cwd: input.cwd,
    emit: input.onEvent,
    mapper: new DeepseekEventMapper(),
    requests: new Map(),
    completed: new Map(),
    cancelled: false,
    nextRequest: 1,
    output: Promise.resolve(),
  };
  const rpc = new JsonRpcClient(input.sessionId, {
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
        for (const event of live.mapper.events(params, live.root)) {
          if (
            event.type === "image.generated" &&
            "data" in event &&
            !hasHeadlessChildBackend()
          ) {
            const saved = await saveGeneratedImage({
              data: event.data,
              name: event.name,
            });
            if (live.cancelled) await deleteGeneratedImages([saved.path]);
            else
              live.emit({
                type: "image.generated",
                itemId: event.itemId,
                path: saved.path,
                name: event.name,
                mimeType: saved.mimeType,
                size: saved.size,
                ...(event.agentCallId
                  ? { agentCallId: event.agentCallId }
                  : {}),
              });
          } else live.emit(event);
        }
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
  });
  live.rpc = rpc;
  let stderr = "";
  watchChild(
    input.sessionId,
    (line) => rpc.pushLine(line),
    (_code, error) => {
      const failure = new Error(
        error ?? translate("DeepSeek Harness process exited"),
      );
      rpc.close(failure);
      live.done?.reject(failure);
      lives.delete(input.sessionId);
    },
    (line) => {
      stderr = `${stderr}\n${line}`.slice(-4000);
    },
  );
  try {
    await spawnChild(
      input.sessionId,
      launch.path,
      launch.args,
      input.cwd,
      undefined,
      "deepseek",
    );
    const initialized = await rpc.request<{
      protocolVersion: number;
      runtimeVersion: string;
    }>("initialize", { protocolVersion: DEEPSEEK_BRIDGE_PROTOCOL }, 60_000);
    if (
      initialized.protocolVersion !== DEEPSEEK_BRIDGE_PROTOCOL ||
      initialized.runtimeVersion !== DEEPSEEK_RUNTIME_VERSION
    )
      throw new Error(translate("Unsupported DeepSeek Harness bridge version"));
    const resume = resumes.get(input.sessionId);
    const created = await rpc.request<{ sessionId: string }>(
      resume ? "session/resume" : "session/new",
      {
        ...(resume ? { sessionId: resume.root } : {}),
        cwd: input.cwd,
        selection: deepseekSelection(input.model, input.modelSettings),
        runtimeMode: input.runtimeMode,
        planning: input.intent === "plan",
      },
      CONTROL_TIMEOUT,
    );
    live.root = created.sessionId;
    resumes.set(input.sessionId, { root: live.root, cwd: input.cwd });
    lives.set(input.sessionId, live);
    input.onEvent({
      type: "session.providerBound",
      providerSessionId: live.root,
    });
    input.onEvent({ type: "session.started" });
    return live;
  } catch (error) {
    rpc.close();
    unwatchChild(input.sessionId);
    await killChild(input.sessionId).catch(() => {});
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`,
    );
  }
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
    await live.rpc
      .request("session/close", { sessionId: live.root }, CONTROL_TIMEOUT)
      .catch(() => {});
    live.rpc.close();
    live.done?.resolve();
  }
  unwatchChild(id);
  await killChild(id).catch(() => {});
}
export async function forgetDeepseekSession(id: string) {
  await stopDeepseekSession(id);
  resumes.delete(id);
}
export function bindDeepseekSession(id: string, root: string, cwd: string) {
  resumes.set(id, { root, cwd });
}
