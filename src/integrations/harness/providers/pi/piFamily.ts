import {
  measureGenerationTurn,
  emitGenerationText,
  generationRequestStarted,
  reportGenerationUsage,
  resetGenerationMetrics,
} from "../../core/generationMetrics";
import { botContextKey } from "../../core/botContext";
import { nativeModelId } from "../../../../features/sessions/model/models";
import { taskListFromToolInput } from "../../../../features/sessions/model/taskList";
import { normalizeProjectPath } from "../../../../features/projects/model/recents";
import type { UserQuestionReply } from "../../../../features/sessions/model/userQuestion";
import type {
  CommandContext,
  NativeCommand,
  NativeCommandProvider,
} from "../../core/nativeCommands";
import { discoverOmpCommands, ompCommandsFromRpcData } from "./piSkills";
import { OMP_FLAVOR } from "./piFlavor";
import {
  killChild,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "../../core/child";
import type { PiFlavor } from "./piFlavor";
import { PiRpc } from "./piClient";
import { piSubagentEvents } from "./piSubagents";
import {
  agentEndWillRetry,
  asRecord,
  assistantDeltaFromEvent,
  buildPiPrompt,
  buildPiSpawnArgs,
  buildPiSteer,
  contextFromSessionStats,
  contextFromUsage,
  turnMetricsFromUsage,
  extensionUiResponse,
  extensionUiTitle,
  forkMessagesFromRpcData,
  isAgentSettled,
  isPiThinkingLevel,
  mergeToolInput,
  needsExtensionUiReply,
  parseExtensionUiRequest,
  parsePiModelRef,
  piNativeId,
  previewFromTool,
  providerSessionIdFromState,
  sessionFromState,
  statusFromPiEvent,
  stringField,
  summarizeToolRequest,
  toolCallDeltaFromEvent,
  toolCallEndFromEvent,
  toolCallStartFromEvent,
  toolExecutionEndFromEvent,
  toolImagesFromEvent,
  toolExecutionStartFromEvent,
  toolExecutionUpdateFromEvent,
  toolKindFromName,
  toolTitle,
  tryParseJsonRecord,
  turnErrorFromEvent,
  type PiExtensionUiRequest,
  thinkingSetting,
  type PiThinkingLevel,
} from "./piProtocol";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  HarnessSessionInput,
  RewindLastTurnInput,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";

type PendingApproval = {
  request: PiExtensionUiRequest;
  resolve: (decision: ApprovalDecision) => void;
};

type InFlightTool = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  partialJson: string;
  title: string;
  /** Set on `tool_execution_end`; later progress updates are stale. */
  finished?: boolean;
};

type RawImage = Extract<HarnessEvent, { type: "image.generated"; data: string }>;
export type PiImageMaterializer = (image: RawImage) => Promise<{
  event: Extract<HarnessEvent, { type: "image.generated"; path: string }>;
  discard: () => Promise<void>;
}>;

type Live = {
  rpc: PiRpc;
  pendingImages: Promise<void>;
  imageIds: Set<string>;
  imageMaterializer?: PiImageMaterializer;
  cwd: string;
  providerSessionId: string;
  contextWindow?: number;
  nativeModel: string;
  thinking: string;
  thinkingLevels?: PiThinkingLevel[];
  thinkingLevelsModel?: string;
  fastModeEnabled?: boolean;
  fastModeRequested?: boolean;
  planning: boolean;
  botContextKey: string;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  questions: Map<
    number,
    { id: string; resolve: (reply: UserQuestionReply) => void }
  >;
  availableCommands?: NativeCommand[];
  promptId: string | null;
  nextApprovalUiId: number;
  toolsByIndex: Map<number, InFlightTool>;
  toolsById: Map<string, InFlightTool>;
  cancelled: boolean;
  muteUpdates: boolean;
  compacting: boolean;
  retrying: boolean;
  settling: boolean;
  settleToken: number;
  turns: Promise<void>;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  turnEndPending: boolean;
  activeTurn: boolean;
  emittedAssistant: string;
  emittedReasoning: string;
  /** Reason the turn failed, held until we know it is not being retried. */
  turnError: string | null;
};

type Resume = {
  sessionPath?: string;
  sessionId: string;
  cwd: string;
};

const INIT_TIMEOUT_MS = 45_000;
const STATS_TIMEOUT_MS = 4_000;
const COMPACT_TIMEOUT_MS = 30 * 60_000;

type FlavorState = {
  nextInteractionId: number;
  liveByThread: Map<string, Live>;
  resumeByThread: Map<string, Resume>;
  cancelledThreads: Set<string>;
  resolveBinary: () => Promise<{ path: string }>;
  commandListeners: Map<string, Set<(commands: NativeCommand[]) => void>>;
};

/**
 * Pi and omp each get their own child processes and resume tables, so a live
 * session on one never collides with the other.
 */
const stateByFlavor = new Map<string, FlavorState>();

function stateFor(flavor: PiFlavor): FlavorState {
  let state = stateByFlavor.get(flavor.id);
  if (!state) {
    state = {
      nextInteractionId: 1,
      liveByThread: new Map(),
      resumeByThread: new Map(),
      cancelledThreads: new Set(),
      resolveBinary: flavor.resolveBinary,
      commandListeners: new Map(),
    };
    stateByFlavor.set(flavor.id, state);
  }
  return state;
}

function commandContextKey(context: CommandContext): string {
  return `${context.sessionId ?? ""}\0${normalizeProjectPath(context.cwd)}`;
}

export const ompCommandProvider: NativeCommandProvider = {
  rawSlashCommands: true,
  async discover(context) {
    const live = context.sessionId
      ? stateFor(OMP_FLAVOR).liveByThread.get(context.sessionId)
      : undefined;
    if (
      !live ||
      normalizeProjectPath(live.cwd) !== normalizeProjectPath(context.cwd)
    ) {
      return discoverOmpCommands(context.cwd);
    }
    if (live.availableCommands) return live.availableCommands;
    const response = await live.rpc.request(
      { type: "get_available_commands" },
      INIT_TIMEOUT_MS,
    );
    return live.availableCommands ?? ompCommandsFromRpcData(response.data);
  },
  subscribe(context, onCommands) {
    const state = stateFor(OMP_FLAVOR);
    const key = commandContextKey(context);
    let listeners = state.commandListeners.get(key);
    if (!listeners) state.commandListeners.set(key, (listeners = new Set()));
    listeners.add(onCommands);
    const live = context.sessionId
      ? state.liveByThread.get(context.sessionId)
      : undefined;
    if (
      live?.availableCommands &&
      normalizeProjectPath(live.cwd) === normalizeProjectPath(context.cwd)
    ) {
      onCommands(live.availableCommands);
    }
    return () => {
      listeners.delete(onCommands);
      if (!listeners.size) state.commandListeners.delete(key);
    };
  },
};

/** Test seam. */
export function setPiBinaryResolver(
  flavor: PiFlavor,
  fn: () => Promise<{ path: string }>,
): void {
  stateFor(flavor).resolveBinary = fn;
}

/**
 * Live Pi adapter. Spawns `pi --mode rpc` with the user's config and extensions
 * loaded (no `--no-extensions`). Todos/subagents packages in `~/.pi/agent`
 * keep working; TUI-only widgets do not appear in MonoCode.
 */
export async function sendTurn(
  flavor: PiFlavor,
  input: SendTurnInput,
  imageMaterializer?: PiImageMaterializer,
): Promise<void> {
  return measureGenerationTurn(input, (measured) => sendMeasuredTurn(flavor, measured, imageMaterializer));
}

async function sendMeasuredTurn(flavor: PiFlavor, input: SendTurnInput, imageMaterializer?: PiImageMaterializer): Promise<void> {
  const { cancelledThreads } = stateFor(flavor);
  let live: Live;
  try {
    live = await ensureLive(flavor, input);
  } catch (error) {
    cancelledThreads.delete(input.sessionId);
    throw error;
  }
  if (cancelledThreads.delete(input.sessionId)) return;

  live.onEvent = input.onEvent;
  live.imageMaterializer = imageMaterializer;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      live.cancelled = false;
      live.muteUpdates = false;
      try {
        await runTurn(flavor, live, input);
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      }
    });
  await live.turns;
}

export async function compactContext(
  flavor: PiFlavor,
  input: CompactContextInput,
): Promise<void> {
  const state = stateFor(flavor);
  let live = state.liveByThread.get(input.sessionId);
  if (
    !live || live.cwd !== input.cwd ||
    (state.resumeByThread.get(input.sessionId)?.sessionPath &&
      !live.activeTurn && !live.compacting && !live.turnDone)
  ) {
    live = await ensureLive(flavor, input);
  } else {
    live.onEvent = input.onEvent;
    await applyModel(flavor, live, input);
  }
  if (state.cancelledThreads.delete(input.sessionId)) return;

  live.onEvent = input.onEvent;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      live.cancelled = false;
      live.muteUpdates = false;
      const response = await live.rpc.request(
        { type: "compact" },
        COMPACT_TIMEOUT_MS,
      );
      const data = asRecord(response.data);
      const used = data?.estimatedTokensAfter;
      if (typeof used === "number" && Number.isFinite(used) && used > 0) {
        live.onEvent({
          type: "context",
          used,
          ...(live.contextWindow ? { window: live.contextWindow } : {}),
        });
      }
    });
  await live.turns;
}

export async function rewindLastTurn(
  flavor: PiFlavor,
  input: RewindLastTurnInput,
): Promise<{ submitted: boolean }> {
  const state = stateFor(flavor);
  let live = state.liveByThread.get(input.sessionId);
  if (
    !live || live.cwd !== input.cwd ||
    (state.resumeByThread.get(input.sessionId)?.sessionPath &&
      !live.activeTurn && !live.compacting && !live.turnDone)
  ) {
    live = await ensureLive(flavor, input);
  } else {
    live.onEvent = input.onEvent;
    await applyModel(flavor, live, input);
  }
  if (live.activeTurn) {
    throw new Error("Stop the current turn before editing the last message");
  }

  const forkMessages = await live.rpc.request({ type: "get_fork_messages" });
  const messages = forkMessagesFromRpcData(forkMessages.data);
  const last = messages[messages.length - 1];
  if (!last) throw new Error("No user message to edit");

  const fork = await live.rpc.request({ type: "fork", entryId: last.entryId });
  if (asRecord(fork.data)?.cancelled === true) {
    throw new Error("Edit cancelled");
  }
  const forkState = await live.rpc.request({ type: "get_state" });
  const providerSessionId = providerSessionIdFromState(forkState.data);
  if (!providerSessionId) {
    throw new Error("Pi did not expose the forked session");
  }
  bindState(flavor, input.sessionId, live, forkState.data);
  live.onEvent({ type: "session.providerBound", providerSessionId });
  return { submitted: false };
}

export async function steerTurn(
  flavor: PiFlavor,
  input: SteerTurnInput,
): Promise<void> {
  const live = stateFor(flavor).liveByThread.get(input.sessionId);
  if (!live?.activeTurn) throw new Error("No active turn to steer");
  const message = input.text.trim();
  const buildCommand =
    message.startsWith("/")
      ? (input: Parameters<typeof buildPiPrompt>[0]) =>
          buildPiPrompt({ ...input, streaming: true })
      : buildPiSteer;
  const command = buildCommand({
    text: message,
    attachments: input.attachments,
  });
  if (!command.message && !Array.isArray(command.images)) return;
  const response = await live.rpc.request(command, message.startsWith("/") ? COMPACT_TIMEOUT_MS : 15_000);
  if (flavor.id === "pi" && asRecord(response.data)?.disposition === "handled")
    await syncPiState(flavor, input.sessionId, live, true);
}

export function respondApproval(
  flavor: PiFlavor,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  const live = stateFor(flavor).liveByThread.get(sessionId);
  const pending = live?.approvals.get(requestId);
  if (!pending) return;
  pending.resolve(decision);
}

export function respondQuestion(
  flavor: PiFlavor,
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  stateFor(flavor)
    .liveByThread.get(sessionId)
    ?.questions.get(requestId)
    ?.resolve(reply);
}

export async function cancelTurn(
  flavor: PiFlavor,
  sessionId: string,
): Promise<void> {
  const { liveByThread, cancelledThreads } = stateFor(flavor);
  const live = liveByThread.get(sessionId);
  if (!live) {
    cancelledThreads.add(sessionId);
    return;
  }
  resetGenerationMetrics(live.onEvent);
  live.cancelled = true;
  live.muteUpdates = true;
  live.settleToken += 1;
  for (const [, pending] of live.approvals) pending.resolve("deny");
  live.approvals.clear();
  for (const question of live.questions.values())
    question.resolve({ kind: "skipped" });
  live.questions.clear();
  await live.rpc.request({ type: "abort" }, 5_000).catch(() => undefined);
  finishActiveTurn(live, [
    { type: "message.completed" },
    { type: "reasoning.completed" },
  ]);
}

export async function stopSession(
  flavor: PiFlavor,
  sessionId: string,
): Promise<void> {
  const { liveByThread, cancelledThreads } = stateFor(flavor);
  cancelledThreads.delete(sessionId);
  const live = liveByThread.get(sessionId);
  liveByThread.delete(sessionId);
  if (live) {
    live.muteUpdates = true;
    live.settleToken += 1;
    for (const [, pending] of live.approvals) pending.resolve("deny");
    live.approvals.clear();
    for (const question of live.questions.values())
      question.resolve({ kind: "skipped" });
    live.questions.clear();
    live.activeTurn = false;
    live.turnDone?.();
    live.turnDone = null;
    live.turnFailed = null;
    live.rpc.close();
  }
  unwatchChild(sessionId);
  await killChild(sessionId).catch(() => undefined);
}

export async function forgetSession(
  flavor: PiFlavor,
  sessionId: string,
): Promise<void> {
  stateFor(flavor).resumeByThread.delete(sessionId);
  await stopSession(flavor, sessionId);
}

export function bindSession(
  flavor: PiFlavor,
  threadId: string,
  providerSessionId: string,
  cwd: string,
  sessionPath?: string,
): void {
  const sessionId = providerSessionId.trim();
  if (!threadId || !sessionId || !cwd.trim()) return;
  stateFor(flavor).resumeByThread.set(threadId, { sessionId, cwd, sessionPath });
}

async function ensureLive(
  flavor: PiFlavor,
  input: HarnessSessionInput,
): Promise<Live> {
  const { liveByThread, resumeByThread } = stateFor(flavor);
  let existing = liveByThread.get(input.sessionId);
  if (
    existing && resumeByThread.get(input.sessionId)?.sessionPath &&
    !existing.activeTurn && !existing.compacting && !existing.turnDone
  ) {
    await stopSession(flavor, input.sessionId);
    existing = undefined;
  }
  const wantPlanning = input.intent === "plan";
  if (
    existing &&
    existing.cwd === input.cwd &&
    existing.planning === wantPlanning &&
    existing.botContextKey === botContextKey(input.botContext)
  ) {
    existing.onEvent = input.onEvent;
    await applyModel(flavor, existing, input);
    return existing;
  }
  if (existing) {
    if (existing.cwd !== input.cwd) resumeByThread.delete(input.sessionId);
    await stopSession(flavor, input.sessionId);
  }

  const resume = resumeByThread.get(input.sessionId);
  const canResume = resume != null && resume.cwd === input.cwd;
  if (resume && resume.cwd !== input.cwd) {
    resumeByThread.delete(input.sessionId);
  }

  try {
    return await startLive(
      flavor,
      input,
      canResume ? (resume?.sessionPath ?? resume?.sessionId) : undefined,
      canResume && resume?.sessionPath ? resume.sessionId : undefined,
    );
  } catch (error) {
    if (!canResume || resume?.sessionPath) throw error;
    resumeByThread.delete(input.sessionId);
    await stopSession(flavor, input.sessionId);
    return startLive(flavor, input, undefined);
  }
}

async function startLive(
  flavor: PiFlavor,
  input: HarnessSessionInput,
  resume: string | undefined,
  expectedSessionId?: string,
): Promise<Live> {
  const state = stateFor(flavor);
  const { liveByThread } = state;
  const { path } = await state.resolveBinary();
  const native = nativeModelId(input.model);
  const modelRef = parsePiModelRef(native);
  const liveRef: { current: Live | null } = { current: null };

  const rpc = new PiRpc(
    input.sessionId,
    (rec) => {
      const current = liveRef.current;
      if (!current) return;
      handleFrame(flavor, input.sessionId, current, rec);
    },
    flavor.label,
  );

  const live: Live = {
    rpc,
    pendingImages: Promise.resolve(),
    imageIds: new Set(),
    cwd: input.cwd,
    providerSessionId: expectedSessionId ?? resume ?? "",
    nativeModel: native,
    thinking: flavor.id === "pi" ? "" : input.modelSettings?.thinking ?? "",
    fastModeEnabled: undefined,
    fastModeRequested: undefined,
    planning: input.intent === "plan",
    botContextKey: botContextKey(input.botContext),
    onEvent: input.onEvent,
    approvals: new Map(),
    questions: new Map(),
    promptId: null,
    nextApprovalUiId: 1,
    toolsByIndex: new Map(),
    toolsById: new Map(),
    cancelled: false,
    muteUpdates: false,
    compacting: false,
    retrying: false,
    settling: false,
    settleToken: 0,
    turns: Promise.resolve(),
    turnDone: null,
    turnFailed: null,
    turnEndPending: false,
    activeTurn: false,
    emittedAssistant: "",
    emittedReasoning: "",
    turnError: null,
  };
  liveRef.current = live;

  watchChild(
    input.sessionId,
    (line) => rpc.pushLine(line),
    (code) => {
      rpc.close(new Error(`${flavor.label} exited`));
      liveByThread.delete(input.sessionId);
      const current = liveRef.current;
      if (!current?.muteUpdates) {
        (current?.onEvent ?? input.onEvent)({ type: "session.ended", code });
      }
      if (current) {
        for (const question of current.questions.values())
          question.resolve({ kind: "skipped" });
        for (const approval of current.approvals.values())
          approval.resolve("deny");
      }
      current?.turnFailed?.(new Error(`${flavor.label} exited`));
      if (current) {
        current.turnDone = null;
        current.turnFailed = null;
      }
    },
    (line) => {
      console.debug(`[${flavor.id}]`, line);
    },
  );

  await spawnChild(
    input.sessionId,
    path,
    buildPiSpawnArgs(flavor, {
      resume,
      model: modelRef ? native : undefined,
      plan: input.intent === "plan",
      systemInstructions: input.botContext?.systemInstructions,
    }),
    input.cwd,
    undefined,
    flavor.id,
  );

  liveByThread.set(input.sessionId, live);

  try {
    const stateFrame = await rpc.request(
      { type: "get_state" },
      INIT_TIMEOUT_MS,
    );
    if (expectedSessionId && providerSessionIdFromState(stateFrame.data) !== expectedSessionId)
      throw new Error(`${flavor.label} did not resume the imported session`);
    bindState(flavor, input.sessionId, live, stateFrame.data);
    await applyModel(flavor, live, input);
    if (live.providerSessionId) {
      live.onEvent({
        type: "session.providerBound",
        providerSessionId: live.providerSessionId,
      });
    }
    live.onEvent({ type: "session.started" });
    return live;
  } catch (error) {
    await stopSession(flavor, input.sessionId);
    throw error;
  }
}

async function runTurn(
  flavor: PiFlavor,
  live: Live,
  input: SendTurnInput,
): Promise<void> {
  await applyModel(flavor, live, input);
  live.emittedAssistant = "";
  live.emittedReasoning = "";
  live.turnError = null;
  live.toolsByIndex.clear();
  live.toolsById.clear();
  live.imageIds.clear();
  live.pendingImages = Promise.resolve();
  live.compacting = false;
  live.retrying = false;
  live.settleToken += 1;
  live.settling = false;
  const promptId = `mc_turn_${crypto.randomUUID()}`;
  live.promptId = promptId;

  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  live.activeTurn = true;
  settlePendingTurn(live);

  try {
    const response = await Promise.race([
      live.rpc.request(
        {
          ...buildPiPrompt({
            text: input.text,
            attachments: input.attachments,
          }),
          id: promptId,
        },
        flavor.id === "omp" || input.text.trimStart().startsWith("/") ? COMPACT_TIMEOUT_MS : 15_000,
      ),
      turnPromise.then(() => null),
    ]);
    input.onAccepted?.();
    const disposition = asRecord(response?.data);
    if (
      (flavor.id === "omp" && disposition?.agentInvoked === false) ||
      (flavor.id === "pi" && disposition?.disposition === "handled")
    ) {
      await settleTurn(live, flavor, input.sessionId, flavor.id === "pi");
    }
    settlePendingTurn(live);
    await turnPromise;
  } catch (error) {
    if (live.cancelled) return;
    live.onEvent({
      type: "session.error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    live.activeTurn = false;
    live.promptId = null;
    live.rpc.cancelRequest(promptId);
    live.turnDone = null;
    live.turnFailed = null;
  }
}

/**
 * OMP's advisor and extensions interject mid-turn. Frames marked display:true
 * exist so clients can show them: structured advisor notes replace the raw
 * advisory envelope when present, and even a blank body stays a labeled
 * boundary so the segments around it never silently merge.
 */
function customMessageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) => {
      const record = asRecord(part);
      return record?.type === "text" && typeof record.text === "string"
        ? [record.text]
        : [];
    })
    .join("\n");
}

function interjectionFromCustomMessage(
  message: Record<string, unknown>,
): Extract<HarnessEvent, { type: "interjection" }> | undefined {
  if (message.display !== true) return undefined;
  const customType = stringField(message, "customType") ?? "custom";
  if (customType === "advisor") {
    const notes = asRecord(message.details)?.notes;
    const bodies: string[] = [];
    let severity: Extract<HarnessEvent, { type: "interjection" }>["severity"];
    if (Array.isArray(notes)) {
      for (const raw of notes) {
        const note = asRecord(raw);
        const body = stringField(note, "note");
        if (!body) continue;
        bodies.push(body);
        // Keep the highest severity the retained notes actually carry.
        const level = note?.severity;
        if (level === "blocker") severity = "blocker";
        else if (level === "concern" && severity !== "blocker") {
          severity = "concern";
        } else if (level === "nit" && !severity) severity = "nit";
      }
    }
    if (bodies.length > 0) {
      return {
        type: "interjection",
        text: bodies.join("\n\n"),
        customType,
        ...(severity ? { severity } : {}),
      };
    }
  }
  return {
    type: "interjection",
    text: customMessageText(message.content),
    customType,
  };
}

function emitPiAgentEvent(live: Live, event: HarnessEvent): void {
  if (event.type === "image.generated" && "data" in event) publishPiImage(live, event);
  else live.onEvent(event);
}

function publishPiImage(live: Live, image: RawImage): void {
  const key = `${image.agentCallId ?? "root"}:${image.itemId}`;
  if (live.imageIds.has(key)) return;
  live.imageIds.add(key);
  const materialize = live.imageMaterializer;
  if (!materialize) { live.onEvent(image); return; }
  const token = live.settleToken;
  live.pendingImages = live.pendingImages.then(async () => {
    if (live.cancelled || live.muteUpdates || live.settleToken !== token) return;
    try {
      const saved = await materialize(image);
      if (live.cancelled || live.muteUpdates || live.settleToken !== token) {
        await saved.discard().catch(() => undefined); return;
      }
      live.onEvent({ ...saved.event, ...(image.agentCallId ? { agentCallId: image.agentCallId } : {}) });
    } catch (error) {
      if (live.cancelled || live.muteUpdates || live.settleToken !== token) return;
      const message = `Could not save Pi image: ${error instanceof Error ? error.message : String(error)}`;
      live.onEvent(image.agentCallId
        ? { type: "agent.step", callId: image.agentCallId, stepId: `${image.itemId}:error`, kind: "message", text: message }
        : { type: "session.error", message });
    }
  });
}

function handleFrame(
  flavor: PiFlavor,
  sessionId: string,
  live: Live,
  rec: Record<string, unknown>,
): void {
  if (flavor.id === "omp" && rec.type === "available_commands_update") {
    try {
      live.availableCommands = ompCommandsFromRpcData(rec);
      const listeners = stateFor(flavor).commandListeners.get(
        commandContextKey({ sessionId, cwd: live.cwd }),
      );
      for (const listener of listeners ?? []) listener(live.availableCommands);
    } catch {
      // Preserve the last valid inventory when a runtime emits a malformed update.
    }
    return;
  }
  if (
    flavor.id === "omp" &&
    rec.type === "extension_ui_request" &&
    rec.method === "cancel"
  ) {
    for (const question of live.questions.values()) {
      if (question.id === rec.id) question.resolve({ kind: "skipped" });
    }
    return;
  }
  const ui = parseExtensionUiRequest(rec);
  if (ui) {
    void handleExtensionUi(flavor, sessionId, live, ui);
    return;
  }
  if (live.muteUpdates) return;

  const type = stringField(rec, "type");
  if (flavor.id === "pi" && type === "thinking_level_changed" && isPiThinkingLevel(rec.level as string)) {
    live.thinking = rec.level as PiThinkingLevel;
    publishPiThinking(live);
    return;
  }
  if (flavor.id === "omp") {
    // OMP emits persisted custom_message entries on the live RPC stream as a
    // message_start/message_end pair. Render the start once; consume the end
    // and hidden custom messages so none can leak through a generic path.
    if (type === "message_start" || type === "message_end") {
      const message = asRecord(rec.message);
      if (message?.role === "custom") {
        if (type === "message_start") {
          const interjection = interjectionFromCustomMessage(message);
          if (interjection) live.onEvent(interjection);
        }
        return;
      }
    }
    if (type === "advisor_yielded") {
      live.onEvent({ type: "status", text: "Advisor reviewed this turn" });
      return;
    }
    if (type === "session_info_update") {
      const providerSessionId = stringField(rec, "sessionId");
      if (providerSessionId) {
        bindState(flavor, sessionId, live, { sessionId: providerSessionId });
        live.onEvent({ type: "session.providerBound", providerSessionId });
      }
      const title = stringField(rec, "sessionName") ?? stringField(rec, "name") ?? stringField(rec, "title");
      if (title && live.providerSessionId) live.onEvent({ type: "session.titleUpdated", providerSessionId: live.providerSessionId, title });
      return;
    }
    if (type === "config_update") {
      const model = asRecord(rec.model);
      const provider = stringField(model, "provider");
      const modelId = stringField(model, "id");
      const thinking = stringField(rec, "thinkingLevel");
      const fastModeEnabled =
        typeof rec.fastModeEnabled === "boolean"
          ? rec.fastModeEnabled
          : undefined;
      const native =
        provider && modelId ? piNativeId(provider, modelId) : undefined;
      if (native) live.nativeModel = native;
      if (isPiThinkingLevel(thinking)) live.thinking = thinking;
      if (fastModeEnabled != null) {
        live.fastModeEnabled = fastModeEnabled;
        live.fastModeRequested = fastModeEnabled;
      }
      live.onEvent({
        type: "session.configChanged",
        ...(native ? { model: `${flavor.id}:${native}` } : {}),
        ...(isPiThinkingLevel(thinking) || fastModeEnabled != null
          ? {
              modelSettings: {
                ...(isPiThinkingLevel(thinking) ? { thinking } : {}),
                ...(fastModeEnabled != null
                  ? { fast: String(fastModeEnabled) }
                  : {}),
              },
            }
          : {}),
      });
      return;
    }
    if (type === "command_output") {
      const text = stringField(rec, "text");
      if (text)
        live.onEvent({
          type: "status",
          text: extensionUiTitle({
            id: "output",
            method: "notify",
            title: text,
          }),
        });
      return;
    }
    if (type === "prompt_result") {
      if (
        live.activeTurn &&
        rec.id === live.promptId &&
        rec.agentInvoked === false
      ) {
        finishActiveTurn(live, [
          { type: "message.completed" },
          { type: "reasoning.completed" },
        ]);
      }
      return;
    }
    // OMP can acknowledge a prompt and later report an asynchronous error.
    if (
      type === "response" &&
      rec.command === "prompt" &&
      rec.id === live.promptId &&
      rec.success === false
    ) {
      live.turnFailed?.(
        new Error(stringField(rec, "error") ?? "OMP command failed"),
      );
      return;
    }
    if (type === "agent_end" && rec.isTerminal === false) return;
  }
  if (type === "message_start") generationRequestStarted(live.onEvent);
  if (type === "compaction_start" || type === "auto_retry_start") resetGenerationMetrics(live.onEvent);
  if (type === "compaction_start") live.compacting = true;
  if (type === "compaction_end") live.compacting = false;
  if (type === "auto_retry_start") live.retrying = true;
  if (type === "auto_retry_end") live.retrying = false;

  const status = statusFromPiEvent(rec);
  if (status) live.onEvent({ type: "status", text: status });

  const turnError = turnErrorFromEvent(rec);
  if (turnError !== null) live.turnError = turnError;

  const context = contextFromUsage(rec, live.contextWindow);
  if (context) live.onEvent({ type: "context", ...context });
  const metrics = turnMetricsFromUsage(rec);
  if (metrics) live.onEvent({ type: "turn.metrics", ...metrics });
  if (type === "message_end" && metrics) {
    reportGenerationUsage(live.onEvent, { outputTokens: metrics.outputTokens });
  }

  const delta = assistantDeltaFromEvent(rec);
  if (delta) {
    if (delta.kind === "text") {
      live.emittedAssistant += delta.text;
      emitGenerationText(live.onEvent, delta.text);
    } else {
      live.emittedReasoning += delta.text;
      live.onEvent({ type: "reasoning.delta", text: delta.text });
    }
  }

  const started = toolCallStartFromEvent(rec);
  if (started) {
    upsertTool(live, started.id, started.name, {}, started.index);
  }

  const jsonDelta = toolCallDeltaFromEvent(rec);
  if (jsonDelta) {
    const tool = live.toolsByIndex.get(jsonDelta.index);
    if (tool) {
      tool.partialJson += jsonDelta.delta;
      const parsed = tryParseJsonRecord(tool.partialJson);
      if (parsed) updateTool(live, tool, parsed);
    }
  }

  const ended = toolCallEndFromEvent(rec);
  if (ended) {
    upsertTool(live, ended.id, ended.name, ended.input);
  }

  const execStart = toolExecutionStartFromEvent(rec);
  if (execStart) {
    upsertTool(live, execStart.id, execStart.name, execStart.input);
    const tool = live.toolsById.get(execStart.id);
    if (tool) {
      live.onEvent({
        type: "tool.updated",
        callId: tool.id,
        title: tool.title,
        kind: toolKindFromName(tool.name),
        status: "running",
        preview: previewFromTool(tool.name, tool.input),
      });
    }
  }

  const execUpdate = toolExecutionUpdateFromEvent(rec);
  if (execUpdate) {
    const tool = live.toolsById.get(execUpdate.id);
    // omp can deliver an update after the tool's end (omp#12875, steer during
    // bash); replaying it would flip the finished card back to "running".
    if (tool && !tool.finished) {
      if (Object.keys(execUpdate.input).length > 0) {
        tool.input = mergeToolInput(tool.input, execUpdate.input);
        tool.title = toolTitle(tool.name, tool.input);
      }
      live.onEvent({
        type: "tool.updated",
        callId: tool.id,
        title: tool.title,
        kind: toolKindFromName(tool.name),
        status: "running",
        detail: execUpdate.detail,
        preview: previewFromTool(tool.name, tool.input, execUpdate.detail),
      });
      if (toolKindFromName(tool.name) === "agent") {
        for (const event of piSubagentEvents(tool.id, tool.input, rec.partialResult, false)) emitPiAgentEvent(live, event);
      }
    }
  }

  const execEnd = toolExecutionEndFromEvent(rec);
  if (execEnd) {
    const tool = live.toolsById.get(execEnd.id);
    if (tool) {
      tool.finished = true;
      live.onEvent({
        type: "tool.updated",
        callId: tool.id,
        title: tool.title,
        kind: toolKindFromName(tool.name),
        status: execEnd.isError ? "failed" : "completed",
        detail: execEnd.detail,
        preview: previewFromTool(tool.name, tool.input, execEnd.detail),
      });
      if (toolKindFromName(tool.name) === "agent") {
        for (const event of piSubagentEvents(tool.id, tool.input, rec.result, true, execEnd.isError)) emitPiAgentEvent(live, event);
      }
    }
  }

  if (flavor.id === "pi" && execEnd) {
    const result = toolImagesFromEvent(rec);
    for (const message of result.errors) live.onEvent({ type: "session.error", message });
    for (const image of result.images) publishPiImage(live, image);
  }

  if (isAgentSettled(rec)) {
    flushTurnError(flavor, live);
    void settleTurn(live, flavor, sessionId);
    return;
  }
  const willRetry = agentEndWillRetry(rec);
  // The retry carries the real answer, so the attempt it replaces stays quiet.
  if (willRetry === true) live.turnError = null;
  // Pi's agent_end is only a low-level attempt; queued/automatic work can
  // follow. Pi 1.0.1 reports actual idle through agent_settled.
  if (flavor.id === "omp" && willRetry === false && !live.compacting && !live.retrying) {
    flushTurnError(flavor, live);
    void settleTurn(live, flavor, sessionId);
  }
}

function flushTurnError(flavor: PiFlavor, live: Live): void {
  const message = live.turnError;
  if (message === null) return;
  live.turnError = null;
  live.onEvent({
    type: "session.error",
    message: message || `${flavor.label} turn failed`,
  });
}

async function settleTurn(live: Live, flavor: PiFlavor, sessionId: string, forceModelRefresh = false): Promise<void> {
  if (live.settling || live.cancelled || live.muteUpdates) return;
  if (!live.activeTurn && !live.turnDone) return;
  live.settling = true;
  const token = live.settleToken;
  try {
    await syncPiState(flavor, sessionId, live, forceModelRefresh);
    const stats = await live.rpc.request(
      { type: "get_session_stats" },
      STATS_TIMEOUT_MS,
    );
    if (live.settleToken === token && !live.cancelled) {
      const context = contextFromSessionStats(stats.data);
      if (context) live.onEvent({ type: "context", ...context });
    }
  } catch {
    // meter stays on the last streamed usage
  }
  await live.pendingImages;
  if (live.settleToken === token && !live.cancelled) {
    finishActiveTurn(live, [
      { type: "message.completed" },
      { type: "reasoning.completed" },
    ]);
  }
  if (live.settleToken === token) live.settling = false;
}

async function handleExtensionUi(
  flavor: PiFlavor,
  sessionId: string,
  live: Live,
  request: PiExtensionUiRequest,
): Promise<void> {
  if (!needsExtensionUiReply(request)) {
    const text = request.title ? extensionUiTitle(request) : "";
    if (request.method === "setStatus" && request.statusKey)
      live.onEvent({ type: "status", key: request.statusKey, text });
    else if (text.trim()) live.onEvent({ type: "status", text });
    return;
  }

  if (live.cancelled || live.muteUpdates) {
    await writeChild(
      sessionId,
      JSON.stringify(extensionUiResponse(request, "deny")),
    ).catch(() => undefined);
    return;
  }

  if ([...live.questions.values()].some(question => question.id === request.id) ||
      [...live.approvals.values()].some(approval => approval.request.id === request.id)) return;

  if (request.method === "select" || request.method === "input" || request.method === "editor") {
    const uiId = flavor.id === "pi" ? stateFor(flavor).nextInteractionId++ : live.nextApprovalUiId++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const replyPromise = new Promise<UserQuestionReply>((resolve) => {
      live.questions.set(uiId, { id: request.id, resolve });
      if (request.timeout != null) timer = setTimeout(() => resolve({ kind: "skipped" }), request.timeout);
    });
    const input = flavor.id === "pi" && (request.method === "input" || request.method === "editor")
      ? { kind: request.method === "editor" ? "multiline" as const : "text" as const,
          initialValue: request.prefill ?? "", placeholder: request.placeholder,
          preserveWhitespace: true, allowEmpty: true, maxLength: 10_000 }
      : undefined;
    live.onEvent({
      type: "question.asked", requestId: uiId, title: extensionUiTitle(request),
      ...(request.timeout != null ? { autoResolveAt: Date.now() + request.timeout } : {}),
      questions: [{ id: request.id, prompt: extensionUiTitle(request), multiSelect: false,
        allowCustom: request.method !== "select", ...(input ? { input } : {}),
        options: request.method === "select" ? request.options.map((label, index) => ({
          id: String(index), label: extensionUiTitle({ id: request.id, method: "notify", title: label }),
        })) : [],
      }],
    });
    const reply = await replyPromise;
    clearTimeout(timer);
    live.questions.delete(uiId);
    // A stopped process may have been replaced by a new session using the same UI ids.
    if (stateFor(flavor).liveByThread.get(sessionId) !== live) return;
    let value: string | undefined;
    if (reply.kind === "answered") {
      if (request.method === "select") {
        const selected = reply.answers[request.id]?.[0];
        if (selected !== undefined && /^\d+$/.test(selected)) value = request.options[Number(selected)];
      } else {
        const candidate = reply.custom?.[request.id];
        if (typeof candidate === "string" && candidate.length <= 10_000) value = candidate;
        else if (typeof candidate === "string") live.onEvent({ type: "session.error", message: "Pi extension answer exceeds 10000 characters" });
      }
    }
    live.onEvent({ type: "question.resolved", requestId: uiId,
      decision: value === undefined ? "skipped" : "answered",
      ...(value !== undefined && reply.kind === "answered" ? { reply } : {}) });
    await writeChild(sessionId, JSON.stringify({ type: "extension_ui_response", id: request.id,
      ...(value === undefined ? { cancelled: true } : { value }),
    })).catch(() => undefined);
    return;
  }

  const uiId = flavor.id === "pi" ? stateFor(flavor).nextInteractionId++ : live.nextApprovalUiId++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const decisionPromise = new Promise<ApprovalDecision>((resolve) => {
    live.approvals.set(uiId, { request, resolve });
    if (request.timeout != null) timer = setTimeout(() => resolve("deny"), request.timeout);
  });
  live.onEvent({ type: "approval.requested", requestId: uiId, title: extensionUiTitle(request), kind: "other" });
  const decision = await decisionPromise;
  clearTimeout(timer);
  live.approvals.delete(uiId);
  if (stateFor(flavor).liveByThread.get(sessionId) !== live) return;
  live.onEvent({ type: "approval.resolved", requestId: uiId, decision });
  await writeChild(sessionId, JSON.stringify(extensionUiResponse(request, decision))).catch(() => undefined);
}

async function applyModel(
  flavor: PiFlavor,
  live: Live,
  input: HarnessSessionInput,
): Promise<void> {
  const native = nativeModelId(input.model);
  const ref = parsePiModelRef(native);
  if (ref && native !== live.nativeModel) {
    const result = await live.rpc.request({
      type: "set_model",
      provider: ref.provider,
      modelId: ref.modelId,
    });
    live.nativeModel = native;
    const model = asRecord(result.data);
    const window =
      model && typeof model.contextWindow === "number"
        ? model.contextWindow
        : undefined;
    if (window && window > 0) live.contextWindow = window;
    if (flavor.id === "pi") {
      // Model selection can also change the native thinking level.
      const state = await live.rpc.request({ type: "get_state" }, STATS_TIMEOUT_MS);
      bindState(flavor, input.sessionId, live, state.data);
    }
  } else if (ref) {
    live.nativeModel = native;
  }

  if (flavor.id === "pi") await refreshPiThinking(live);
  const thinking = input.modelSettings?.thinking;
  if (isPiThinkingLevel(thinking) && thinking !== live.thinking &&
      (flavor.id !== "pi" || live.thinkingLevels?.length)) {
    const update = live.rpc.request({ type: "set_thinking_level", level: thinking });
    if (flavor.id === "pi") {
      try {
        await update;
        // Pi clamps stale/default choices to the active model's capabilities.
        // Its response is only an acknowledgement, so read the effective value
        // instead of overwriting a native thinking_level_changed event.
        const state = await live.rpc.request({ type: "get_state" }, STATS_TIMEOUT_MS);
        bindState(flavor, input.sessionId, live, state.data);
      }
      catch (error) { publishPiThinking(live); throw error; }
    } else {
      await update.catch(() => undefined);
      live.thinking = thinking;
    }
    if (flavor.id === "pi") publishPiThinking(live);
  }

  const fast = input.modelSettings?.fast;
  if (
    flavor.id === "omp" &&
    (fast === "true" || fast === "false") &&
    (fast === "true") !== live.fastModeRequested
  ) {
    const enabled = fast === "true";
    live.fastModeRequested = enabled;
    try {
      const response = await live.rpc.request({
        type: "set_fast_mode",
        enabled,
      });
      const data = asRecord(response.data);
      live.fastModeEnabled =
        typeof data?.enabled === "boolean" ? data.enabled : enabled;
    } catch (error) {
      if (enabled) {
        live.fastModeEnabled = false;
        live.onEvent({
          type: "session.configChanged",
          modelSettings: { fast: "false" },
        });
        live.onEvent({
          type: "status",
          text:
            error instanceof Error
              ? error.message
              : "Fast mode is unavailable for the current model.",
        });
      }
    }
  }

  if (
    flavor.id === "pi" &&
    parsePiModelRef(live.nativeModel) &&
    input.model !== `pi:${live.nativeModel}` &&
    stateFor(flavor).liveByThread.get(input.sessionId) === live &&
    !live.muteUpdates
  ) {
    live.onEvent({ type: "session.configChanged", model: `pi:${live.nativeModel}` });
  }
}

async function syncPiState(flavor: PiFlavor, sessionId: string, live: Live, force = false): Promise<void> {
  if (flavor.id !== "pi" || live.cancelled || live.muteUpdates) return;
  const token = live.settleToken;
  try {
    const response = await live.rpc.request({ type: "get_state" }, STATS_TIMEOUT_MS);
    if (live.cancelled || live.muteUpdates || live.settleToken !== token || stateFor(flavor).liveByThread.get(sessionId) !== live) return;
    bindState(flavor, sessionId, live, response.data);
    if (force) live.thinkingLevelsModel = undefined;
    await refreshPiThinking(live);
    if (live.settleToken === token && !live.muteUpdates && parsePiModelRef(live.nativeModel))
      live.onEvent({ type: "session.configChanged", model: `pi:${live.nativeModel}` });
  } catch {
    if (live.settleToken === token && !live.muteUpdates)
      live.onEvent({ type: "status", text: "Pi session state could not be refreshed" });
  }
}

function publishPiThinking(live: Live): void {
  if (live.muteUpdates || !parsePiModelRef(live.nativeModel)) return;
  const model = `pi:${live.nativeModel}`;
  const levels = live.thinkingLevels;
  const setting = thinkingSetting(true)!;
  live.onEvent({ type: "session.configChanged",
    ...(isPiThinkingLevel(live.thinking) ? { modelSettings: { thinking: live.thinking } } : {}),
    ...(levels && live.thinkingLevelsModel === live.nativeModel ? { modelSettingOptions: { model,
      settings: levels.length ? [{ ...setting, value: live.thinking || levels[0]!,
        options: setting.options.filter(option => levels.includes(option.value as PiThinkingLevel)) }] : [],
    } } : {}),
  });
}

async function refreshPiThinking(live: Live): Promise<void> {
  if (!parsePiModelRef(live.nativeModel) || live.thinkingLevelsModel === live.nativeModel) return;
  const model = live.nativeModel;
  let levels: PiThinkingLevel[] = [];
  try {
    const response = await live.rpc.request({ type: "get_available_thinking_levels" }, STATS_TIMEOUT_MS);
    const raw = asRecord(response.data)?.levels;
    if (!Array.isArray(raw)) throw new Error("Pi did not return thinking levels");
    levels = [...new Set(raw.filter((level): level is PiThinkingLevel => typeof level === "string" && isPiThinkingLevel(level)))];
    if (!levels.length) throw new Error("Pi returned no supported thinking levels");
  } catch {
    if (!live.muteUpdates) live.onEvent({ type: "status", text: "Pi thinking choices are unavailable; keeping the current provider setting" });
  }
  if (live.muteUpdates || live.nativeModel !== model) return;
  live.thinkingLevels = levels;
  live.thinkingLevelsModel = model;
  publishPiThinking(live);
}

function bindState(
  flavor: PiFlavor,
  sessionId: string,
  live: Live,
  data: unknown,
): void {
  const state = sessionFromState(data);
  const providerSessionId = providerSessionIdFromState(data);
  if (state.contextWindow) live.contextWindow = state.contextWindow;
  if (providerSessionId) {
    live.providerSessionId = providerSessionId;
    const resume = stateFor(flavor).resumeByThread.get(sessionId);
    stateFor(flavor).resumeByThread.set(sessionId, {
      sessionId: providerSessionId,
      sessionPath: resume?.sessionPath && resume.sessionId === providerSessionId
        ? stringField(asRecord(data), "sessionFile") ?? resume.sessionPath : undefined,
      cwd: live.cwd,
    });
  }
  const model = asRecord(asRecord(data)?.model);
  const provider = stringField(model, "provider");
  const modelId = stringField(model, "id");
  if (provider && modelId && (flavor.id === "pi" || !live.nativeModel)) {
    live.nativeModel = piNativeId(provider, modelId);
  }
  const thinking = asRecord(data)?.thinkingLevel;
  if (flavor.id === "pi" && typeof thinking === "string" && isPiThinkingLevel(thinking)) live.thinking = thinking;
  const fastModeEnabled = asRecord(data)?.fastModeEnabled;
  if (flavor.id === "omp" && typeof fastModeEnabled === "boolean") {
    live.fastModeEnabled = fastModeEnabled;
    live.fastModeRequested = fastModeEnabled;
  }
}

function upsertTool(
  live: Live,
  id: string,
  name: string,
  input: Record<string, unknown>,
  index?: number,
): void {
  let tool = live.toolsById.get(id);
  if (!tool) {
    tool = {
      id,
      name,
      input,
      partialJson: "",
      title: toolTitle(name, input),
    };
    live.toolsById.set(id, tool);
    live.onEvent({
      type: "tool.started",
      callId: id,
      title: tool.title,
      kind: toolKindFromName(name),
      status: "pending",
      preview: previewFromTool(name, input),
    });
    emitTaskListIfNeeded(live, tool);
  } else if (Object.keys(input).length > 0) {
    updateTool(live, tool, input);
  }
  if (index != null && index >= 0) live.toolsByIndex.set(index, tool);
}

function updateTool(
  live: Live,
  tool: InFlightTool,
  input: Record<string, unknown>,
): void {
  tool.input = mergeToolInput(tool.input, input);
  tool.title = toolTitle(tool.name, tool.input);
  live.onEvent({
    type: "tool.updated",
    callId: tool.id,
    title: tool.title,
    kind: toolKindFromName(tool.name),
    status: "pending",
    detail: summarizeToolRequest(tool.name, tool.input),
    preview: previewFromTool(tool.name, tool.input),
  });
  emitTaskListIfNeeded(live, tool);
}

function emitTaskListIfNeeded(live: Live, tool: InFlightTool): void {
  const items = taskListFromToolInput(tool.name, tool.input);
  if (items) live.onEvent({ type: "tasks.updated", items });
}

function finishActiveTurn(live: Live, extraEvents: HarnessEvent[] = []): void {
  if (!live.activeTurn && !live.turnDone) return;
  live.turnEndPending = false;
  live.activeTurn = false;
  for (const event of extraEvents) live.onEvent(event);
  const done = live.turnDone;
  const failed = live.turnFailed;
  live.turnDone = null;
  live.turnFailed = null;
  if (done) {
    done();
    return;
  }
  if (!failed) live.turnEndPending = true;
}

function settlePendingTurn(live: Live): void {
  if (!live.turnEndPending || !live.turnDone) return;
  finishActiveTurn(live);
}

export async function readFamilySessionTitle(flavor: PiFlavor, input: import("../../core/titleCoordinator").NativeTitleInput): Promise<string | null> {
  const live = stateFor(flavor).liveByThread.get(input.sessionId);
  if (!live || live.cwd !== input.cwd) return null;
  const frame = await live.rpc.request({ type: "get_state" }, 5_000);
  if (providerSessionIdFromState(frame.data) !== input.providerSessionId) return null;
  const data = asRecord(frame.data);
  return typeof data?.sessionName === "string" ? data.sessionName : null;
}
