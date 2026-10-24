import { registerHarness, type HarnessAdapter } from "../../core/registry";
import type { HarnessEvent } from "../../../../contracts/harness";
import type { SendTurnInput } from "../../core/types";
import { killChild, readWorkBuddyAccounts, readWorkBuddyCatalog, resolveWorkBuddyBinary, spawnChild, watchChild, unwatchChild, writeChild, childUsesSelectedMachine } from "../../core/child";
import { control, isHistorical, parseLine, permissionMode, permissionResponse, questionInput, questions, spawnArgs, textContent, toolKind, toolPreview, userMessage, workBuddyModel, type Json, type QuestionReply } from "./workbuddyProtocol";
import { translate } from "../../../../shared/i18n/language";

type Resume = { providerId?: string; accountId?: string; cwd: string };
type Pending = { nativeId: string; input: Json; question: boolean; callId?: string };
type Live = Resume & {
  emit: (event: HarnessEvent) => void;
  key: string;
  ready: Promise<void>;
  initialize: () => void;
  failInitialize: (error: Error) => void;
  active: boolean;
  cancelled: boolean;
  sentAt: number;
  finish?: (error?: Error) => void;
  pending: Map<number, Pending>;
  nextId: number;
  tools: Set<string>;
  toolResults: Map<string, Extract<HarnessEvent, { type: "tool.updated" }>>;
  images: Set<string>;
  text: string;
  reasoning: string;
  assistantSeen: boolean;
  generation: number;
  cancelTimer?: ReturnType<typeof setTimeout>;
};
const lives = new Map<string, Live>();
const resumes = new Map<string, Resume>();
const sending = new Set<string>();
const cancelledStarts = new Set<string>();
let sequence = 0;
const write = (id: string, value: Json) => writeChild(id, JSON.stringify(value));

function resolvePending(id: string, live: Live, decision: "cancelled" | "deny" = "cancelled") {
  for (const [uiId, pending] of live.pending) {
    void write(id, permissionResponse(pending.nativeId, false)).catch(() => {});
    live.emit(pending.question ? { type: "question.resolved", requestId: uiId, decision: "cancelled" }
      : { type: "approval.resolved", requestId: uiId, decision });
  }
  live.pending.clear();
}
function finish(id: string, live: Live, error?: Error) {
  clearTimeout(live.cancelTimer);
  resolvePending(id, live);
  live.active = false;
  live.emit({ type: "message.completed" });
  live.emit({ type: "reasoning.completed" });
  const settle = live.finish;
  live.finish = undefined;
  settle?.(error);
}
function bind(id: string, live: Live, message: Json) {
  if (message.parent_tool_use_id || typeof message.session_id !== "string") return;
  if (message.session_id === live.providerId) return;
  live.providerId = message.session_id;
  resumes.set(id, { providerId: live.providerId, accountId: live.accountId, cwd: live.cwd });
  live.emit({ type: "session.providerBound", providerSessionId: live.providerId!, providerAccountId: live.accountId });
}
function append(live: Live, kind: "text" | "reasoning", value: string) {
  if (!value) return;
  live[kind] += value;
  live.assistantSeen = true;
  live.emit(kind === "text" ? { type: "message.delta", text: value } : { type: "reasoning.delta", text: value });
}
function startTool(live: Live, part: Json) {
  if (typeof part.id !== "string" || live.tools.has(part.id)) return;
  live.tools.add(part.id); live.assistantSeen = true;
  live.emit({ type: "tool.started", callId: part.id, title: part.name, kind: toolKind(part.name), preview: toolPreview(part.name, part.input || {}) });
  const result = live.toolResults.get(part.id);
  if (result) { live.toolResults.delete(part.id); live.emit(result); }
}
function handle(id: string, live: Live, message: Json) {
  if (message.type === "control_response" && message.response?.request_id === "omnicode-initialize") {
    if (message.response.subtype === "success") live.initialize();
    else live.failInitialize(new Error(translate("WorkBuddy initialization failed")));
    return;
  }
  if (message.type === "omnicode_error" || (!message.type && message.error)) {
    const error = new Error(translate(message.message || message.error || "WorkBuddy initialization failed"));
    live.failInitialize(error); finish(id, live, error); return;
  }
  bind(id, live, message);
  if (message.type === "control_notification" && message.channel === "permission") {
    const nativeId = message.data?.requestId;
    for (const [uiId, pending] of live.pending) if (pending.nativeId === nativeId) {
      live.pending.delete(uiId);
      live.emit(pending.question ? { type: "question.resolved", requestId: uiId, decision: "cancelled" }
        : { type: "approval.resolved", requestId: uiId, decision: "cancelled" });
    }
    return;
  }
  if (message.type === "control_request") {
    const request = message.request || {};
    if (request.subtype !== "can_use_tool" || !live.active || live.cancelled) {
      void write(id, permissionResponse(message.request_id, false)).catch(() => {}); return;
    }
    const uiId = live.nextId++;
    const input = request.input || {};
    const question = request.tool_name === "AskUserQuestion";
    // A permission request is turn activity even if the native tool ID is omitted.
    live.assistantSeen = true;
    const pending = { nativeId: message.request_id, input, question, callId: request.tool_use_id };
    live.pending.set(uiId, pending);
    startTool(live, { id: pending.callId, name: request.tool_name, input });
    if (question) {
      const parsed = questions(input);
      if (!parsed.length) { live.pending.delete(uiId); void write(id, permissionResponse(message.request_id, false)).catch(() => {}); return; }
      live.emit({ type: "question.asked", requestId: uiId, callId: pending.callId, title: parsed[0].header || parsed[0].prompt, questions: parsed });
    } else live.emit({ type: "approval.requested", requestId: uiId, callId: pending.callId,
      title: request.tool_name || "WorkBuddy", kind: toolKind(request.tool_name), preview: toolPreview(request.tool_name, input) });
    return;
  }
  if (!live.active || isHistorical(message, live.sentAt)) return;
  if (message.parent_tool_use_id) return; // Child transcripts must not finish/rebind the parent turn.
  if (message.type === "stream_event") {
    const event = message.event || {};
    if (event.type === "message_start") { live.text = ""; live.reasoning = ""; }
    if (event.type === "content_block_delta") {
      if (event.delta?.type === "text_delta") append(live, "text", event.delta.text || "");
      if (event.delta?.type === "thinking_delta") append(live, "reasoning", event.delta.thinking || "");
    }
  }
  if (message.type === "assistant") {
    for (const part of message.message?.content || []) {
      if (part.type === "text" && typeof part.text === "string") {
        const remaining = part.text.startsWith(live.text) ? part.text.slice(live.text.length) : part.text;
        append(live, "text", remaining);
        live.emit({ type: "message.completed" }); live.text = "";
      }
      if (part.type === "thinking" && typeof part.thinking === "string") {
        const remaining = part.thinking.startsWith(live.reasoning) ? part.thinking.slice(live.reasoning.length) : part.thinking;
        append(live, "reasoning", remaining);
        live.emit({ type: "reasoning.completed" }); live.reasoning = "";
      }
      if (part.type === "tool_use") startTool(live, part);
    }
  }
  if (message.type === "user") for (const part of message.message?.content || []) {
    if (part.type === "tool_result" && typeof part.tool_use_id === "string") {
      const result: Extract<HarnessEvent, { type: "tool.updated" }> = { type: "tool.updated", callId: part.tool_use_id,
        status: part.is_error ? "failed" : "completed", detail: textContent(part.content) };
      if (live.tools.has(part.tool_use_id)) live.emit(result);
      else live.toolResults.set(part.tool_use_id, result);
    }
  }
  for (const image of message.omnicode_generated_images || []) {
    if (live.images.has(image.itemId)) continue;
    live.images.add(image.itemId);
    if (image.error) live.emit({ type: "status", text: translate("Could not read the generated image on the execution machine") });
    else live.emit({ type: "image.generated", itemId: image.itemId, data: image.data, name: image.name, mimeType: image.mimeType });
  }
  if (message.type === "result") {
    if (!live.assistantSeen && message.duration_api_ms === 0 && !message.is_error) return;
    if (!live.assistantSeen && typeof message.result === "string") append(live, "text", message.result);
    const u = message.usage;
    if (u) live.emit({ type: "turn.metrics", inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0, cacheWriteTokens: u.cache_creation_input_tokens || 0 });
    const used = message._meta?.["codebuddy.ai/contextUsed"];
    if (Number.isFinite(used)) live.emit({ type: "context", used });
    const error = message.is_error && !live.cancelled ? new Error(textContent(message.errors) || message.result || translate("WorkBuddy turn failed")) : undefined;
    const generation = live.generation;
    void Promise.resolve().then(() => {
      if (lives.get(id) !== live || !live.active || live.generation !== generation) return;
      finish(id, live, error);
      // The next send must reread the desktop login after an authentication error.
      if (error) void stop(id);
    });
  }
}
async function prepare(input: SendTurnInput): Promise<Live> {
  const model = workBuddyModel(input.model);
  const previous = resumes.get(input.sessionId);
  const requested = input.providerAccountId || previous?.accountId;
  const accounts = await readWorkBuddyAccounts();
  if (cancelledStarts.has(input.sessionId)) throw new Error(translate("WorkBuddy session stopped"));
  const account = requested && requested !== "default" ? accounts.find(a => a.id === requested) : accounts.find(a => a.edition === model.edition);
  if (!account || account.edition !== model.edition) throw new Error(translate("The selected WorkBuddy login is no longer available. Sign in on the execution machine and refresh accounts."));
  if (previous?.providerId && previous.accountId && previous.accountId !== account.id) throw new Error(translate("This WorkBuddy conversation belongs to another account"));
  const key = [input.cwd, input.model, account.id, permissionMode(input.runtimeMode, input.intent)].join("\n");
  const current = lives.get(input.sessionId);
  if (current?.key === key && childUsesSelectedMachine(input.sessionId)) {
    await current.ready;
    current.emit = input.onEvent;
    return current;
  }
  if (current) await stop(input.sessionId);
  const saved = resumes.get(input.sessionId);
  let initialize!: () => void, failInitialize!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { initialize = resolve; failInitialize = reject; });
  const live: Live = { cwd: input.cwd, accountId: account.id, providerId: saved?.providerId, emit: input.onEvent, key, ready,
    initialize, failInitialize, active: false, cancelled: false, sentAt: 0, pending: new Map(), nextId: 1,
    tools: new Set(), toolResults: new Map(), images: new Set(), text: "", reasoning: "", assistantSeen: false, generation: 0 };
  lives.set(input.sessionId, live);
  // Attach a rejection handler before spawn: an immediate exit can precede the await.
  void ready.catch(() => {});
  watchChild(input.sessionId, line => {
    if (lives.get(input.sessionId) !== live) return;
    const message = parseLine(line); if (message) handle(input.sessionId, live, message);
  }, code => {
    if (lives.get(input.sessionId) !== live) return;
    lives.delete(input.sessionId);
    unwatchChild(input.sessionId);
    const error = new Error(translate("WorkBuddy exited before the turn completed"));
    live.failInitialize(error);
    if (live.active) finish(input.sessionId, live, live.cancelled ? undefined : error);
    live.emit({ type: "session.ended", code });
  });
  const timer = setTimeout(() => failInitialize(new Error(translate("WorkBuddy initialization timed out"))), 30000);
  try {
    const binary = await resolveWorkBuddyBinary();
    if (lives.get(input.sessionId) !== live) throw new Error(translate("WorkBuddy session stopped"));
    await spawnChild(input.sessionId, binary.path, spawnArgs(input, saved?.providerId), input.cwd, { provider: "workbuddy", id: account.id }, "workbuddy");
    if (lives.get(input.sessionId) !== live) {
      await killChild(input.sessionId);
      throw new Error(translate("WorkBuddy session stopped"));
    }
    await write(input.sessionId, control("omnicode-initialize", { subtype: "initialize", capabilities: { askUserQuestion: true } }));
    await ready;
    live.emit({ type: "session.started" });
    return live;
  } catch (error) { await stop(input.sessionId); throw error; }
  finally { clearTimeout(timer); }
}
async function sendPrepared(input: SendTurnInput) {
  const live = await prepare(input);
  if (cancelledStarts.has(input.sessionId) || lives.get(input.sessionId) !== live) throw new Error(translate("WorkBuddy session stopped"));
  if (live.active) throw new Error(translate("WorkBuddy is already running a turn"));
  live.active = true; live.cancelled = false; live.sentAt = Date.now();
  live.generation++;
  live.text = ""; live.reasoning = ""; live.assistantSeen = false; live.tools.clear(); live.toolResults.clear(); live.images.clear();
  const uuid = crypto.randomUUID();
  const completed = new Promise<void>((resolve, reject) => { live.finish = error => error ? reject(error) : resolve(); });
  void completed.catch(() => {});
  try {
    await write(input.sessionId, userMessage(input, uuid));
    input.onAccepted?.();
    live.emit({ type: "turn.started", providerTurnId: uuid });
  } catch (error) { finish(input.sessionId, live, error instanceof Error ? error : new Error(String(error))); }
  return completed;
}
async function send(input: SendTurnInput) {
  if (sending.has(input.sessionId)) throw new Error(translate("WorkBuddy is already running a turn"));
  cancelledStarts.delete(input.sessionId);
  sending.add(input.sessionId);
  try { await sendPrepared(input); }
  finally { sending.delete(input.sessionId); cancelledStarts.delete(input.sessionId); }
}
function stopRequested(id: string) {
  if (sending.has(id)) cancelledStarts.add(id);
  return stop(id);
}
async function stop(id: string) {
  const live = lives.get(id);
  if (!live) return;
  lives.delete(id);
  if (live.providerId) resumes.set(id, { providerId: live.providerId, accountId: live.accountId, cwd: live.cwd });
  live.cancelled = true;
  live.failInitialize(new Error(translate("WorkBuddy session stopped")));
  if (live.active) finish(id, live);
  await killChild(id);
}
async function cancel(id: string) {
  if (sending.has(id)) cancelledStarts.add(id);
  const live = lives.get(id); if (!live) return;
  if (!live.active) { await stop(id); return; }
  live.cancelled = true; resolvePending(id, live);
  const generation = live.generation;
  clearTimeout(live.cancelTimer);
  live.cancelTimer = setTimeout(() => {
    if (lives.get(id) === live && live.active && live.generation === generation) void stop(id);
  }, 2000);
  await write(id, control("omnicode-cancel-" + ++sequence, { subtype: "interrupt", session_id: live.providerId })).catch(() => {});
}
function approve(id: string, requestId: number, decision: "allow" | "deny") {
  const live = lives.get(id), pending = live?.pending.get(requestId);
  if (!live || !pending || pending.question) return;
  live.pending.delete(requestId);
  void write(id, permissionResponse(pending.nativeId, decision === "allow", pending.input)).catch(() => { void stop(id); });
  live.emit({ type: "approval.resolved", requestId, decision });
}
function answer(id: string, requestId: number, reply: QuestionReply) {
  const live = lives.get(id), pending = live?.pending.get(requestId);
  if (!live || !pending?.question) return;
  live.pending.delete(requestId);
  const input = questionInput(pending.input, reply);
  void write(id, permissionResponse(pending.nativeId, !!input, input)).catch(() => { void stop(id); });
  live.emit({ type: "question.resolved", requestId, decision: input ? "answered" : "skipped", ...(reply.kind === "answered" ? { reply } : {}) });
}
export async function discoverWorkBuddyModels() {
  const catalog = await readWorkBuddyCatalog();
  if (!catalog.models.length && catalog.errors.length) throw new Error(catalog.errors[0].message);
  return catalog.models.map(model => ({ ...model, harness: "workbuddy" as const }));
}
export const workbuddyAdapter: HarnessAdapter = {
  id: "workbuddy", live: true, canSteer: false, sendTurn: send,
  steerTurn: async () => { throw new Error(translate("WorkBuddy does not support live interjections")); },
  cancelTurn: cancel, stopSession: stopRequested,
  forgetSession: async id => { await stopRequested(id); resumes.delete(id); },
  bindSession: (id, providerId, cwd, accountId) => { resumes.set(id, { providerId, cwd, accountId }); },
  respondApproval: approve, respondQuestion: answer, refreshCatalog: discoverWorkBuddyModels,
};
export function ensureWorkBuddyRegistered() { registerHarness(workbuddyAdapter); }
