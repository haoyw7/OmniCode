import type {
  Block,
  HarnessId,
  NativeSessionLink,
  TaskListMeta,
  TurnIntent,
} from "../../../features/sessions/model/session";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PrContent } from "../../../features/source-control/model/gitText";
import { beginCatalogLoad, hasFreshCatalog, setHarnessModels, type AgentModel } from "../../../features/sessions/model/models";
import type { HarnessCatalogModel } from "./catalog";
import type { UserQuestionReply } from "../../../features/sessions/model/userQuestion";
import { translate } from "../../../shared/i18n/language";
import { generateTextBranchName } from "./branchName";
import type { NativeCommandProvider } from "./nativeCommands";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  RewindLastTurnInput,
  RewindLastTurnResult,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

/** One-shot text generation for side questions and other provider helpers. */
export type TextPromptInput = {
  cwd: string;
  providerAccountId?: string;
  model?: string;
  modelSettings?: Record<string, string>;
  /** Codex defaults to unsaved threads; false allows resumable side questions. */
  ephemeral?: boolean;
  threadId?: string;
  onThreadId?: (threadId: string) => void;
  intent?: TurnIntent;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
};

/**
 * Lifecycle contract for a live harness adapter.
 * App.tsx dispatches through the registry instead of harness-specific branches.
 */
export type HarnessAdapter = {
  readSessionTitle?(input: import("./titleCoordinator").NativeTitleInput): Promise<string | null>;
  id: HarnessId;
  /** True when this adapter can run live turns. */
  live: boolean;
  /** False when the harness cannot accept a follow-up while a turn is running. Default: same as live. */
  canSteer?: boolean;
  commands?: NativeCommandProvider;
  sendTurn(input: SendTurnInput): Promise<void>;
  /** Trigger provider-owned compaction outside OmniCode's normal user-turn path. */
  compactContext?(input: CompactContextInput): Promise<void>;
  /** Rewind provider state so the last user turn can be replaced. */
  rewindLastTurn?(input: RewindLastTurnInput): Promise<RewindLastTurnResult>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  cancelTurn(sessionId: string): Promise<void>;
  stopBackgroundTask?(sessionId: string, taskId: string): Promise<void>;
  respondApproval(
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ): void;
  respondQuestion?(
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ): void;
  /** Keep a timed question open once the user starts answering it. */
  keepQuestionOpen?(sessionId: string, requestId: number): void;
  /** Kill the child but keep resume state for later rebind. */
  stopSession(sessionId: string): Promise<void>;
  /** Drop resume state and kill the child (delete, harness switch, idle detach). */
  forgetSession(sessionId: string): Promise<void>;
  /** Seed resume state from a restored OmniCode session. */
  bindSession(
    threadId: string,
    providerSessionId: string,
    cwd: string,
    providerAccountId?: string,
    nativeSession?: NativeSessionLink,
  ): void;
  /** Seed provider task state from a restored session's persisted panels. */
  restoreTaskLists?(threadId: string, lists: TaskListMeta[]): void;
  /** Refresh the model catalog overlay when supported. */
  refreshCatalog?(): Promise<void | HarnessCatalogModel[]>;
  /** Optional LLM commit message from staged changes. */
  generateCommitMessage?(cwd: string, signal?: AbortSignal): Promise<string>;
  /** Optional LLM pull request title/body from branch diff context. */
  generatePrContent?(
    cwd: string,
  ): Promise<(PrContent & { base: string; head: string }) | null>;
  /** Optional LLM branch name from a user message. */
  generateBranchName?(cwd: string, message: string): Promise<string | null>;
  /** Optional warmup for text-generation backends. */
  warmupText?(cwd: string): Promise<void>;
  /** Run an isolated, read-only prompt without mutating the main session. */
  runTextPrompt?(input: TextPromptInput): Promise<string>;
  /** Stop an isolated text-generation backend. */
  stopTextPrompt?(): Promise<void>;
};

const adapters = new Map<HarnessId, HarnessAdapter>();

/** Publish provider discovery through the registry's existing model-store boundary. */
export function publishHarnessCatalog(harness: HarnessId, models: AgentModel[]): void {
  if (models.length) setHarnessModels(harness, models);
}

/**
 * After a turn settles, keep the child warm for follow-ups, then park it.
 * Resume state stays, so the next prompt respawns instead of starting over.
 */
export const HARNESS_IDLE_PARK_MS = 5 * 60_000;
const idleParkTimers = new Map<string, ReturnType<typeof setTimeout>>();
const sessionOperationTails = new Map<string, Promise<void>>();
const sessionSteerTails = new Map<string, Promise<void>>();
const activeTurnSessions = new Set<string>();

function queueSessionOperation<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = sessionOperationTails.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  sessionOperationTails.set(sessionId, settled);
  void settled.then(() => {
    if (sessionOperationTails.get(sessionId) === settled) {
      sessionOperationTails.delete(sessionId);
    }
  });
  return current;
}

function queueSteerOperation<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previousSteer = sessionSteerTails.get(sessionId) ?? Promise.resolve();
  // A live turn must remain steerable while its long-running send is pending.
  // Other provider-state operations still form a barrier for the steer.
  const barrier = activeTurnSessions.has(sessionId)
    ? Promise.resolve()
    : (sessionOperationTails.get(sessionId) ?? Promise.resolve());
  const current = Promise.all([
    previousSteer.catch(() => undefined),
    barrier.catch(() => undefined),
  ]).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  sessionSteerTails.set(sessionId, settled);
  void settled.then(() => {
    if (sessionSteerTails.get(sessionId) === settled) {
      sessionSteerTails.delete(sessionId);
    }
  });
  return current;
}

function cancelIdlePark(sessionId: string): void {
  const timer = idleParkTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  idleParkTimers.delete(sessionId);
}

function scheduleIdlePark(harness: HarnessId, sessionId: string): void {
  cancelIdlePark(sessionId);
  idleParkTimers.set(
    sessionId,
    setTimeout(() => {
      idleParkTimers.delete(sessionId);
      void stopHarnessSession(harness, sessionId);
    }, HARNESS_IDLE_PARK_MS),
  );
}

/** Test seam. */
export function resetHarnessIdlePark(): void {
  for (const timer of idleParkTimers.values()) clearTimeout(timer);
  idleParkTimers.clear();
}

export function registerHarness(adapter: HarnessAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getHarness(id: HarnessId): HarnessAdapter | undefined {
  return adapters.get(id);
}

export function requireHarness(id: HarnessId): HarnessAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`No harness adapter registered for "${id}"`);
  }
  return adapter;
}

export function isLiveHarness(id: HarnessId): boolean {
  return adapters.get(id)?.live === true;
}

export function listHarnesses(): HarnessAdapter[] {
  return [...adapters.values()];
}

export function sendHarnessTurn(input: SendTurnInput & { harness: HarnessId }) {
  return queueSessionOperation(input.sessionId, async () => {
    const adapter = requireHarness(input.harness);
    if (!adapter.live) {
      throw new Error(`${input.harness} is not connected yet`);
    }
    cancelIdlePark(input.sessionId);
    const controlled = typeof isTauri === "function" && isTauri();
    if (controlled)
      await invoke("control_authorize_turn", {
        sessionId: input.sessionId,
        cwd: input.cwd,
        appAccess: input.appAccess === true,
      });
    activeTurnSessions.add(input.sessionId);
    try {
      assertHostNative(input);
      await adapter.sendTurn(input);
    } finally {
      activeTurnSessions.delete(input.sessionId);
      if (controlled)
        await invoke("control_turn_finished", { sessionId: input.sessionId });
      scheduleIdlePark(input.harness, input.sessionId);
    }
  });
}

/** Native conversations run on the Host under its writer lease, never in this process. */
function assertHostNative(input: { nativeSession?: NativeSessionLink }): void {
  if (input.nativeSession)
    throw new Error(translate("Native session ownership cannot be verified on this platform"));
}

export function canCompactHarnessContext(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.compactContext != null;
}

export function compactHarnessContext(
  input: CompactContextInput & { harness: HarnessId },
): Promise<void> {
  return queueSessionOperation(input.sessionId, async () => {
    const adapter = requireHarness(input.harness);
    if (!adapter.live) {
      throw new Error(`${input.harness} is not connected yet`);
    }
    if (!adapter.compactContext) {
      throw new Error(`${input.harness} does not support manual compaction`);
    }
    cancelIdlePark(input.sessionId);
    try {
      assertHostNative(input);
      await adapter.compactContext(input);
    } finally {
      scheduleIdlePark(input.harness, input.sessionId);
    }
  });
}

export function canSteerHarness(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  if (!adapter?.live) return false;
  return adapter.canSteer !== false;
}

export function canRewindHarnessLastTurn(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.rewindLastTurn != null;
}

export function rewindHarnessLastTurn(
  input: RewindLastTurnInput & { harness: HarnessId },
): Promise<RewindLastTurnResult> {
  return queueSessionOperation(input.sessionId, async () => {
    const adapter = requireHarness(input.harness);
    if (!adapter.rewindLastTurn) {
      throw new Error(
        `${input.harness} does not support editing the last message`,
      );
    }
    cancelIdlePark(input.sessionId);
    try {
      assertHostNative(input);
      return await adapter.rewindLastTurn(input);
    } finally {
      scheduleIdlePark(input.harness, input.sessionId);
    }
  });
}

export function steerHarnessTurn(
  input: SteerTurnInput & { harness: HarnessId },
): Promise<void> {
  return queueSteerOperation(input.sessionId, async () => {
    const adapter = requireHarness(input.harness);
    if (!adapter.live) {
      throw new Error(`${input.harness} is not connected yet`);
    }
    cancelIdlePark(input.sessionId);
    assertHostNative(input);
    await adapter.steerTurn(input);
  });
}

export function canStopHarnessBackgroundTask(harness: HarnessId): boolean {
  return !!getHarness(harness)?.stopBackgroundTask;
}

export async function stopHarnessBackgroundTask(harness: HarnessId, sessionId: string, taskId: string): Promise<void> {
  const adapter = requireHarness(harness);
  if (!adapter.stopBackgroundTask) throw new Error("Stopping background tasks is unavailable for this provider.");
  await adapter.stopBackgroundTask(sessionId, taskId);
}

export async function cancelHarnessTurn(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  cancelIdlePark(sessionId);
  await adapter.cancelTurn(sessionId);
  scheduleIdlePark(harness, sessionId);
}

export function respondHarnessApproval(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  getHarness(harness)?.respondApproval(sessionId, requestId, decision);
}

export function respondHarnessQuestion(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  getHarness(harness)?.respondQuestion?.(sessionId, requestId, reply);
}

export function keepHarnessQuestionOpen(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
): void {
  getHarness(harness)?.keepQuestionOpen?.(sessionId, requestId);
}

export async function stopHarnessSession(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  cancelIdlePark(sessionId);
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  await adapter.stopSession(sessionId);
}

export async function forgetHarnessSession(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  cancelIdlePark(sessionId);
  const adapter = getHarness(harness);
  if (!adapter) return;
  await adapter.forgetSession(sessionId);
}

export function bindHarnessSession(
  harness: HarnessId,
  threadId: string,
  providerSessionId: string,
  cwd: string,
  providerAccountId?: string,
  /** Restored transcript, so the adapter can reseed its task state. */
  blocks?: Block[],
  nativeSession?: NativeSessionLink,
): void {
  const adapter = getHarness(harness);
  const source = nativeSession?.provider === harness &&
    nativeSession.providerSessionId === providerSessionId ? nativeSession : undefined;
  if (source) {
    adapter?.bindSession(threadId, providerSessionId, cwd, providerAccountId, source);
  }
  else adapter?.bindSession(threadId, providerSessionId, cwd, providerAccountId);
  if (!blocks || !adapter?.restoreTaskLists) return;
  const lists = blocks.flatMap((block) =>
    block.role === "tasks" && block.taskList ? [block.taskList] : [],
  );
  if (lists.length > 0) adapter.restoreTaskLists(threadId, lists);
}

/**
 * Probe model lists only for the harnesses the caller actually needs.
 * Boot used to refresh every adapter; that spawned unused CLIs (Pi with
 * extensions can sit at ~1GB) even when the workspace never touched them.
 */
/**
 * A catalog cached by an earlier run is shown at once but still re-read once
 * per run. `force` re-reads a catalog that already loaded, e.g. after a CLI
 * update.
 */
export async function refreshHarnessCatalogs(
  ids: Iterable<HarnessId>,
  options?: { force?: boolean },
): Promise<void> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;
  await Promise.all(
    [...adapters.values()]
      .filter((adapter) => wanted.has(adapter.id))
      .map(async (adapter) => {
        if (!adapter.refreshCatalog) return;
        if (!options?.force && hasFreshCatalog(adapter.id)) return;
        const done = beginCatalogLoad(adapter.id);
        await adapter
          .refreshCatalog()
          .then((models) => { if (models) setHarnessModels(adapter.id, models.map(model => ({ ...model, harness: adapter.id }))); })
          .catch((error: unknown) => {
            console.debug(`[omnicode] ${adapter.id} catalog`, error);
          })
          .finally(done);
      }),
  );
}

export async function readHarnessSessionTitle(session: import("../../../features/sessions/model/session").Session): Promise<string | null> {
  if (!session.providerSessionId) return null;
  const adapter = getHarness(session.harness);
  return adapter?.readSessionTitle?.({ sessionId: session.id, providerSessionId: session.providerSessionId, cwd: session.executionCwd ?? session.cwd, providerAccountId: session.providerAccountId }) ?? null;
}

export async function generateHarnessCommitMessage(
  harness: HarnessId,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const adapter = requireHarness(harness);
  if (!adapter.generateCommitMessage) {
    throw new Error(`${harness} does not support commit message generation`);
  }
  signal?.throwIfAborted();
  return adapter.generateCommitMessage(cwd, signal);
}

export async function generateHarnessPrContent(
  harness: HarnessId,
  cwd: string,
): Promise<(PrContent & { base: string; head: string }) | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generatePrContent) return null;
  return adapter.generatePrContent(cwd);
}

export async function generateHarnessBranchName(
  harness: HarnessId,
  cwd: string,
  message: string,
): Promise<string | null> {
  const adapter = getHarness(harness);
  if (adapter?.generateBranchName) return adapter.generateBranchName(cwd, message);
  return adapter?.runTextPrompt
    ? generateTextBranchName(adapter.runTextPrompt, cwd, message)
    : null;
}

export async function warmupHarnessText(
  harness: HarnessId,
  cwd: string,
): Promise<void> {
  await getHarness(harness)?.warmupText?.(cwd);
}

export function canRunHarnessTextPrompt(harness: HarnessId): boolean {
  const adapter = getHarness(harness);
  return adapter?.live === true && adapter.runTextPrompt != null;
}

function stopTextPrompt(adapter: HarnessAdapter): Promise<void> {
  return adapter.stopTextPrompt
    ? adapter.stopTextPrompt().catch(() => undefined)
    : Promise.resolve();
}

const activeTextPromptOwners = new Map<HarnessAdapter, Set<symbol>>();

function beginTextPrompt(adapter: HarnessAdapter): symbol {
  const owner = Symbol("text-prompt");
  const owners = activeTextPromptOwners.get(adapter) ?? new Set<symbol>();
  owners.add(owner);
  activeTextPromptOwners.set(adapter, owners);
  return owner;
}

function finishTextPrompt(
  adapter: HarnessAdapter,
  owner: symbol,
  stopIfLast: boolean,
): void {
  const owners = activeTextPromptOwners.get(adapter);
  if (!owners?.delete(owner)) return;
  if (owners.size > 0) return;
  activeTextPromptOwners.delete(adapter);
  if (stopIfLast) void stopTextPrompt(adapter);
}

function cancelledTextPrompt(): Error {
  return new Error("By-the-way request cancelled");
}

export async function runHarnessTextPrompt(
  input: TextPromptInput & { harness: HarnessId },
): Promise<string> {
  const adapter = requireHarness(input.harness);
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  if (!adapter.runTextPrompt) {
    throw new Error(`${input.harness} does not support isolated text prompts`);
  }

  const signal = input.signal;
  if (signal?.aborted) {
    throw cancelledTextPrompt();
  }

  const owner = beginTextPrompt(adapter);
  let run: Promise<string>;
  try {
    run = adapter.runTextPrompt(input);
  } catch (error) {
    finishTextPrompt(adapter, owner, false);
    throw error;
  }
  if (!signal) {
    try {
      return await run;
    } finally {
      finishTextPrompt(adapter, owner, false);
    }
  }

  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      finishTextPrompt(adapter, owner, false);
      reject(cancelledTextPrompt());
    };
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) abortHandler();
  });
  try {
    return await Promise.race([run, abortPromise]);
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    finishTextPrompt(adapter, owner, false);
  }
}

export async function stopHarnessTextPrompts(): Promise<void> {
  await Promise.all([...adapters.values()].map(stopTextPrompt));
}
