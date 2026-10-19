import { botContextPrompt, snapshotBotContext, type HarnessBotContext, type HarnessBotCapabilities } from "../src/integrations/harness/core/botContext";
import { providerBotCapabilities } from "../src/integrations/harness/providers/botCapabilities";
import { HostResourceGuard, HostResourceWaiter, HostResourceBusyError } from "./bots/resources";
import { selectComposerConfiguration } from "../src/features/sessions/model/composerConfiguration";
import { createHash, randomUUID } from "node:crypto";
import { HostOrchestration, type HostOrchestrationOptions } from "./orchestration";
import type { BotThreadRuntime } from "./bots/thread";
import { BotManager } from "./bots/manager";
import { BOT_PARALLEL_LIMIT } from "../src/integrations/harness/core/botAutonomy";
import { BotTaskWorktrees } from "./bots/taskWorktrees";
import { HostImService, type HostImOptions } from "./im-service";
import { HostWorkflows } from "./workflows/service";
import type { WorkflowWorkerPort } from "./workflows/driver";
import type { ControlOutcome, ControlReceiptContext, OrchestrationRun, OrchestrationTask, WorkerPreparation } from "../src/features/orchestration/model/orchestrationRuntime";
import { assertCheckoutAvailable, claimCheckoutResource, checkoutPath, checkoutPathsOverlap, withCheckoutOwner, withCheckoutIntegration } from "./checkout-guards";
import type { LegacyRetirementManifest } from "./legacy-orchestration";
import { SessionTitleCoordinator } from "../src/integrations/harness/core/titleCoordinator";
import { TitleModelApi } from "./title-model";
import { titleStateFor } from "../src/features/sessions/model/titlePolicy";
import { ACCOUNT_PROVIDERS, desktopProviderAccounts, providerAccountDirectory, providerUsageProfile, resolveDefaultAccount } from "./provider-accounts";
import { mkdir } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CHAT_ROOT, chatFolderRelativePath } from "../src/features/projects/model/chatFolderPath";
import { hostWorktreeAt, hostWorktrees, renameHostWorktreeBranch, resolveHostWorktree, resolveHostWorktreeAsync, withValidatedHostWorktree } from "./git-worktrees";
import { hostBranches } from "./git-branches";
import { availableWorktreeBranch, generateWorktreeBranch } from "../src/features/source-control/model/worktreeNaming";
import {
  applyHarnessEvent,
  appendSteerUser,
  stopStreaming,
} from "../src/integrations/harness/core/apply";
import { canDispatchQueuedHead, dequeueQueuedMessage, insertQueuedMessage, queuedHead } from "../src/features/sessions/model/messageQueue";
import { DEFAULT_MODEL_ID, resolveModel } from "../src/features/sessions/model/models";
import { isVisionImage } from "../src/features/sessions/model/attachments";
import type {
  HarnessEvent,
  HarnessSessionInput,
} from "../src/integrations/harness/core/types";
import {
  HARNESS_LABEL,
  RUNTIME_MODES,
  canReplaceSessionTitle,
  formatSessionTitle,
  sessionDisplayTitle,
  sessionExecutionCwd,
  titleFromPrompt,
  type Session,
  type QueueReturnPosition,
} from "../src/features/sessions/model/session";
import { namedWorktreeBranch } from "../src/features/source-control/model/worktrees";
import {
  isRemoteProvider,
  type HostCommand,
  type HostSession,
  type CommandReceipt,
  type RemoteProvider,
} from "../src/features/connections/model/protocol";
import type { HostProvider } from "./providers";
import { HostStore } from "./store";
import { SessionCheckpoints } from "./session-checkpoints";
import type { HostMachines } from "./host-machines";
import { currentMachineIO, localMachineIO } from "./machine-io";
import { projectMachineKey } from "../src/integrations/harness/core/machine";
import { isEditTool } from "../src/integrations/harness/core/preview";
import { HostClientState } from "./client-state";
import { HostSkills } from "./skills";
import { HostNotes } from "./notes";
import { NativeSessionGuard, nativeAccessMessage, type NativeLease } from "./native-access";
import { NativeSessionManager, nativeHolding, type NativeManagerOptions } from "./native/manager";
import { migrateNativeLink, restoreImportedNativeActivity } from "./native/migrate";
import { parseRemoteAttachments, resolveAttachments, saveGeneratedImageAttachment } from "./attachments";
import type { Attachment } from "../src/features/sessions/model/session";
import { parsePersistedWorktreeCreation } from "../src/features/source-control/model/worktreeCreation";
import type { UserQuestionReply } from "../src/features/sessions/model/userQuestion";
import { questionFollowUp, recordQuestionAnswer } from "../src/features/sessions/model/questionHistory";
import {
  appendReadyHandoff,
  buildDeterministicHandoff,
  consumeHandoff,
  pendingHandoff,
  userMessagesAfterHandoff,
  wrapHandoffPrompt,
} from "../src/features/sessions/model/handoff";

// Streamed output is written in batches. Anything a user may need to act on
// (approvals, questions, errors, completion) is written immediately.
const FLUSH_MS = 120;
const BATCHED = new Set<string>([
  "message.delta",
  "reasoning.delta",
  "context",
  "turn.metrics",
  "tool.updated",
  "agent.step",
  "agent.updated",
  "status",
]);

const text = (value: unknown, label: string, max = 128): string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new Error(`Invalid ${label}`);
  return value;
};

function parseQueueReturnPosition(value: unknown): QueueReturnPosition {
  const position = value as Partial<QueueReturnPosition> | null;
  if (!position || !Array.isArray(position.precedingIds) || !Array.isArray(position.followingIds) ||
      position.precedingIds.length + position.followingIds.length > 100)
    throw new Error("Invalid queue return position");
  const precedingIds = position.precedingIds.map((id) => text(id, "queued position ID"));
  const followingIds = position.followingIds.map((id) => text(id, "queued position ID"));
  if (new Set([...precedingIds, ...followingIds]).size !== precedingIds.length + followingIds.length)
    throw new Error("Invalid queue return position");
  return {
    precedingIds,
    followingIds,
    ...(position.lastUserMessageId !== undefined
      ? { lastUserMessageId: text(position.lastUserMessageId, "queue turn ID") } : {}),
  };
}

function modelSettings(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid model settings");
  const entries = Object.entries(value);
  if (
    entries.length > 20 ||
    entries.some(
      ([key, setting]) =>
        !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(key) ||
        typeof setting !== "string" ||
        setting.length > 128 ||
        setting.includes("\0"),
    )
  )
    throw new Error("Invalid model settings");
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseQuestionReply(value: unknown): UserQuestionReply {
  const reply = value as { kind?: string; answers?: unknown; custom?: unknown } | undefined;
  if (reply?.kind === "skipped") return { kind: "skipped" };
  if (reply?.kind !== "answered" || !reply.answers || typeof reply.answers !== "object" || Array.isArray(reply.answers))
    throw new Error("Invalid question answers");
  const entries = Object.entries(reply.answers);
  if (entries.length > 50 || entries.some(([key, answer]) => key.length > 200 ||
    !Array.isArray(answer) || answer.length > 50 || answer.some((item) => typeof item !== "string" || item.length > 10_000)))
    throw new Error("Invalid question answers");
  if (reply.custom != null && (typeof reply.custom !== "object" || Array.isArray(reply.custom) ||
    Object.entries(reply.custom).length > 50 || Object.entries(reply.custom).some(([key, item]) =>
      key.length > 200 || typeof item !== "string" || item.length > 10_000)))
    throw new Error("Invalid custom answers");
  return { kind: "answered", answers: Object.fromEntries(entries),
    ...(reply.custom ? { custom: reply.custom as Record<string, string> } : {}) };
}

export function parseCommand(input: unknown): HostCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid command");
  const v = input as Record<string, unknown>;
  const commandId = text(v.commandId, "command ID");
  if (v.type === "create") {
    if (
      !isRemoteProvider(v.harness) ||
      !RUNTIME_MODES.includes(v.runtimeMode as never)
    )
      throw new Error("Invalid provider or permission mode");
    if (
      v.autoWorktreeBranch !== undefined &&
      (v.executionCwd === undefined ||
        typeof v.autoWorktreeBranch !== "string" ||
        !/^mc\/[a-z0-9]{8}$/.test(v.autoWorktreeBranch))
    )
      throw new Error("Invalid automatically created worktree branch");
    if (
      v.providerAccountId !== undefined &&
      (typeof v.providerAccountId !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(v.providerAccountId) ||
        !ACCOUNT_PROVIDERS.includes(v.harness as never))
    )
      throw new Error("Invalid provider account");
    return {
      type: "create",
      commandId,
      projectId: text(v.projectId, "project ID"),
      ...(v.executionCwd !== undefined
        ? { executionCwd: text(v.executionCwd, "working copy", 4096) }
        : {}),
      ...(v.autoWorktreeBranch !== undefined
        ? { autoWorktreeBranch: v.autoWorktreeBranch as string }
        : {}),
      harness: v.harness,
      model: text(v.model, "model", 200),
      ...(v.modelSettings !== undefined
        ? { modelSettings: modelSettings(v.modelSettings) }
        : {}),
      runtimeMode: v.runtimeMode as Session["runtimeMode"],
      ...(v.providerAccountId !== undefined
        ? { providerAccountId: v.providerAccountId as string }
        : {}),
    };
  }
  const sessionId = text(v.sessionId, "session ID");
  if (v.type === "orchestration") {
    const projectId = text(v.projectId, "project ID");
    if (v.action === "editProposal" || v.action === "confirmProposal") {
      if (!Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 0) throw new Error("Invalid proposal revision");
      const base = { type: "orchestration" as const, commandId, sessionId, projectId, proposalBlockId: text(v.proposalBlockId, "proposal block ID"), expectedRevision: Number(v.expectedRevision) };
      if (v.action === "confirmProposal" && v.edit === undefined) return { ...base, action: "confirmProposal" };
      if (!v.edit || typeof v.edit !== "object" || Array.isArray(v.edit)) throw new Error("Invalid proposal edits");
      const edit = v.edit as Record<string, unknown>;
      if (!Number.isInteger(edit.maxWorkers) || Number(edit.maxWorkers) < 1 || Number(edit.maxWorkers) > 4 || !Array.isArray(edit.tasks)) throw new Error("Invalid proposal edits");
      return { ...base, action: v.action, edit: { maxWorkers: Number(edit.maxWorkers), tasks: edit.tasks as import("../src/features/orchestration/model/orchestrationPlan").ProposedTask[] } };
    }
    if (!["resume", "stop", "cancelTask"].includes(String(v.action))) throw new Error("Invalid orchestration action");
    return { type: "orchestration", commandId, sessionId, projectId, action: v.action as "resume" | "stop" | "cancelTask", orchestrationId: text(v.orchestrationId, "orchestration ID"), ...(v.action === "cancelTask" ? { taskId: text(v.taskId, "task ID") } : {}) };
  }
  if (v.type === "configure") {
    if (!RUNTIME_MODES.includes(v.runtimeMode as never))
      throw new Error("Invalid permission mode");
    if (v.harness !== undefined && !isRemoteProvider(v.harness))
      throw new Error("Invalid provider");
    return {
      type: "configure",
      commandId,
      sessionId,
      ...(v.harness !== undefined ? { harness: v.harness as RemoteProvider } : {}),
      model: text(v.model, "model", 200),
      modelSettings: modelSettings(v.modelSettings),
      runtimeMode: v.runtimeMode as Session["runtimeMode"],
    };
  }
  if (v.type === "queue") {
    if (!["remove", "edit", "hold", "release", "resume", "steer", "move"].includes(String(v.action)))
      throw new Error("Invalid queue action");
    const action = v.action as Extract<HostCommand, { type: "queue" }>["action"];
    if (action === "edit" && (typeof v.text !== "string" || v.text.length > 256_000 || v.text.includes("\0")))
      throw new Error("Invalid queued message");
    return { type: "queue", commandId, sessionId, action,
      ...(action !== "resume" && action !== "release" ? { messageId: text(v.messageId, "queued message ID") } : {}),
      ...(action === "edit" ? { text: v.text as string } : {}),
      ...(["edit", "hold", "release"].includes(action) ? { editor: text(v.editor, "queue editor") } : {}),
      ...(action === "steer" ? { runId: text(v.runId, "run ID") } : {}),
      ...(action === "move" && v.beforeId !== undefined ? { beforeId: text(v.beforeId, "queued destination ID") } : {}),
    };
  }
  if (v.type === "compact") return { type: "compact", commandId, sessionId };
  if (v.type === "send" || v.type === "draft") {
    if (v.queueReturnPosition !== undefined &&
        (v.type !== "send" || v.draftBlockId || v.planBlockId || v.queuedMessageId || v.questionAnswer || v.retryProposalBlockId))
      throw new Error("Invalid queue return position");
    const queueReturnPosition = v.queueReturnPosition === undefined ? undefined : parseQueueReturnPosition(v.queueReturnPosition);
    const attachments = parseRemoteAttachments(v.attachments);
    if (v.refreshTitle !== undefined && (v.type !== "send" || typeof v.refreshTitle !== "boolean")) throw new Error("Invalid title refresh");
    if (
      typeof v.text !== "string" ||
      v.text.length > 256_000 ||
      v.text.includes("\0") ||
      (!v.text.trim() &&
        attachments.length === 0 &&
        !(v.type === "send" && (v.draftBlockId !== undefined || v.queuedMessageId !== undefined)))
    )
      throw new Error("Invalid prompt");
    if (
      v.type === "send" &&
      v.intent !== undefined &&
      !["default", "plan", "build", "orchestrate"].includes(String(v.intent))
    )
      throw new Error("Invalid turn intent");
    if (
      v.followUpBehavior !== undefined &&
      (v.type !== "send" || (v.followUpBehavior !== "queue" && v.followUpBehavior !== "steer"))
    )
      throw new Error("Invalid follow-up behavior");
    if (
      v.planBlockId !== undefined &&
      (v.type !== "send" || v.intent !== "build")
    )
      throw new Error("Invalid plan build");
    const worktreeCreation =
      v.type === "send" && v.worktreeCreation !== undefined
        ? parsePersistedWorktreeCreation(v.worktreeCreation)
        : undefined;
    if (v.type === "send" && v.worktreeCreation !== undefined && !worktreeCreation)
      throw new Error("Invalid worktree record");
    let questionAnswer;
    if (v.questionAnswer !== undefined) {
      const answer = v.questionAnswer as { blockId?: unknown; reply?: unknown } | null;
      if (v.type !== "send" || !answer || (v.intent && v.intent !== "default") ||
        v.draftBlockId || v.planBlockId || v.queuedMessageId || v.retryProposalBlockId)
        throw new Error("Invalid question follow-up");
      const reply = parseQuestionReply(answer.reply);
      if (reply.kind !== "answered") throw new Error("Invalid question follow-up");
      questionAnswer = { blockId: text(answer.blockId, "question block ID"), reply };
    }
    return {
      type: v.type,
      commandId,
      sessionId,
      ...(questionAnswer ? { questionAnswer } : {}),
      text: v.text,
      ...(attachments.length ? { attachments } : {}),
      ...(worktreeCreation ? { worktreeCreation } : {}),
      ...(v.type === "send" && v.refreshTitle === true ? { refreshTitle: true } : {}),
      ...(queueReturnPosition ? { queueReturnPosition } : {}),
      ...(v.type === "send" && v.followUpBehavior !== undefined
        ? { followUpBehavior: v.followUpBehavior as "queue" | "steer" }
        : {}),
      ...(v.type === "send" && v.intent
        ? { intent: v.intent as "default" | "plan" | "build" | "orchestrate" }
        : {}),
      ...(v.type === "send" && v.retryProposalBlockId !== undefined
        ? { retryProposalBlockId: text(v.retryProposalBlockId, "proposal block ID") } : {}),
      ...(v.type === "send" && v.draftBlockId !== undefined
        ? { draftBlockId: text(v.draftBlockId, "draft block ID") }
        : {}),
      ...(v.type === "send" && v.queuedMessageId !== undefined
        ? { queuedMessageId: text(v.queuedMessageId, "queued message ID") } : {}),
      ...(v.type === "send" && v.planBlockId !== undefined
        ? { planBlockId: text(v.planBlockId, "plan block ID") }
        : {}),
    };
  }
  if (v.type === "removeDraft")
    return {
      type: "removeDraft",
      commandId,
      sessionId,
      draftBlockId: text(v.draftBlockId, "draft block ID"),
    };
  const runId = text(v.runId, "run ID");
  if (v.type === "cancel")
    return { type: "cancel", commandId, sessionId, runId };
  if (!Number.isSafeInteger(v.requestId) || Number(v.requestId) < 0)
    throw new Error("Invalid request ID");
  const requestId = Number(v.requestId);
  if (v.type === "approve" && (v.decision === "allow" || v.decision === "deny"))
    return {
      type: "approve",
      commandId,
      sessionId,
      runId,
      requestId,
      decision: v.decision,
    };
  if (v.type === "answer") {
    return { type: "answer", commandId, sessionId, runId, requestId,
      reply: parseQuestionReply(v.reply) };
  }

  throw new Error("Unsupported command");
}

export class HostEngine {
  readonly bots: BotManager;
  readonly assistant: BotThreadRuntime;
  readonly im: HostImService;
  readonly workflows: HostWorkflows;
  authorizeAssistantQueued?: (origin: import("../src/features/sessions/model/session").TurnOrigin, projectId: string, sessionId: string) => boolean;
  readonly orchestration: HostOrchestration;
  readonly ready: Promise<void>;
  private managedCompletions = new Map<string, (outcome: ControlOutcome) => void>();
  private checkoutReleases = new Map<string, () => void>();
  private retiring = new Set<string>();
  private switchingProjects = new Set<string>();
  private switchingAccounts = new Set<string>();
  private boundSessions = new Set<string>();
  private running = new Map<
    string,
    {
      runId: string;
      resourceOwner: string;
      abort: AbortController;
      done: Promise<void>;
      controls: Promise<void>;
      finishing: boolean;
      failed: boolean;
      cancelled: boolean;
      persistenceFailed: boolean;
    }
  >();
  /** Running sessions, including streamed events not yet written to disk. */
  private live = new Map<
    string,
    {
      value: HostSession;
      events: HarnessEvent[];
      imageRunId?: string;
      imageIds?: Set<string>;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closing = false;
  private readonly resourceWaiter: HostResourceWaiter;
  private readonly titles: SessionTitleCoordinator;
  readonly titleModel: TitleModelApi;
  private parked = new Map<string, { harness: string; timer: ReturnType<typeof setTimeout> }>();
  /** Drain idle or replaced adapters before starting another turn. */
  private providerStops = new Map<string, Set<RemoteProvider>>();
  private providerCleanups = new Map<string, Promise<void>>();
  /** Writer lock and external-CLI checks for native sessions. */
  readonly native = new NativeSessionGuard(() => dirname(this.store.attachmentDir));
  /** Host owner of native histories: sources, sync, watching and turn settlement. */
  readonly nativeSessions: NativeSessionManager;
  readonly notes: HostNotes;
  /** Keep/Undo checkpoints for edits made by ordinary Host conversations. */
  readonly checkpoints: SessionCheckpoints;
  readonly machines?: HostMachines;
  readonly botTaskWorktrees: BotTaskWorktrees;
  /** Paths of structured edits that started in each running turn, by tool call. */
  private checkpointCalls = new Map<string, Map<string, string[]>>();
  private checkpointStatusReads = new Map<string, { cwd: string; revision: number; promise: ReturnType<SessionCheckpoints["status"]> }>();
  private readonly clientState: HostClientState;
  private nativeLeases = new Map<string, NativeLease>();
  private editors = new Map<
    string,
    { owner: string; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    readonly store: HostStore,
    private readonly providers: Partial<Record<RemoteProvider, HostProvider>>,
    private readonly skills = new HostSkills(),
    options: HostOrchestrationOptions & { native?: NativeManagerOptions; im?: HostImOptions; machines?: HostMachines } = {},
  ) {
    this.machines = options.machines;
    if (this.machines) this.providers = this.machines.providers(providers);
    this.machines?.configureNotice((id, warnings) => {
      if (this.store.sessionIfExists(id)) this.mutateManaged(id, value => ({ ...value, executionWarnings: warnings }), { type: "session.executionWarnings" }, false);
    });
    this.machines?.configureImport(value => ({ ...value, nativeBinding: undefined, nativeStatus: undefined,
      executionWarnings: ["Imported from the previous WSL Host. The next turn starts with a history handoff using the desktop account."],
      session: appendReadyHandoff({ ...stopStreaming(value.session), providerSessionId: undefined,
        providerAccountId: undefined, nativeSession: undefined, pendingSwitch: undefined },
      value.session.harness, value.session.harness, buildDeterministicHandoff(value.session)) }));
    this.clientState = new HostClientState(store);
    this.notes = new HostNotes(dirname(store.attachmentDir), () => this.desktopDirectory());
    this.resourceWaiter = new HostResourceWaiter(store);
    this.checkpoints = new SessionCheckpoints(join(dirname(store.attachmentDir), "checkpoints"));
    this.nativeSessions = new NativeSessionManager({
      store,
      guard: this.native,
      desktopDirectory: () => this.desktopDirectory(),
      mutate: (id, change, event) => this.mutateManaged(id, change, event, false),
      create: (value) => this.store.transaction(() => this.store.save(value, { type: "native.imported" })),
      openProject: (cwd) => this.openProject(cwd),
      canSteer: (provider) => !!this.providers[provider as RemoteProvider]?.steer,
      busy: (id) => this.running.has(id),
      dispatch: (id) => this.dispatchQueue(id),
      stopProvider: async (id) => {
        const parked = this.parked.get(id);
        if (parked) { clearTimeout(parked.timer); this.parked.delete(id); }
        await this.provider(this.store.session(id).session.harness).stop(id);
        this.boundSessions.delete(id);
      },
    }, options.native);
    this.titleModel = new TitleModelApi(dirname(store.attachmentDir));
    this.titles = new SessionTitleCoordinator({
      get: (id) => { try { return this.store.session(id).session; } catch { return undefined; } },
      update: (id, change) => {
        if (this.closing) return;
        this.flush(id);
        let value: HostSession;
        try { value = this.store.session(id); } catch { return; }
        const session = change(value.session);
        if (session === value.session) return;
        const saved = this.store.transaction(() => this.store.save({ ...value, session, revision: value.revision + 1 }, { type: "session.titleMetadata" }));
        const live = this.live.get(id); if (live) live.value = saved;
      },
      read: (session) => session.providerSessionId ? this.provider(session.harness).readSessionTitle?.({ sessionId: session.id, providerSessionId: session.providerSessionId, cwd: sessionExecutionCwd(session), providerAccountId: session.providerAccountId }) ?? Promise.resolve(null) : Promise.resolve(null),
      generate: (_session, message) => this.titleModel.generate(message),
    });
    // Provider dispatch is not transactional with SQLite. Never replay a send
    // automatically after a crash; its external effects may already exist.
    for (const stored of store.scanSessions()) {
      const restoredActivity = stored.session.nativeSession &&
        stored.updatedAt > stored.session.nativeSession.updatedAt
        ? restoreImportedNativeActivity(stored, store.events(stored.session.id, 0).events)
        : undefined;
      const current = restoredActivity
        ? store.save({ ...restoredActivity, revision: stored.revision + 1 }, { type: "native.activityRestored" })
        : stored;
      // Native links from older clients become managed once; sync has no fallbacks.
      const migrated = migrateNativeLink(current);
      const value = migrated
        ? store.transaction(() => store.save({ ...migrated, revision: migrated.revision + 1 }, { type: "native.migrated" }))
        : current;
      const interrupted = value.status === "running";
      const recovered = interrupted
        ? this.settled(
            value,
            "interrupted",
            "Host restarted. This turn was interrupted; inspect its work before continuing.",
            value.updatedAt,
          )
        : value;
      if (
        interrupted ||
        !value.supportsQueue ||
        value.canSteer !== !!this.provider(value.session.harness).steer ||
        value.session.editingQueuedMessageId ||
        value.queueSteeringId ||
        value.session.queuedMessages?.length
      ) {
        this.save(
          {
            ...recovered,
            supportsQueue: true,
            canSteer: !!this.provider(value.session.harness).steer,
            queueSteeringId: undefined,
            session: {
              ...recovered.session,
              editingQueuedMessageId: undefined,
              queueStatus: recovered.session.queuedMessages?.length
                ? "paused"
                : undefined,
            },
          },
          { type: "queue.recovered" },
          false,
        );
      }
      // Native conversations bind under the writer lease when a turn starts.
      if (value.session.providerSessionId && !value.session.nativeSession) this.bindRetainedSession(value.session);
    }
    this.orchestration = new HostOrchestration(store, {
      machineIO: (id) => {
        const machine = this.store.project(this.store.session(id).projectId).machine;
        if (machine && !this.machines) throw new Error("The execution machine is unavailable");
        return this.machines?.io(machine) ?? localMachineIO;
      },
      session: (id) => this.session(id),
      values: () => this.currentValues(),
      mutate: (id, change, event) => this.mutateManaged(id, change, event),
      createWorker: (run, task, preparation) => this.createManagedWorker(run, task, preparation),
      submit: (id, prompt, done, origin) => this.submitManaged(id, prompt, done, origin),
      stop: (id) => this.stopManaged(id),
      steer: (id, prompt, receipt) => this.steerManaged(id, prompt, receipt),
      approve: (id, requestId, decision, receipt) => this.controlManaged(id, "approve", { requestId, decision }, receipt),
      answer: (id, requestId, reply, receipt) => this.controlManaged(id, "answer", { requestId, reply }, receipt),
    }, Object.keys(providers) as RemoteProvider[], options);
    this.workflows = new HostWorkflows({
      machineIO: (id) => {
        const machine = this.store.project(this.store.session(id).projectId).machine;
        if (machine && !this.machines) throw new Error("The execution machine is unavailable");
        return this.machines?.io(machine) ?? localMachineIO;
      },
      db: store.db,
      dataDir: dirname(store.attachmentDir),
      session: (id) => this.session(id),
      mutate: (id, change, event) => this.mutateManaged(id, change, event, false),
      workers: {
        createWorker: (input) => this.createWorkflowWorker(input),
        submit: (id, prompt, done) => this.submitManaged(id, prompt, done),
        stop: (id) => this.stopManaged(id),
      },
      providers: () => Object.keys(providers) as RemoteProvider[],
      createSession: (cwd, title, runtime) => this.createWorkflowLaunchSession(cwd, title, runtime),
      ...(options.entry ? { entry: options.entry } : {}),
      ...(options.node ? { node: options.node } : {}),
    });
    this.botTaskWorktrees = new BotTaskWorktrees(store,
      (projectId, operation) => {
        const machine = store.project(projectId).machine;
        if (machine && !this.machines) throw new Error("The execution machine is unavailable");
        return this.machines ? this.machines.run(machine, operation) : operation();
      },
      (botId, threadId, projectId) => {
        const config = this.bots?.store.record({ botId, threadId });
        if (!config?.enabled || config.paused || !config.policy.permissions["git.write"]) return 0;
        if (config.policy.allowedProjects !== "all" && !config.policy.allowedProjects.includes(projectId)) return 0;
        return config.worktreeIdleMinutes;
      },
      id => this.stopManaged(id));
    this.bots = new BotManager(this, Object.keys(providers) as RemoteProvider[], this.orchestration.ready, options);
    this.assistant = this.bots.defaultAssistant;
    this.im = new HostImService(store, this.assistant, options.im);
    this.ready = Promise.all([this.bots.ready, this.im.ready]).then(() => undefined);
    this.nativeSessions.start();
  }

  private bindRetainedSession(session: Session): void {
    if (!session.providerSessionId) return;
    const provider = this.provider(session.harness);
    // An imported conversation resumes strictly: never a silent replacement session.
    if (session.nativeSession) provider.bind(session.id, session.providerSessionId,
      sessionExecutionCwd(session), session.providerAccountId, session.nativeSession);
    else if (session.providerAccountId) provider.bind(session.id, session.providerSessionId,
      sessionExecutionCwd(session), session.providerAccountId);
    else provider.bind(session.id, session.providerSessionId, sessionExecutionCwd(session));
    this.boundSessions.add(session.id);
  }

  /** Public metadata from the Host-owned account catalog. */
  providerAccounts() {
    return desktopProviderAccounts(
      join(dirname(this.store.attachmentDir), "desktop-owner.json"),
    );
  }

  async stopProviderAccount(provider: "codex" | "claude", accountId: string): Promise<void> {
    const sessions = this.store.sessions().filter(value => value.session.harness === provider
      && (value.session.providerAccountId ?? "default") === accountId);
    await Promise.all(sessions.map(value => this.stopManaged(value.session.id)));
  }

  /** Host account metadata references existing desktop/custom credential Homes. */
  private desktopDirectory(): string | undefined {
    return providerAccountDirectory(join(dirname(this.store.attachmentDir), "desktop-owner.json"));
  }

  /** Whether a client may continue an imported native session now (null for ordinary sessions). */
  async nativeAccess(sessionId: string) {
    const value = this.store.session(sessionId);
    const link = value.session.nativeSession;
    if (!link) return null;
    return this.native.probe(sessionId, link, sessionExecutionCwd(value.session), this.nativeLeases.has(sessionId));
  }

  /** Read one session, including streamed output that has not been flushed. */
  session(id: string): HostSession | undefined {
    return this.live.get(id)?.value ?? this.store.sessionIfExists(id);
  }

  private currentValues(): HostSession[] {
    return this.store.sessions().map((value) => this.live.get(value.session.id)?.value ?? value);
  }

  private mutateManaged(id: string, change: (value: HostSession) => HostSession, event: unknown, touchActivity = true): HostSession {
    this.flush(id);
    const current = this.store.session(id);
    const next = change(current);
    // An unchanged value is not a new revision.
    if (next === current) return current;
    const saved = this.save(next, event, touchActivity);
    const live = this.live.get(id); if (live) live.value = saved;
    return saved;
  }

  private createManagedWorker(run: OrchestrationRun, task: OrchestrationTask, preparation: WorkerPreparation): void {
    const lead = this.store.session(run.leadId);
    const project = this.store.project(lead.projectId);
    const cwd = preparation.workspace.checkoutCwd;
    assertCheckoutAvailable(this.store, cwd);
    let retained: HostSession | undefined;
    try { retained = this.store.session(task.sessionId); } catch { /* New worker. */ }
    if (retained && (retained.projectId !== lead.projectId || retained.session.harness !== task.harness || retained.session.model !== task.model))
      throw new Error("The retained worker configuration no longer matches its assignment");
    const now = Date.now();
    const value: HostSession = retained ?? { projectId: project.id, revision: 0, status: "idle", createdAt: now, updatedAt: now,
      session: { id: task.sessionId, cwd, harness: task.harness, model: task.model, modelSettings: task.modelSettings ?? {}, runtimeMode: lead.session.runtimeMode, title: task.title, blocks: [] } };
    this.save({ ...value, supportsQueue: true, canSteer: !!this.provider(task.harness).steer,
      session: { ...value.session, cwd, executionCwd: cwd, branch: preparation.workspace.branch, worktreeRemoved: false, runtimeMode: lead.session.runtimeMode, orchestrationLeadId: run.leadId } }, { type: "orchestration.workerPrepared", leadId: run.leadId });
    if (value.session.providerSessionId) this.bindRetainedSession({ ...value.session, cwd });
  }

  /** A visible conversation that a saved workflow launched from the sidebar runs in. */
  private async createWorkflowLaunchSession(cwd: string, title: string, runtime?: { harness?: string; model?: string }): Promise<string> {
    const project = this.store.projects().find(entry => entry.cwd === cwd && projectMachineKey(entry.machine) === currentMachineIO().key) ?? await this.openProject(cwd);
    const recent = this.store.sessions().filter((value) => value.projectId === project.id && !value.session.workflowParentId && !value.session.orchestrationLeadId && !value.session.assistantOwnerId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.session;
    const installed = Object.keys(this.providers) as RemoteProvider[];
    const harness = (runtime?.harness && installed.includes(runtime.harness as RemoteProvider) ? runtime.harness : recent?.harness && installed.includes(recent.harness as RemoteProvider) ? recent.harness : installed[0]) as RemoteProvider | undefined;
    if (!harness) throw new Error("No agent provider is installed on this machine");
    const model = runtime?.model ?? (recent?.harness === harness ? recent.model : DEFAULT_MODEL_ID[harness] || `${harness}:default`);
    const receipt = await this.commandAsync({ type: "create", commandId: `workflow-launch:${randomUUID()}`, projectId: project.id, harness, model, runtimeMode: recent?.runtimeMode ?? "auto-accept-edits" });
    this.mutateManaged(receipt.sessionId, (value) => ({ ...value, session: { ...value.session, title, titleState: { source: "manual", epoch: 0, purpose: "initial", fallbackAttempted: false } } }), { type: "workflow.launchSession" });
    return receipt.sessionId;
  }

  /** A hidden session that runs one dynamic workflow subagent. */
  private createWorkflowWorker(input: Parameters<WorkflowWorkerPort["createWorker"]>[0]): void {
    if (!this.providers[input.runtime.harness as RemoteProvider]) throw new Error(`Provider ${input.runtime.harness} is not installed on this machine`);
    const parent = this.store.session(input.parentSessionId);
    let retained: HostSession | undefined;
    try { retained = this.store.session(input.sessionId); } catch { /* New subagent. */ }
    const now = Date.now();
    const cwd = sessionExecutionCwd(parent.session);
    const value: HostSession = retained ?? { projectId: parent.projectId, revision: 0, status: "idle", createdAt: now, updatedAt: now,
      session: { id: input.sessionId, cwd, harness: input.runtime.harness, model: input.runtime.model, modelSettings: input.runtime.modelSettings, runtimeMode: parent.session.runtimeMode, title: input.title, blocks: [] } };
    this.save({ ...value, supportsQueue: true, canSteer: !!this.providers[input.runtime.harness as RemoteProvider]?.steer,
      session: { ...value.session, harness: input.runtime.harness, model: input.runtime.model, modelSettings: input.runtime.modelSettings, cwd,
        ...(parent.session.executionCwd ? { executionCwd: parent.session.executionCwd } : {}), ...(parent.session.branch ? { branch: parent.session.branch } : {}),
        runtimeMode: parent.session.runtimeMode, workflowParentId: input.parentSessionId, workflowRunId: input.runId } }, { type: "workflow.workerPrepared", runId: input.runId });
    if (value.session.providerSessionId) this.bindRetainedSession({ ...value.session, cwd });
  }

  private submitManaged(id: string, prompt: string, done: (outcome: ControlOutcome) => void, origin?: import("../src/features/sessions/model/session").TurnOrigin): void {
    try {
      if (this.managedCompletions.has(id)) throw new Error("The managed worker already has a pending turn");
      const value = this.store.session(id);
      if (origin && !this.authorizeAssistantQueued?.(origin, value.projectId, value.session.id)) throw new Error("Assistant message blocked because its permission was revoked.");
      this.applyCommand({ type: "send", commandId: `managed:${randomUUID()}`, sessionId: id, text: prompt }, true, undefined, origin);
      this.managedCompletions.set(id, done);
    } catch (error) { done({ status: "failed", text: "", error: error instanceof Error ? error.message : String(error) }); }
  }

  private async stopManaged(id: string): Promise<void> {
    let value: HostSession;
    try { value = this.store.session(id); } catch { return; }
    const provider = this.provider(value.session.harness);
    const active = this.running.get(id);
    if (active) { active.cancelled = true; active.abort.abort(); }
    const parked = this.parked.get(id);
    if (parked) { clearTimeout(parked.timer); this.parked.delete(id); }
    await provider.stop(id);
    if (active) await active.done;
    this.checkoutReleases.get(id)?.(); this.checkoutReleases.delete(id);
  }

  private async steerManaged(id: string, prompt: string, receipt?: ControlReceiptContext): Promise<void> {
    this.flush(id);
    const value = this.store.session(id), active = this.running.get(id), provider = this.provider(value.session.harness);
    if (!active || active.finishing || active.cancelled || !provider.steer) throw new Error("This worker cannot receive guidance during its current turn");
    if (receipt?.origin && !this.authorizeAssistantQueued?.(receipt.origin, value.projectId, value.session.id)) throw new Error("Assistant message permission was revoked.");
    const saved = this.store.transaction(() => {
      const steered = appendSteerUser(value.session, prompt);
      if (receipt?.origin) steered.blocks[steered.blocks.length - 1] = { ...steered.blocks.at(-1)!, origin: receipt.origin };
      const saved = this.store.save({ ...value, revision: value.revision + 1, updatedAt: Date.now(), session: steered }, { type: "orchestration.steer" });
      if (receipt) this.recordControlReceipt(receipt);
      return saved;
    });
    const live = this.live.get(id); if (live) live.value = saved;
    await provider.steer({ sessionId: id, cwd: sessionExecutionCwd(value.session), model: value.session.model, modelSettings: value.session.modelSettings, text: prompt });
  }

  private recordControlReceipt(receipt: ControlReceiptContext): void {
    const generation = this.store.orchestration(receipt.leadId)?.id;
    if (!generation) throw new Error("The orchestration generation is unavailable");
    this.store.db.prepare("INSERT INTO metadata VALUES (?, ?)").run(`orchestration-effect:${generation}:${receipt.requestId}`, JSON.stringify({ signature: receipt.signature, result: receipt.result }));
  }

  private controlManaged(id: string, type: "approve" | "answer", params: Record<string, unknown>, receipt?: ControlReceiptContext) {
    const value = this.store.session(id);
    this.applyCommand({ ...params, type, commandId: `managed-control:${id}:${value.runId}:${type}:${params.requestId}`, sessionId: id, runId: value.runId }, true, receipt);
  }

  assertWorkspaceWrite(path: string) {
    assertCheckoutAvailable(this.store, path);
    this.orchestration.assertCheckout(path);
    const worker = this.currentValues().find((value) => value.session.orchestrationLeadId && !value.session.worktreeRemoved &&
      projectMachineKey(this.store.project(value.projectId).machine) === currentMachineIO().key &&
      checkoutPathsOverlap(checkoutPath(path), checkoutPath(sessionExecutionCwd(value.session))));
    if (worker) throw new Error("This worker checkout is managed by its lead");
  }

  assertProjectWrite(projectId: string) {
    const managed = this.orchestration?.scheduler.snapshot().some((run) => ["active", "paused"].includes(run.status) && this.store.session(run.leadId).projectId === projectId);
    if (managed) throw new Error("Stop orchestration before changing this project's branches or worktrees");
  }

  async deleteSession(id: string) {
    this.orchestration.assertSessionWrite(id, "delete");
    await this.orchestration.scheduler.deleteSession(id, async () => {
      this.store.deleteSession(id);
      this.store.db.prepare("DELETE FROM orchestration_runs WHERE lead_id=?").run(id);
      this.store.db.prepare("DELETE FROM orchestration_commands WHERE session_id=?").run(id);
    });
    await this.checkpoints.forget(id).catch(() => undefined);
  }

  /** Ordinary conversations own their checkout edits; managed workers, workflow
   * children and the assistant are reviewed through their own surfaces. */
  private checkpointed(session: Session): boolean {
    return !!sessionExecutionCwd(session) && sessionExecutionCwd(session) !== "~" && !session.inboxAsk &&
      !session.orchestrationLeadId && !session.workflowParentId && !session.assistantOwnerId &&
      !this.orchestration.scheduler.forSession(session.id);
  }

  private trackCheckpoint(session: Session, event: HarnessEvent): void {
    if (event.type !== "tool.started" && event.type !== "tool.updated") return;
    // Completion updates may omit the kind and paths their start reported.
    const calls = this.checkpointCalls.get(session.id);
    const known = calls?.get(event.callId);
    if (!known && !isEditTool(event.kind, event.title, event.preview)) return;
    if (!this.checkpointed(session)) return;
    const own = [...new Set([...(event.paths ?? []), ...(event.preview?.path ? [event.preview.path] : [])])];
    const paths = own.length ? own : known ?? [];
    if (!paths.length) return;
    const completed = event.type === "tool.updated" && (event.status === "completed" || event.status === "success");
    if (completed) {
      calls?.delete(event.callId);
      void this.checkpoints.capture(session.id, sessionExecutionCwd(session), paths).catch(() => undefined);
      return;
    }
    if (known && paths.every((path) => known.includes(path))) return;
    if (calls) calls.set(event.callId, [...new Set([...(known ?? []), ...paths])]);
    else this.checkpointCalls.set(session.id, new Map([[event.callId, paths]]));
    void this.checkpoints.prepare(session.id, sessionExecutionCwd(session), paths).catch(() => undefined);
  }

  /** Share the lightweight checkout guard between status display and actual undo. */
  private otherRunningCheckout(sessionId: string, cwd: string): boolean {
    const directories = new Map(this.store.runningSessionDirectories().map(value => [value.id, value.cwd]));
    // Prefer current run state over persisted metadata while a batch is pending.
    for (const [id, { value }] of this.live) {
      if (value.status === "running") directories.set(id, sessionExecutionCwd(value.session));
      else directories.delete(id);
    }
    const checkout = checkoutPath(cwd);
    return [...directories].some(([id, path]) => id !== sessionId &&
      projectMachineKey(this.store.project(this.store.session(id).projectId).machine) === currentMachineIO().key &&
      checkoutPathsOverlap(checkoutPath(path), checkout));
  }

  /** Review, keep or undo the edits a conversation made in its checkout. */
  async sessionCheckpoint(sessionId: string, action: unknown, path: unknown, turnId?: unknown): Promise<unknown> {
    const value = this.session(sessionId);
    if (!value) throw new Error("Session not found");
    const { session } = value;
    if (path !== undefined && typeof path !== "string") throw new Error("Invalid workspace path");
    if (turnId !== undefined && (typeof turnId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(turnId))) throw new Error("Invalid turn id");
    if (!this.checkpointed(session)) {
      if (action === "status") return { files: [] };
      throw new Error("Session changes are no longer available");
    }
    if (action === "status") {
      if (typeof turnId === "string") return this.checkpoints.status(sessionId, sessionExecutionCwd(session), turnId);
      let read = this.checkpointStatusReads.get(sessionId);
      if (!read || read.cwd !== sessionExecutionCwd(session) || read.revision !== value.revision) {
        read = { cwd: sessionExecutionCwd(session), revision: value.revision, promise: this.checkpoints.status(sessionId, sessionExecutionCwd(session)) };
        this.checkpointStatusReads.set(sessionId, read);
      }
      let status: Awaited<typeof read.promise>;
      try { status = await read.promise; }
      finally {
        if (this.checkpointStatusReads.get(sessionId) === read) this.checkpointStatusReads.delete(sessionId);
      }
      const locked = status.files.length > 0 && this.otherRunningCheckout(sessionId, sessionExecutionCwd(session));
      return locked ? { ...status, undoLocked: true } : status;
    }
    if (action === "diff") {
      if (typeof path !== "string") throw new Error("Invalid workspace path");
      return this.checkpoints.fileDiff(sessionId, sessionExecutionCwd(session), path, turnId as string | undefined);
    }
    if (action !== "undo" && action !== "keep") throw new Error("Unsupported checkpoint action");
    if (turnId !== undefined) throw new Error("Historical changes are read-only");
    // Keep and Undo wait until the agent has finished writing to the checkout.
    if (value.status === "running" || this.running.has(sessionId))
      throw new Error("Keep and undo are unavailable while the session is running");
    this.checkpointStatusReads.delete(sessionId);
    if (action === "keep") return this.checkpoints.keep(sessionId, sessionExecutionCwd(session), path);
    if (this.otherRunningCheckout(sessionId, sessionExecutionCwd(session)))
      throw new Error("Undo is unavailable while another session is running in this project");
    return withCheckoutIntegration(this.store, [sessionExecutionCwd(session)], () => this.checkpoints.undo(sessionId, sessionExecutionCwd(session), path));
  }

  /** Native bootstrap only: device RPC never exposes retirement. */
  async retireLegacyOrchestration(manifest: LegacyRetirementManifest): Promise<{ retired: true }> {
    if (manifest?.manifestId !== "host-orchestration-v1" || !/^[a-f0-9]{64}$/.test(manifest.sourceKey) || !Array.isArray(manifest.entries)) throw new Error("Invalid legacy retirement manifest");
    const ids = new Set<string>();
    for (const entry of manifest.entries) {
      if (!entry || typeof entry.id !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(entry.id) || ids.has(entry.id)) throw new Error("Invalid legacy retirement identity");
      ids.add(entry.id);
    }
    const key = `desktop-orchestration-retired:${manifest.sourceKey}:${manifest.manifestId}`;
    const signature = createHash("sha256").update(JSON.stringify(manifest.entries)).digest("hex");
    const completed = this.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
    if (completed) { if (completed.value !== signature) throw new Error("Legacy retirement manifest changed"); return { retired: true }; }
    // Establish every identity before stopping or deleting any conversation.
    for (const entry of manifest.entries) {
      const row = this.store.db.prepare("SELECT snapshot FROM sessions WHERE id=?").get(entry.id);
      if (!row) continue;
      const value = JSON.parse(String(row.snapshot)) as HostSession;
      const imported = this.store.db.prepare("SELECT 1 FROM metadata WHERE key=?").get(`desktop-import:${manifest.sourceKey}:${entry.id}`);
      const matching = entry.cwd && entry.harness && this.store.project(value.projectId).cwd === entry.cwd && value.session.harness === entry.harness;
      if (!imported && !matching) throw new Error(`Legacy conversation identity could not be verified: ${entry.id}`);
    }
    for (const id of ids) this.retiring.add(id);
    try {
      await this.orchestration.retire([...ids]);
      await Promise.all([...ids].map((id) => this.stopManaged(id)));
      for (const id of ids) {
        clearTimeout(this.retryTimers.get(id)); this.retryTimers.delete(id);
        clearTimeout(this.live.get(id)?.timer); this.live.delete(id);
        this.running.delete(id); this.managedCompletions.delete(id); this.boundSessions.delete(id);
        this.clearEditor(id);
      }
      this.store.transaction(() => {
        for (const id of ids) {
          this.store.db.prepare("INSERT OR IGNORE INTO metadata VALUES (?, '1')").run(`desktop-import:${manifest.sourceKey}:${id}`);
          this.store.db.prepare("INSERT OR IGNORE INTO metadata VALUES (?, '1')").run(`desktop-retired:${manifest.sourceKey}:${id}`);
          this.store.db.prepare("INSERT OR IGNORE INTO retired_sessions VALUES (?)").run(id);
          this.store.db.prepare("DELETE FROM events WHERE session_id=?").run(id);
          this.store.db.prepare("DELETE FROM orchestration_runs WHERE lead_id=?").run(id);
          this.store.db.prepare("DELETE FROM orchestration_commands WHERE session_id=?").run(id);
          this.store.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
          this.store.invalidateSession(id);
        }
        this.store.db.prepare("INSERT INTO metadata VALUES (?, ?)").run(key, signature);
      });
      return { retired: true };
    } finally { for (const id of ids) this.retiring.delete(id); }
  }

  async openProject(path: string, authorize?: (cwd: string) => void) {
    const io = currentMachineIO();
    if (!io.path.isAbsolute(path) || path.includes("\0"))
      throw new Error("Choose an absolute directory path on the host");
    const cwd = await io.fs.realpath(path);
    if (!(await io.fs.stat(cwd)).isDirectory())
      throw new Error("Project path is not a directory");
    authorize?.(cwd);
    return this.store.addProject(cwd, io.path.basename(cwd), undefined,
      io.key.startsWith("wsl:") ? { kind: "wsl", distribution: io.key.slice(4) } : undefined);
  }

  /** A projectless chat: a new dated folder under `~/Documents/omnicode`. */
  async createChat(home = homedir(), authorize?: (cwd: string) => void) {
    for (let attempt = 0; ; attempt++) {
      const cwd = join(home, CHAT_ROOT, chatFolderRelativePath());
      authorize?.(cwd);
      try {
        await mkdir(dirname(cwd), { recursive: true });
        await mkdir(cwd);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST" && attempt < 2) continue;
        throw error;
      }
      return this.openProject(cwd, authorize);
    }
  }

  async listSkills(projectId: unknown, harness: unknown, sessionId?: unknown, refresh = false) {
    const project = this.store.project(text(projectId, "project ID"));
    if (!isRemoteProvider(harness)) throw new Error("Unsupported provider");
    const value = sessionId === undefined ? undefined : this.store.session(text(sessionId, "session ID"));
    // A pending Agent switch applies on the next send; the composer already
    // lists the selected Agent's commands, so accept either harness.
    if (value && (value.projectId !== project.id || (value.session.harness !== harness
      && value.session.pendingConfiguration?.harness !== harness)))
      throw new Error("The skill catalog belongs to another project or Agent");
    return this.skills.list({ harness, cwd: value?.session.executionCwd || value?.session.cwd || project.cwd,
      ...(value ? { sessionId: value.session.id } : {}) }, this.provider(harness), refresh);
  }

  async withIdleProject<T>(
    projectId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    this.assertProjectWrite(projectId);
    if (this.switchingProjects.has(projectId))
      throw new Error("A branch switch is already in progress");
    if (
      this.store
        .summaries(projectId)
        .some((session) => session.status === "running")
    )
      throw new Error(
        "Wait for running host sessions before switching branches",
      );
    this.switchingProjects.add(projectId);
    try {
      return await action();
    } finally {
      this.switchingProjects.delete(projectId);
    }
  }

  private provider(id: string): HostProvider {
    const provider = this.providers[id as RemoteProvider];
    if (!provider) throw new Error(`${id} is not available on this host`);
    return provider;
  }

  private save(value: HostSession, event: unknown, touchActivity = true): HostSession {
    return this.store.transaction(() =>
      this.store.save(
        { ...value, revision: value.revision + 1, updatedAt: touchActivity ? Date.now() : value.updatedAt },
        event,
      ),
    );
  }

  updateSession(id: string, patch: Parameters<HostStore["updateSession"]>[1], accepted?: (result: ReturnType<HostStore["updateSession"]>) => void) {
    this.orchestration.assertSessionWrite(id, "metadata");
    if (patch.title !== undefined) this.titles.cancel(id);
    this.flush(id);
    const summary = this.store.transaction(() => {
      const result = this.store.updateSession(id, patch);
      accepted?.(result);
      return result;
    });
    const live = this.live.get(id);
    if (live) live.value = this.store.session(id);
    return summary;
  }

  private flush(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    clearTimeout(live.timer);
    live.timer = undefined;
    if (!live.events.length) return;
    const events = live.events;
    live.value = this.save(live.value, { type: "events", events });
    live.events = [];
  }

  private scheduledFlush(id: string, provider: HostProvider): boolean {
    try {
      this.flush(id);
      return true;
    } catch (error) {
      const active = this.running.get(id);
      if (active) active.persistenceFailed = true;
      console.error(
        "Session persistence failed; stopping its provider:",
        error instanceof Error ? error.message : "unknown error",
      );
      void provider.stop(id);
      return false;
    }
  }

  private retrySettlement(
    id: string,
    runId: string,
    provider: HostProvider,
  ): void {
    if (this.closing || this.retryTimers.has(id)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(id);
      void (async () => {
        try {
          await provider.stop(id);
          this.flush(id);
          const latest = this.store.session(id);
          if (latest.runId === runId && latest.status === "running")
            this.save(
              this.settled(
                latest,
                "interrupted",
                "Session storage failed during this turn. Inspect its work before continuing.",
                latest.updatedAt,
              ),
              { type: "interrupted", reason: "persistence failure" },
            );
          this.live.delete(id);
          this.running.delete(id);
          if (latest.session.providerSessionId)
            provider.bind(
              id,
              latest.session.providerSessionId,
              sessionExecutionCwd(latest.session),
            );
        } catch (error) {
          console.error(
            "Retrying session persistence:",
            error instanceof Error ? error.message : "unknown error",
          );
          this.retrySettlement(id, runId, provider);
        }
      })();
    }, 1_000);
    timer.unref?.();
    this.retryTimers.set(id, timer);
  }

  command(raw: unknown, client?: { remoteControl: boolean; remoteControlDevice?: HostSession["remoteControlDevice"] }): CommandReceipt {
    if (raw && typeof raw === "object") {
      const input = raw as Record<string, unknown>;
      if (["origin", "author", "assistantOwnerId", "botContext", "systemInstructions", "contextFingerprint"].some(key => key in input) || String(input.commandId).startsWith("assistant:")) throw new Error("Assistant identity is reserved for Host");
      if (input.projectId && this.store.project(String(input.projectId)).kind === "assistant") throw new Error("Assistant project is private");
      if (input.sessionId && this.store.session(String(input.sessionId)).session.assistantOwnerId) throw new Error("Use the assistant control API");
    }
    return this.applyCommand(raw, false, undefined, undefined, undefined, client?.remoteControl, client?.remoteControlDevice);
  }

  async commandAsync(raw: unknown, client?: { remoteControl: boolean; remoteControlDevice?: HostSession["remoteControlDevice"] }): Promise<CommandReceipt> {
    if (currentMachineIO().key === "local") return this.command(raw, client);
    const command = parseCommand(raw);
    if (command.type !== "create") return this.command(raw, client);
    return withValidatedHostWorktree(this.store.project(command.projectId).cwd, command.executionCwd,
      () => this.command(raw, client));
  }

  botCapabilities(harness: string, context?: Pick<HarnessBotContext, "agentsMcp">): HarnessBotCapabilities {
    const configured = providerBotCapabilities(harness, context);
    const base = this.provider(harness).botCapabilities;
    const capability = context?.agentsMcp && base ? { ...base, mcp: configured.mcp, limitations: configured.limitations } : base ?? configured;
    return { ...capability, limitations: [...capability.limitations] };
  }

  assistantCommand(raw: unknown, origin?: import("../src/features/sessions/model/session").TurnOrigin, botContext?: HarnessBotContext): CommandReceipt {
    const snapshot = botContext && snapshotBotContext(botContext);
    if (snapshot) {
      const command = parseCommand(raw);
      if (command.type !== "send") throw new Error("Bot context belongs to a send command");
      const record = this.bots.store.record(snapshot.scope);
      const run = this.bots.store.run(snapshot.scope, snapshot.scope.runId);
      if (record?.brainSessionId !== command.sessionId ||
          this.store.session(command.sessionId).session.assistantOwnerId !== snapshot.scope.botId ||
          !run || !["running", "waiting_approval"].includes(run.status))
        throw new Error("Bot context does not belong to this active Host run");
    }
    return this.applyCommand(raw, false, undefined, origin, snapshot);
  }

  /** All provider runtime modes can write; shared tasks therefore serialize too. */
  assistantAdmission(value: HostSession, origin?: import("../src/features/sessions/model/session").TurnOrigin): string | undefined {
    if (!origin || value.session.assistantOwnerId) return;
    const running = this.store.runningSessionDirectories().map(entry => this.store.session(entry.id))
      .filter(entry => !entry.session.assistantOwnerId && entry.session.id !== value.session.id);
    const owned = running.filter(entry => entry.session.blocks.findLast(block => block.role === "user")?.origin?.assistantId === origin.assistantId);
    if (value.status !== "running" && owned.length >= BOT_PARALLEL_LIMIT) return "Assistant task queued: the 10-session parallel limit is reached.";
    const key = projectMachineKey(this.store.project(value.projectId).machine);
    const cwd = checkoutPath(sessionExecutionCwd(value.session));
    if (running.some(entry => projectMachineKey(this.store.project(entry.projectId).machine) === key &&
      checkoutPathsOverlap(checkoutPath(sessionExecutionCwd(entry.session)), cwd)))
      return "Assistant task queued: another task is writing in this working copy.";
  }

  resumeAssistantQueues(): void {
    if (this.closing) return;
    for (const id of this.store.queuedSessionIds()) {
      const value = this.store.session(id);
      if (value.session.queuedMessages?.[0]?.origin && value.status !== "running") this.dispatchQueue(id);
    }
  }

  stopAssistantBrain(id: string): Promise<void> { return this.stopManaged(id); }

  /** Deliver a user follow-up into the assistant brain's running turn; false when it cannot be steered. */
  async assistantBrainSteer(id: string, prompt: string): Promise<boolean> {
    this.flush(id);
    const value = this.store.session(id), active = this.running.get(id), provider = this.provider(value.session.harness);
    if (!value.session.assistantOwnerId || !active || active.finishing || active.cancelled || !provider.steer) return false;
    const prepared = await this.skills.prepare(prompt, { harness: value.session.harness as RemoteProvider, cwd: sessionExecutionCwd(value.session), sessionId: id }, provider);
    if (active.finishing || active.cancelled || this.running.get(id) !== active) return false;
    const saved = this.save({ ...this.store.session(id), session: appendSteerUser(this.store.session(id).session, prompt) }, { type: "assistant.brainSteer" });
    const live = this.live.get(id); if (live) live.value = saved;
    await provider.steer({ sessionId: id, cwd: sessionExecutionCwd(value.session), model: value.session.model, modelSettings: value.session.modelSettings, text: prepared });
    return true;
  }

  /** Update trusted sender display metadata without changing provider text. */
  refreshAssistantSenderName(assistantId: string, assistantName: string): void {
    const needsName = (origin: import("../src/features/sessions/model/session").TurnOrigin | undefined) =>
      origin?.kind === "assistant" && origin.assistantId === assistantId && origin.assistantName !== assistantName;
    for (const candidate of this.currentValues()) {
      if (!candidate.session.blocks.some(block => needsName(block.origin)) &&
          !candidate.session.queuedMessages?.some(message => needsName(message.origin))) continue;
      const id = candidate.session.id;
      this.flush(id);
      const value = this.store.session(id);
      const update = <T extends { origin?: import("../src/features/sessions/model/session").TurnOrigin }>(item: T): T =>
        needsName(item.origin) ? { ...item, origin: { ...item.origin!, assistantName } } : item;
      const saved = this.save({ ...value, session: { ...value.session,
        blocks: value.session.blocks.map(update),
        queuedMessages: value.session.queuedMessages?.map(update),
      } }, { type: "assistant.senderName" });
      const live = this.live.get(id);
      if (live) live.value = saved;
    }
  }

  async refreshAssistantBrainProcess(id: string): Promise<void> {
    const value = this.store.session(id);
    if (!value.session.assistantOwnerId || value.status === "running") throw new Error("Assistant brain must be idle before refreshing its process");
    // Grants rotate per turn; an idle provider process still holds its old environment.
    await this.stopManaged(id);
    this.bindRetainedSession(this.store.session(id).session);
  }

  async assistantSteer(id: string, runId: string, prompt: string, origin: import("../src/features/sessions/model/session").TurnOrigin, authorize: () => boolean): Promise<{ steered: true }> {
    this.flush(id);
    const value = this.store.session(id), active = this.running.get(id), provider = this.provider(value.session.harness);
    this.orchestration.assertSessionWrite(id, "send");
    if (!active || active.runId !== runId || active.finishing || active.cancelled || !provider.steer || !authorize()) throw new Error("This turn cannot receive guidance");
    const prepared = await this.skills.prepare(prompt, { harness: value.session.harness as RemoteProvider, cwd: sessionExecutionCwd(value.session), sessionId: id }, provider);
    if (!authorize() || active.finishing || active.cancelled || !this.authorizeAssistantQueued?.(origin, value.projectId, value.session.id)) throw new Error("Assistant permission was revoked");
    const next = appendSteerUser(this.store.session(id).session, prompt);
    next.blocks[next.blocks.length - 1] = { ...next.blocks[next.blocks.length - 1], origin };
    const saved = this.save({ ...this.store.session(id), session: next }, { type: "assistant.steer", origin });
    const live = this.live.get(id); if (live) live.value = saved;
    await provider.steer({ sessionId: id, cwd: sessionExecutionCwd(value.session), model: value.session.model, modelSettings: value.session.modelSettings, text: prepared });
    return { steered: true };
  }

  private switchSessionHarness(value: HostSession, harness: RemoteProvider): HostSession {
    const incoming = this.provider(harness);
    const outgoing = value.session.harness as RemoteProvider;
    const providerAccountId = resolveDefaultAccount(
      join(dirname(this.store.attachmentDir), "desktop-owner.json"), harness,
    );
    const previous = value.session;
    const history = { ...previous, blocks: previous.blocks.filter((block) => !block.draft) };
    const handedOff = history.blocks.some((block) => block.role === "user")
      ? appendReadyHandoff(history, outgoing, harness, buildDeterministicHandoff(history))
      : history;
    return {
      ...value,
      canSteer: !!incoming.steer,
      nativeBinding: undefined,
      nativeStatus: undefined,
      session: {
        ...handedOff,
        blocks: [...handedOff.blocks, ...previous.blocks.filter((block) => block.draft)],
        harness,
        title: titleStateFor(previous).source !== "manual" && previous.title.startsWith(`${HARNESS_LABEL[outgoing]} · `)
          ? formatSessionTitle(harness, sessionDisplayTitle(previous.title, outgoing))
          : previous.title,
        providerSessionId: undefined,
        providerAccountId,
        nativeSession: undefined,
        nativeSyncStatus: undefined,
        pendingSwitch: undefined,
        pendingQuestion: undefined,
        modelSettingOptions: undefined,
        context: undefined,
        usageLimit: undefined,
        backgroundTasks: undefined,
        titleState: { ...titleStateFor(previous), epoch: titleStateFor(previous).epoch + 1 },
      },
    };
  }

  /**
   * Move an idle conversation to another account profile of the same agent.
   * Provider threads live in an account Home, so the native records are copied
   * there and the conversation resumes in place; without them, the next turn
   * starts a fresh provider thread with a recap.
   */
  async switchProviderAccount(id: string, requested: string): Promise<HostSession> {
    this.flush(id);
    const value = this.store.session(id);
    const harness = value.session.harness;
    if (!ACCOUNT_PROVIDERS.includes(harness as never)) throw new Error("This agent has no account profiles");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(requested)) throw new Error("Invalid provider account");
    this.orchestration.assertSessionWrite(id, "configure");
    if (value.session.assistantOwnerId) throw new Error("The assistant brain keeps its account");
    const owner = join(dirname(this.store.attachmentDir), "desktop-owner.json");
    const next = resolveDefaultAccount(owner, harness, requested);
    if ((next ?? "default") === (value.session.providerAccountId ?? "default")) return value;
    if (value.status === "running" || this.running.has(id) || this.switchingAccounts.has(id))
      throw new Error("Wait for the current turn before switching accounts");
    if (this.switchingProjects.has(value.projectId)) throw new Error("Wait for the branch switch to finish");
    this.switchingAccounts.add(id);
    try {
      await this.stopManaged(id);
      const current = this.store.session(id);
      if (current.status === "running" || this.running.has(id))
        throw new Error("Wait for the current turn before switching accounts");
      const session = current.session;
      const link = session.nativeSession;
      let copied: ReturnType<NativeSessionManager["copyToAccount"]> = null;
      if (session.providerSessionId) {
        try {
          copied = this.nativeSessions.copyToAccount(harness as "claude" | "codex", session.providerSessionId,
            link?.accountId ?? session.providerAccountId, providerUsageProfile(owner, harness, requested).home);
        } catch {
          copied = null;
        }
      }
      let nextSession: Session = { ...session, providerAccountId: next, usageLimit: undefined };
      if (copied && link) {
        const { accountId: _accountId, ...rest } = link;
        // Keep the synced revision: the copy is re-read once and merges idempotently.
        nextSession.nativeSession = { ...rest, path: copied.path, dataDir: copied.dataDir, ...(next ? { accountId: next } : {}) };
      } else if (!copied && session.providerSessionId) {
        const history = { ...session, blocks: session.blocks.filter((block) => !block.draft) };
        const handedOff = history.blocks.some((block) => block.role === "user")
          ? appendReadyHandoff(history, harness, harness, buildDeterministicHandoff(history))
          : history;
        nextSession = {
          ...nextSession,
          blocks: [...handedOff.blocks, ...session.blocks.filter((block) => block.draft)],
          providerSessionId: undefined,
          nativeSession: undefined,
          nativeSyncStatus: undefined,
          context: undefined,
        };
      }
      const saved = this.save({
        ...current,
        // A lazily bound source is looked up again in the new Home after the next turn.
        nativeBinding: undefined,
        ...(nextSession.nativeSession ? {} : { nativeStatus: undefined }),
        session: nextSession,
      }, { type: "session.account", providerAccountId: next ?? "default" });
      const live = this.live.get(id);
      if (live) live.value = saved;
      this.nativeSessions.detach(id);
      this.native.forget(id);
      this.boundSessions.delete(id);
      if (saved.session.providerSessionId) this.bindRetainedSession(saved.session);
      return saved;
    } finally {
      this.switchingAccounts.delete(id);
    }
  }

  private finishHarnessSwitch(sessionId: string, outgoing: RemoteProvider): void {
    this.titles.cancel(sessionId);
    this.nativeSessions.detach(sessionId);
    this.native.forget(sessionId);
    this.boundSessions.delete(sessionId);
    const parked = this.parked.get(sessionId);
    if (parked) { clearTimeout(parked.timer); this.parked.delete(sessionId); }
    const stops = this.providerStops.get(sessionId) ?? new Set<RemoteProvider>();
    stops.add(outgoing);
    this.providerStops.set(sessionId, stops);
    void this.cleanPreviousProviders(sessionId).catch(() => undefined);
  }

  private applyCommand(raw: unknown, managed: boolean, controlReceipt?: ControlReceiptContext, origin?: import("../src/features/sessions/model/session").TurnOrigin, botContext?: HarnessBotContext, remoteControl = false, remoteControlDevice?: HostSession["remoteControlDevice"]): CommandReceipt {
    if (this.closing) throw new Error("Host is stopping");
    const command = parseCommand(raw);
    if (command.type === "orchestration") {
      this.flush(command.sessionId);
      const receipt = this.orchestration.accept(command);
      const live = this.live.get(command.sessionId);
      if (live) live.value = this.store.session(command.sessionId);
      return receipt;
    }
    const signature = createHash("sha256")
      .update(JSON.stringify(botContext ? { command, origin, botContext } : origin ? { command, origin } : command))
      .digest("hex");
    const previous = this.store.receipt(command.commandId, signature);
    if (previous) return previous;
    // Commands apply to the latest state, including batched stream output.
    if (command.type !== "create") this.flush(command.sessionId);
    let effect: ((saved: HostSession) => void) | undefined;
    let switchFrom: RemoteProvider | undefined;
    const { receipt, saved } = this.store.transaction(() => {
      let value: HostSession;
      if (command.type === "create") {
        const project = this.store.project(command.projectId);
        if (this.switchingProjects.has(project.id))
          throw new Error("Wait for the branch switch to finish");
        this.provider(command.harness);
        const providerAccountId = resolveDefaultAccount(
          join(dirname(this.store.attachmentDir), "desktop-owner.json"),
          command.harness,
          command.providerAccountId,
        );
        const cwd = resolveHostWorktree(project.cwd, command.executionCwd);
        const worktree = cwd !== project.cwd ? hostWorktreeAt(project.cwd, cwd) : undefined;
        assertCheckoutAvailable(this.store, cwd);
        this.orchestration.assertCheckout(cwd);
        const now = Date.now();
        value = {
          projectId: project.id,
          autoWorktreeBranch: command.autoWorktreeBranch,
          revision: 0,
          status: "idle",
          supportsQueue: true,
          canSteer: !!this.provider(command.harness).steer,
          createdAt: now,
          updatedAt: now,
          session: {
            id: randomUUID(),
            cwd,
            executionCwd: cwd,
            harness: command.harness,
            model: command.model,
            runtimeMode: command.runtimeMode,
            modelSettings: command.modelSettings ?? {},
            ...(providerAccountId
              ? { providerAccountId }
              : {}),
            title: "New remote session",
            titleState: { source: "placeholder", epoch: 0, purpose: "initial", fallbackAttempted: false },
            ...(worktree
              ? { branch: worktree.branch ?? undefined }
              : {}),
            blocks: [],
          },
        };
      } else {
        value = this.store.session(command.sessionId);
        if (command.type === "send" && !value.session.assistantOwnerId) {
          this.botTaskWorktrees.touch(value.session.id);
          if ((command.draftBlockId || command.planBlockId || command.queuedMessageId) && this.assistantAdmission(value, origin))
            throw new Error(this.assistantAdmission(value, origin));
        }
        if (this.retiring.has(command.sessionId)) throw new Error("This legacy conversation is being deleted");
        assertCheckoutAvailable(this.store, sessionExecutionCwd(value.session));
        if (!managed) this.orchestration.assertSessionWrite(command.sessionId, command.type);
        if (command.type === "send" && command.intent === "orchestrate" && (value.status === "running" || value.session.queuedMessages?.length || this.orchestration.scheduler.run(command.sessionId)?.status === "active"))
          throw new Error("Wait for or stop the current turn before preparing assignments");
        if (value.session.nativeSession && (command.type === "send" || command.type === "compact")) {
          // Fail fast on a known owner; the turn re-checks under the lock before writing.
          const known = this.native.cached(command.sessionId);
          if (known && known.state !== "idle" && !this.nativeLeases.has(command.sessionId))
            throw new Error(nativeAccessMessage(known));
        }
        if (
          (command.type === "send" || command.type === "compact") &&
          this.switchingProjects.has(value.projectId)
        )
          throw new Error("Wait for the branch switch to finish");
        if (command.type !== "cancel" && this.switchingAccounts.has(command.sessionId))
          throw new Error("Wait for the account switch to finish");
        if (command.type === "send" && value.status !== "running" && value.session.pendingConfiguration) {
          if (this.running.has(command.sessionId))
            throw new Error("Wait for the current turn before changing settings");
          const configuration = value.session.pendingConfiguration;
          switchFrom = value.session.harness as RemoteProvider;
          value = this.switchSessionHarness(value, configuration.harness as RemoteProvider);
          value = { ...value, session: { ...value.session, ...configuration, pendingConfiguration: undefined } };
        }
        const provider = this.provider(value.session.harness);
        if (command.type === "send" && command.questionAnswer) {
          const prompt = questionFollowUp(value.session, command.questionAnswer);
          value = { ...value, session: recordQuestionAnswer(value.session, command.questionAnswer) };
          command.text = prompt;
          command.followUpBehavior = "steer";
        }
        if (command.type === "configure") {
          if (value.status === "running" || this.running.has(command.sessionId))
            throw new Error(
              "Wait for the current turn before changing settings",
            );
          const harness = command.harness ?? value.session.harness;
          const configuration = {
            harness, model: command.model, modelSettings: command.modelSettings,
            runtimeMode: command.runtimeMode,
          };
          const selected = selectComposerConfiguration(value.session, configuration);
          if (selected.pendingConfiguration) {
            this.provider(harness);
            value = { ...value, session: selected };
          } else {
            if (harness !== value.session.harness) {
              switchFrom = value.session.harness as RemoteProvider;
              value = this.switchSessionHarness(value, harness as RemoteProvider);
            }
            value = { ...value, session: { ...value.session, ...configuration, pendingConfiguration: undefined } };
          }
        } else if (command.type === "queue") {
          value = this.queueCommand(value, command, origin);
          effect = (saved) => {
            if (command.action === "hold")
              this.holdEditor(command.sessionId, command.editor!);
            if (command.action === "release" || command.action === "edit")
              this.clearEditor(command.sessionId);
            if (command.action === "steer")
              this.steerQueued(saved, command.messageId!);
            else this.dispatchQueue(saved.session.id);
          };
        } else if (
          command.type === "send" &&
          !command.queuedMessageId &&
          !command.draftBlockId &&
          !command.planBlockId &&
          (value.status === "running" || value.session.queuedMessages?.length || nativeHolding(value) || this.assistantAdmission(value, origin))
        ) {
          const attachments = resolveAttachments(
            this.store,
            command.attachments ?? [],
          );
          if ((value.session.queuedMessages?.length ?? 0) >= 100)
            throw new Error("Message queue is full");
          const active = this.running.get(value.session.id);
          const steer = !command.queueReturnPosition && command.followUpBehavior === "steer" &&
            value.status === "running" && !!provider.steer && !!active &&
            !active.finishing && !active.cancelled && !active.failed && !active.persistenceFailed &&
            !value.queueSteeringId && !value.session.editingQueuedMessageId &&
            value.session.queueStatus !== "paused";
          value = {
            ...value,
            ...(steer ? { queueSteeringId: command.commandId } : {}),
            session: {
              ...value.session,
              queuedMessages: insertQueuedMessage(value.session, {
                id: command.commandId,
                text: command.text,
                attachments,
                intent: command.intent,
                origin,
              }, command.queueReturnPosition, value.queueSteeringId),
              queueStatus: value.session.queueStatus ?? (value.session.usageLimit || this.running.get(value.session.id)?.failed ? "paused" : "active"),
            },
          };
          effect = (saved) => {
            if (steer) this.steerQueued(saved, command.commandId);
            else this.dispatchQueue(saved.session.id);
          };
        } else if (command.type === "draft") {
          if (
            value.status === "running" ||
            value.session.blocks.some((block) => block.draft)
          )
            throw new Error("This session cannot save another draft right now");
          const attachments = resolveAttachments(
            this.store,
            command.attachments ?? [],
          );
          value = {
            ...value,
            session: {
              ...value.session,
              title: value.session.blocks.length
                ? value.session.title
                : titleFromPrompt(
                    command.text,
                    value.session.harness,
                    attachments,
                  ),
              blocks: [
                ...value.session.blocks,
                {
                  id: command.commandId,
                  role: "user",
                  origin,
                  text: command.text,
                  ...(attachments.length ? { attachments } : {}),
                  draft: true,
                },
              ],
            },
          };
        } else if (command.type === "removeDraft") {
          const draft = value.session.blocks.find(
            (block) => block.id === command.draftBlockId && block.draft,
          );
          if (!draft) throw new Error("Draft not found");
          value = {
            ...value,
            session: {
              ...value.session,
              blocks: value.session.blocks.filter(
                (block) => block.id !== draft.id,
              ),
            },
          };
        } else if (command.type === "send" || command.type === "compact") {
          if (value.status === "running")
            throw new Error("This session is already running");
          if (nativeHolding(value))
            throw new Error("Native history is synchronizing; this conversation can continue when it is up to date");
          if (command.type === "compact" && !provider.compact)
            throw new Error(
              "Context compaction is unavailable for this provider",
            );
          const queued =
            command.type === "send" && command.queuedMessageId
              ? value.session.queuedMessages?.find(
                  (row) => row.id === command.queuedMessageId,
                )
              : undefined;
          if (command.type === "send" && command.queuedMessageId) {
            if (
              !queued ||
              queued.id !== queuedHead(value.session)?.id ||
              !canDispatchQueuedHead(value.session) ||
              value.queueSteeringId
            )
              throw new Error("Queued message is not ready to send");
            value = {
              ...value,
              session: dequeueQueuedMessage(value.session, queued.id),
            };
          }
          const prompt =
            command.type === "compact"
              ? "/compact"
              : (queued?.text ?? command.text);
          const intent =
            command.type === "send"
              ? queued?.intent === "plan" || queued?.intent === "build"
                ? queued.intent
                : command.intent
              : undefined;
          const draft =
            command.type === "send" && command.draftBlockId
              ? value.session.blocks.find(
                  (block) => block.id === command.draftBlockId && block.draft,
                )
              : undefined;
          if (command.type === "send" && command.draftBlockId && !draft)
            throw new Error("Draft not found");
          const plan =
            command.type === "send" && command.planBlockId
              ? value.session.blocks.find(
                  (block) =>
                    block.id === command.planBlockId && block.role === "plan",
                )
              : undefined;
          if (
            command.type === "send" &&
            command.planBlockId &&
            (!plan ||
              !plan.text.trim() ||
              plan.streaming ||
              plan.plan?.status === "building" ||
              plan.plan?.status === "built")
          )
            throw new Error("Plan is not ready to build");
          const attachments =
            command.type === "send"
              ? (queued?.attachments ??
                draft?.attachments ??
                resolveAttachments(this.store, command.attachments ?? []))
              : [];
          const runId = randomUUID();
          const firstTurn =
            command.type === "send" &&
            !value.session.blocks.some((block) => !block.draft);
          const placeholderTitle =
            value.session.title === "New remote session" ||
            canReplaceSessionTitle(
              value.session.title,
              value.session.harness,
              HARNESS_LABEL[value.session.harness],
            );
          const model = resolveModel(
            value.session.harness,
            value.session.model,
          );
          value = {
            ...value,
            status: "running",
            runId,
            session: {
              ...value.session,
              busy: true,
              executionState: { runId, phase: "starting", since: Date.now() },
              pendingQuestion: undefined,
              titleState: value.session.titleState ?? (firstTurn && placeholderTitle ? titleStateFor(value.session) : undefined),
              title:
                firstTurn && placeholderTitle
                  ? titleFromPrompt(prompt, value.session.harness, attachments)
                  : value.session.title,
              blocks: [
                ...value.session.blocks
                  .filter((block) => !block.draft)
                  .map((block) =>
                    block === plan
                      ? {
                          ...block,
                          plan: {
                            ...(block.plan ?? { status: "ready" as const }),
                            status: "building" as const,
                            approvedText: block.text,
                          },
                        }
                      : block,
                  ),
                {
                  id: queued?.id ?? command.commandId,
                  role: "user",
                  origin: queued?.origin ?? origin,
                  text: prompt,
                  ...(attachments.length ? { attachments } : {}),
                  ...(command.type === "send" && command.worktreeCreation
                    ? { worktreeCreation: command.worktreeCreation }
                    : {}),
                  startedAt: Date.now(),
                  checkpointTurnId: runId,
                  turnModel: {
                    harness: value.session.harness,
                    id: value.session.model,
                    name:
                      model.id === value.session.model
                        ? model.name
                        : value.session.model.replace(/^[^:]+:/, ""),
                  },
                },
              ],
            },
          };
          effect = (saved) => {
            this.run(
              saved,
              command.type === "compact" ? null : prompt,
              intent,
              attachments,
              command.type === "send" ? command.retryProposalBlockId : undefined,
              botContext,
            );
            if (firstTurn && command.type === "send") {
              this.generateFirstTurnNames(saved, prompt, placeholderTitle, command.refreshTitle);
            } else if (command.type === "send" && command.refreshTitle) {
              this.titles.begin(saved.session.id, prompt, true);
            }
          };
        } else {
          if (value.runId !== command.runId || value.status !== "running")
            throw new Error(
              "This request belongs to a finished or replaced turn",
            );
          if (command.type === "cancel") {
            value = {
              ...value,
              session: {
                ...value.session,
                queueStatus: value.session.queuedMessages?.length
                  ? "paused"
                  : undefined,
              },
            };
            effect = () => {
              const active = this.running.get(command.sessionId);
              if (active) { active.cancelled = true; active.abort.abort(); }
              void provider
                .cancel(command.sessionId)
                .catch(() => provider.stop(command.sessionId));
            };
          } else if (command.type === "approve") {
            const pending = value.session.blocks.some(
              (block) =>
                block.approval?.requestId === command.requestId &&
                !block.approval.decided,
            );
            if (!pending) throw new Error("Approval is already resolved");
            value = {
              ...value,
              session: applyHarnessEvent(value.session, {
                type: "approval.resolved",
                requestId: command.requestId,
                decision: command.decision,
              }),
            };
            effect = () =>
              provider.approve(
                command.sessionId,
                command.requestId,
                command.decision,
              );
          } else {
            if (value.session.pendingQuestion?.requestId !== command.requestId)
              throw new Error("Question is already resolved");
            value = {
              ...value,
              session: applyHarnessEvent(value.session, {
                type: "question.resolved", requestId: command.requestId,
                decision: command.reply.kind,
                ...(command.reply.kind === "answered" ? { reply: command.reply } : {}),
              }),
            };
            effect = () =>
              provider.answer(
                command.sessionId,
                command.requestId,
                command.reply,
              );
          }
        }
      }
      const saved = this.store.save(
        {
          ...value,
          ...(remoteControl && (command.type === "create" || command.type === "send" || command.type === "draft")
            ? { remoteControl: true, ...(remoteControlDevice ? { remoteControlDevice } : {}) } : {}),
          revision: value.revision + 1,
          // Creation already initialized both timestamps from the same clock read.
          updatedAt: command.type === "create" ? value.updatedAt : Date.now(),
        },
        { type: "command", command },
      );
      const result = {
        commandId: command.commandId,
        sessionId: saved.session.id,
        revision: saved.revision,
      };
      this.store.recordReceipt(signature, result);
      if (controlReceipt) this.recordControlReceipt(controlReceipt);
      return { receipt: result, saved };
    });
    const live = this.live.get(saved.session.id);
    if (live) live.value = saved;
    // Switch cleanup only runs after the send and its handoff commit atomically.
    if (switchFrom) this.finishHarnessSwitch(saved.session.id, switchFrom);
    // A receipt means durable host acceptance, not provider completion.
    effect?.(saved);
    return receipt;
  }

  private queueCommand(
    value: HostSession,
    command: Extract<HostCommand, { type: "queue" }>,
    origin?: import("../src/features/sessions/model/session").TurnOrigin,
  ): HostSession {
    const { session } = value;
    const row = session.queuedMessages?.find(
      (entry) => entry.id === command.messageId,
    );
    if (command.action !== "resume" && command.action !== "release" && !row)
      throw new Error("Queued message not found");
    const editor = this.editors.get(session.id);
    if (
      ["hold", "edit", "release"].includes(command.action) &&
      editor &&
      editor.owner !== command.editor
    )
      throw new Error("This queue is being edited on another device");
    if (command.action === "edit" && !editor)
      throw new Error("Queue edit expired. Open the editor again");
    if (
      row &&
      (value.queueSteeringId === row.id ||
        (session.editingQueuedMessageId === row.id &&
          command.action === "steer"))
    )
      throw new Error("This queued message is already in use");
    switch (command.action) {
      case "move": {
        if (value.queueSteeringId || session.editingQueuedMessageId)
          throw new Error("Wait for the current queue operation to finish");
        if (command.beforeId === row!.id) return value;
        const remaining = session.queuedMessages!.filter((message) => message.id !== row!.id);
        const destination = command.beforeId === undefined ? remaining.length : remaining.findIndex((message) => message.id === command.beforeId);
        if (destination < 0) throw new Error("Queued destination not found");
        remaining.splice(destination, 0, row!);
        return { ...value, session: { ...session, queuedMessages: remaining } };
      }
      case "hold":
        return {
          ...value,
          session: { ...session, editingQueuedMessageId: row!.id },
        };
      case "release":
        return {
          ...value,
          session: { ...session, editingQueuedMessageId: undefined },
        };
      case "edit": {
        if (session.editingQueuedMessageId !== row!.id)
          throw new Error("Queued message is not being edited");
        if (!command.text!.trim() && !row!.attachments.length)
          throw new Error("Invalid queued message");
        return {
          ...value,
          session: {
            ...session,
            editingQueuedMessageId: undefined,
            queuedMessages: session.queuedMessages!.map((entry) =>
              entry.id === row!.id ? { ...entry, text: command.text!, origin, blocked: undefined } : entry,
            ),
          },
        };
      }
      case "remove":
        if (session.editingQueuedMessageId === row!.id)
          throw new Error("Finish editing this queued message first");
        return { ...value, session: dequeueQueuedMessage(session, row!.id) };
      case "resume":
        if (
          value.status === "running" ||
          session.editingQueuedMessageId ||
          value.queueSteeringId
        )
          throw new Error("Wait for the current turn or queue edit to finish");
        return {
          ...value,
          session: {
            ...session,
            usageLimit: undefined,
            queueStatus: session.queuedMessages?.length ? "active" : undefined,
          },
        };
      case "steer": {
        const active = this.running.get(session.id);
        if (
          !active ||
          active.finishing ||
          active.cancelled ||
          active.runId !== command.runId ||
          value.status !== "running"
        )
          throw new Error(
            "This request belongs to a finished or replaced turn",
          );
        if (!this.provider(session.harness).steer)
          throw new Error("This provider does not support steering");
        if (value.queueSteeringId)
          throw new Error("Another queued message is being steered");
        return { ...value, queueSteeringId: row!.id };
      }
    }
  }

  private clearEditor(id: string): void {
    clearTimeout(this.editors.get(id)?.timer);
    this.editors.delete(id);
  }

  private holdEditor(id: string, owner: string): void {
    this.clearEditor(id);
    const timer = setTimeout(() => {
      this.clearEditor(id);
      try {
        this.flush(id);
        const value = this.store.session(id);
        const saved = this.save(
          {
            ...value,
            session: {
              ...value.session,
              editingQueuedMessageId: undefined,
              queueStatus: value.session.queuedMessages?.length
                ? "paused"
                : undefined,
            },
          },
          { type: "queue.editExpired" },
        );
        const live = this.live.get(id);
        if (live) live.value = saved;
      } catch (error) {
        console.error("Could not expire queue editor:", error);
      }
    }, 90_000);
    timer.unref?.();
    this.editors.set(id, { owner, timer });
  }

  private dispatchQueue(id: string): void {
    if (this.closing || this.running.has(id)) return;
    const value = this.store.session(id);
    if (this.machines && currentMachineIO().key !== projectMachineKey(this.store.project(value.projectId).machine))
      return this.machines.forSession(id, () => this.dispatchQueue(id));
    if (
      value.status === "running" ||
      value.queueSteeringId ||
      nativeHolding(value) ||
      !canDispatchQueuedHead(value.session)
    )
      return;
    const row = queuedHead(value.session)!;
    if (this.assistantAdmission(value, row.origin)) return;
    if (row.origin && !this.authorizeAssistantQueued?.(row.origin, value.projectId, value.session.id)) {
      const remaining = value.session.queuedMessages!.map(q => q.id === row.id ? { ...q, blocked: "Assistant message blocked because its permission was revoked." } : q);
      this.save({ ...value, session: { ...value.session, queuedMessages: remaining,
        blocks: [...value.session.blocks, { id: `blocked:${row.id}`, role: "system", text: "Assistant message blocked because its permission was revoked." }],
        queueStatus: remaining.length ? "active" : undefined } }, { type: "assistant.queueBlocked", origin: row.origin });
      this.dispatchQueue(id);
      return;
    }
    try {
      this.applyCommand({
        type: "send",
        commandId: `queue-send:${createHash("sha256").update(row.id).digest("hex")}`,
        sessionId: id,
        queuedMessageId: row.id,
        text: row.text,
        intent:
          row.intent === "plan" || row.intent === "build"
            ? row.intent
            : "default",
      }, false, undefined, row.origin);
    } catch (error) {
      console.error("Could not dispatch queued message:", error);
      this.save(
        {
          ...this.store.session(id),
          session: { ...this.store.session(id).session, queueStatus: "paused" },
        },
        { type: "queue.dispatchFailed" },
      );
    }
  }

  private steerQueued(value: HostSession, messageId: string): void {
    const { session } = value;
    const row = session.queuedMessages!.find(
      (entry) => entry.id === messageId,
    )!;
    if (row.blocked) throw new Error(row.blocked);
    const active = this.running.get(session.id)!;
    active.controls = active.controls.then(async () => {
      try {
        const provider = this.provider(session.harness);
        const prepared = await this.skills.prepare(row.text, { harness: session.harness as RemoteProvider, cwd: sessionExecutionCwd(session), sessionId: session.id }, provider);
        if (active.cancelled || active.finishing || this.closing) throw new Error("Turn stopped before the queued message could be steered");
        if (row.origin && !this.authorizeAssistantQueued?.(row.origin, value.projectId, value.session.id)) throw new Error("Assistant permission was revoked");
        await provider.steer!({
          sessionId: session.id,
          cwd: sessionExecutionCwd(session),
          model: session.model,
          modelSettings: session.modelSettings,
          text: prepared,
          attachments: this.providerAttachments(row.attachments),
        });
        this.flush(session.id);
        const latest = this.store.session(session.id);
        const steered = appendSteerUser(dequeueQueuedMessage(latest.session, row.id), row.text, row.attachments);
        // Keep the queue acceptance ID when it becomes a transcript message.
        steered.blocks[steered.blocks.length - 1] = {
          ...steered.blocks[steered.blocks.length - 1],
          id: row.id,
          sentAt: Date.now(),
          origin: row.origin,
        };
        const saved = this.save({ ...latest, queueSteeringId: undefined, session: steered }, { type: "queue.steered", messageId });
        const live = this.live.get(session.id);
        if (live) live.value = saved;
      } catch (error) {
        // Retain the row for review. Retrying the receipt never injects it twice.
        this.event(session.id, active.runId, {
          type: "session.error",
          message: `Could not steer queued message: ${error instanceof Error ? error.message : String(error)}`,
        });
        this.flush(session.id);
        const latest = this.store.session(session.id);
        const saved = this.save(
          {
            ...latest,
            queueSteeringId: undefined,
            session: {
              ...latest.session,
              queueStatus: latest.session.queuedMessages?.length
                ? "paused"
                : undefined,
            },
          },
          { type: "queue.steerFailed", messageId },
        );
        const live = this.live.get(session.id);
        if (live) live.value = saved;
      }
    });
  }

  private providerAttachments(attachments: Attachment[]): Attachment[] {
    return attachments.map((file) =>
      isVisionImage(file.mimeType) && file.path && file.size <= 20 * 1024 * 1024
        ? { ...file, data: readFileSync(file.path).toString("base64") }
        : file,
    );
  }

  async generateWorktreeName(
    projectId: unknown,
    requestedCwd: unknown,
    harness: unknown,
    message: unknown,
  ): Promise<string> {
    const project = this.store.project(text(projectId, "project"));
    const cwd = await resolveHostWorktreeAsync(project.cwd, requestedCwd);
    if (!isRemoteProvider(harness)) throw new Error("Invalid provider");
    const provider = this.provider(harness);
    const prompt = text(message, "worktree message", 100_000);
    const generated = await generateWorktreeBranch([
      () => this.titleModel.generateBranch(prompt),
      () => provider.generateBranchName?.(cwd, prompt) ?? Promise.resolve(null),
    ]);
    const [branches, trees] = await Promise.all([hostBranches(cwd), hostWorktrees(project.cwd)]);
    return availableWorktreeBranch(generated, branches.branches, trees.worktrees.map((tree) => tree.path));
  }

  private generateFirstTurnNames(
    value: HostSession,
    message: string,
    generateTitle: boolean,
    refreshTitle = false,
  ): void {
    const provider = this.provider(value.session.harness);
    const { id, cwd } = value.session;
    if (generateTitle || refreshTitle) this.titles.begin(id, message, refreshTitle);
    const temporary = value.autoWorktreeBranch;
    if (temporary && provider.generateBranchName) {
      void provider
        .generateBranchName(cwd, message)
        .then(async (fragment) => {
          const branch = fragment ? namedWorktreeBranch(fragment) : null;
          if (!branch) return;
          // A title/branch request may finish after the conversation was deleted.
          const currentBeforeRename = this.store.session(id);
          if (currentBeforeRename.autoWorktreeBranch !== temporary) return;
          const project = this.store.project(value.projectId);
          await renameHostWorktreeBranch(
            project.cwd,
            cwd,
            temporary,
            branch,
            () => this.store.session(id).autoWorktreeBranch === temporary,
          );
          this.flush(id);
          const current = this.store.session(id);
          const saved = this.save(
            {
              ...current,
              autoWorktreeBranch: undefined,
              session: { ...current.session, branch },
            },
            { type: "session.generatedBranch", branch },
          );
          const live = this.live.get(id);
          if (live) live.value = saved;
        })
        .catch((error) =>
          console.debug("[omnicode] remote worktree branch", error),
        );
    }
  }

  private cleanPreviousProviders(id: string): Promise<void> {
    const active = this.providerCleanups.get(id);
    if (active) return active;
    const stops = this.providerStops.get(id);
    if (!stops?.size) return Promise.resolve();
    const cleanup = Promise.resolve().then(async () => {
      // Picker changes can arrive again while an adapter is still stopping.
      while (stops.size) {
        const harness = stops.values().next().value!;
        await this.provider(harness).stop(id);
        stops.delete(harness);
      }
      this.providerStops.delete(id);
      this.checkoutReleases.get(id)?.();
      this.checkoutReleases.delete(id);
    }).finally(() => {
      if (this.providerCleanups.get(id) === cleanup) this.providerCleanups.delete(id);
    });
    this.providerCleanups.set(id, cleanup);
    return cleanup;
  }

  private run(
    value: HostSession,
    prompt: string | null,
    intent?: "default" | "plan" | "build" | "orchestrate",
    attachments: Session["blocks"][number]["attachments"] = [],
    retryProposalBlockId?: string,
    botContext?: HarnessBotContext,
  ): void {
    const { session, runId } = value;
    if (this.machines && currentMachineIO().key !== projectMachineKey(this.store.project(value.projectId).machine))
      return this.machines.forSession(session.id, () => this.run(value, prompt, intent, attachments, retryProposalBlockId, botContext));
    const parked = this.parked.get(session.id);
    if (parked) { clearTimeout(parked.timer); this.parked.delete(session.id); }
    const provider = this.provider(session.harness);
    const resources = new HostResourceGuard(this.store);
    // Orchestration already coordinates file scopes between its own workers.
    const orchestration = this.orchestration.scheduler.run(session.id);
    const lead = session.orchestrationLeadId ?? (intent === "orchestrate" || orchestration?.status === "active" || orchestration?.status === "paused" ? session.id : undefined);
    // Workflow lineage is written only by createWorkflowWorker. Children join
    // their live parent's lease so a parent can await them without deadlocking.
    const workflowOwner = session.workflowParentId
      ? this.running.get(session.workflowParentId)?.resourceOwner ?? `workflow:${session.workflowRunId}`
      : undefined;
    const resourceOwner = botContext?.scope.runId ?? workflowOwner ?? (lead ? `orchestration:${lead}` : runId!);
    const capabilities = botContext ? this.botCapabilities(session.harness, botContext) : undefined;
    const providerText = (text: string) => capabilities?.systemInstructions === "context-block" ? botContextPrompt(text, botContext) : text;
    const active = {
      runId: runId!,
      resourceOwner,
      abort: new AbortController(),
      done: Promise.resolve(),
      controls: Promise.resolve(),
      finishing: false,
      failed: false,
      cancelled: false,
      persistenceFailed: false,
    };
    this.running.set(session.id, active);
    this.live.set(session.id, { value, events: [] });
    active.done = Promise.resolve()
      .then(() => withCheckoutOwner(this.store, resourceOwner, async () => {
        let error: string | undefined;
        let checkpointTurn: string | undefined;
        try {
          this.executionPhase(session.id, runId!, "starting");
          await this.cleanPreviousProviders(session.id);
          // Waiting has no provider side effects and remains cancellable. A restart
          // interrupts this accepted run rather than replaying an uncertain send.
          await this.resourceWaiter.wait(resources, resourceOwner, {
            workingDirectory: sessionExecutionCwd(session), computer: botContext?.tools?.computer,
          }, active.abort.signal, blockers => this.executionPhase(session.id, runId!, "waiting-resource", blockers));
          if (!this.closing && !active.cancelled) {
            this.executionPhase(session.id, runId!, "starting");
            if (!this.boundSessions.has(session.id) && session.providerSessionId)
              this.bindRetainedSession(session);
            if (!this.checkoutReleases.has(session.id)) this.checkoutReleases.set(session.id, claimCheckoutResource(this.store, `host-provider:${session.id}:${randomUUID()}`, sessionExecutionCwd(session)));
            const rawCommand = provider.commands?.rawSlashCommands && /^\s*\/\S+/.test(prompt ?? "");
            const handoff = prompt === null || rawCommand ? null : pendingHandoff(session);
            const priorRequests = handoff ? userMessagesAfterHandoff(session).slice(0, -1) : [];
            const turnPrompt = intent === "orchestrate" ? await this.orchestration.preparePlanning(value, prompt!, retryProposalBlockId) : prompt === null ? null : this.workflows.prompt(session.id, this.orchestration.prompt(session.id, prompt));
            const input: HarnessSessionInput = {
              sessionId: session.id,
              botContext,
              controlsAgents: !!botContext?.controlCli,
              cwd: sessionExecutionCwd(session),
              model: session.model,
              modelSettings: session.modelSettings,
              providerAccountId: session.providerAccountId,
              ...(session.harness === "claude" ? { claudeHooks: this.clientState.preferencesRead()!.values["omnicode.claudeHooks"] !== "0" } : {}),
              runtimeMode: session.runtimeMode,
              intent: intent === "orchestrate" ? "plan" : intent,
              onEvent: (event) => { if (!this.orchestration.planningEvent(session.id, event)) this.event(session.id, runId!, event, session.harness, session.providerAccountId); },
            };
            // A OmniCode-started conversation continued elsewhere becomes a managed native session.
            if (!session.nativeSession && this.store.session(session.id).nativeBinding)
              await this.nativeSessions.promoteIfChanged(session.id);
            if (this.store.session(session.id).session.nativeSession && !this.nativeLeases.has(session.id)) {
              const turnBlockId = value.session.blocks.findLast((block) => block.role === "user" && !block.draft)?.id ?? "";
              // Lease, ownership recheck and pre-send catch-up happen before the provider writes.
              this.nativeLeases.set(session.id, await this.nativeSessions.prepare(session.id, turnBlockId));
              const prepared = this.store.session(session.id).session;
              this.bindRetainedSession(prepared);
              input.nativeSession = prepared.nativeSession;
            }
            if (prompt === null) await provider.compact!(input);
            else {
              if (this.checkpointed(session)) {
                // Capture errors are persisted and shown in the review.
                await this.checkpoints.beginTurn(session.id, sessionExecutionCwd(session), runId!).catch(() => undefined);
                checkpointTurn = runId!;
              }
              const prepared = await this.skills.prepare(turnPrompt!, { harness: session.harness as RemoteProvider, cwd: sessionExecutionCwd(session), sessionId: session.id }, provider);
              if (!this.closing && !active.cancelled) await provider.send({
                ...input,
                onAccepted: () => {
                  if (this.live.get(session.id)?.value.session.executionState?.phase === "starting")
                    this.executionPhase(session.id, runId!, "awaiting-response");
                },
                text: providerText(handoff ? wrapHandoffPrompt(handoff.text, handoff.from, prepared, priorRequests) : prepared),
                attachments: attachments?.map((file) =>
                  session.harness !== "codex" &&
                  isVisionImage(file.mimeType) &&
                  file.path &&
                  file.size <= 20 * 1024 * 1024
                    ? {
                        ...file,
                        data: readFileSync(file.path).toString("base64"),
                      }
                    : file,
                ),
              });
              if (intent === "orchestrate" && !active.cancelled && !active.failed && !this.closing) {
                const repair = this.orchestration.repairPlanning(session.id);
                if (repair) await provider.send({ ...input, text: providerText(repair), attachments: [] });
              }
              // A failed or cancelled delivery keeps the context packet for retry.
              if (handoff && !active.cancelled && !active.failed && !active.persistenceFailed && !this.closing) {
                this.mutateManaged(session.id,
                  (current) => ({ ...current, session: consumeHandoff(current.session) }),
                  { type: "handoff.delivered" }, false);
              }
            }
          }
        } catch (reason) {
          error = reason instanceof HostResourceBusyError ? `${reason.code}: ${reason.message}` : reason instanceof Error ? reason.message : String(reason);
        }
        active.finishing = true;
        this.executionPhase(session.id, runId!, "settling");
        await active.controls;
        // Keep the session running until the old process has stopped. Otherwise
        // a follow-up can race cleanup and have its newly spawned child killed.
        const managedRun = this.orchestration.scheduler.forSession(session.id);
        // A native session's CLI must not stay alive after the turn: the desktop
        // and the user's own CLI would see it as an owner.
        const nativeTurn = !!this.store.sessionIfExists(session.id)?.session.nativeSession;
        if (error || active.failed || active.cancelled || this.closing || active.persistenceFailed || !!managedRun || !!botContext || !provider.readSessionTitle || nativeTurn) {
          await provider.stop(session.id);
          this.checkoutReleases.get(session.id)?.(); this.checkoutReleases.delete(session.id);
        }
        else {
          const timer = setTimeout(() => {
            this.parked.delete(session.id);
            if (this.running.has(session.id)) return;
            // stop() also forgets the adapter's resume binding. The next turn
            // must wait for cleanup and bind the persisted conversation again.
            this.boundSessions.delete(session.id);
            const stops = this.providerStops.get(session.id) ?? new Set<RemoteProvider>();
            stops.add(session.harness as RemoteProvider);
            this.providerStops.set(session.id, stops);
            void this.cleanPreviousProviders(session.id).catch(() => undefined);
          }, 5 * 60_000);
          timer.unref?.();
          this.parked.set(session.id, { harness: session.harness, timer });
        }
        // Stopped and failed providers have exited above; parked ones finished
        // their turn. Either way the workspace is settled for the final snapshot.
        if (checkpointTurn)
          await this.checkpoints.finishTurn(session.id, sessionExecutionCwd(session), checkpointTurn).catch(() => undefined);
        // Publish an idle turn only after its native writer lock is released.
        // Otherwise an immediate follow-up can contend with this Host itself.
        // Settlement reads the stable native history before the lease is released.
        const nativeLease = this.nativeLeases.get(session.id);
        this.nativeLeases.delete(session.id);
        if (nativeLease)
          await this.nativeSessions.settle(session.id, nativeLease).catch((reason) =>
            console.error("Native settlement failed:", reason instanceof Error ? reason.message : reason));
        this.native.forget(session.id);
        // The writer is settled. Release before idle callbacks capture or integrate
        // an orchestration workspace (the outer finally remains the failure guard).
        resources.close();
        this.flush(session.id);
        this.live.delete(session.id);
        this.checkpointCalls.delete(session.id);
        const latest = this.store.session(session.id);
        if (latest.runId === runId) {
          const message = this.closing
            ? "Host stopped. This turn was interrupted."
            : active.persistenceFailed
              ? "Session storage failed during this turn. Inspect its work before continuing."
              : active.cancelled
              ? "Stopped by you."
              : error;
          this.save(
            this.settled(
              latest,
              this.closing || active.persistenceFailed ? "interrupted" : "idle",
              message,
            ),
            { type: "settled", error, cancelled: active.cancelled },
          );
        }
        this.running.delete(session.id);
        if (intent === "orchestrate") this.orchestration.finishPlanning(session.id, active.cancelled || this.closing ? "Planning was interrupted. Generate the assignments again." : error || (active.failed ? "The provider failed while planning assignments" : undefined));
        await this.orchestration.workerSettled(session.id);
        const completion = this.managedCompletions.get(session.id);
        this.managedCompletions.delete(session.id);
        if (!this.closing && completion) {
          const blocks = this.store.session(session.id).session.blocks;
          const result = blocks.slice(session.blocks.length).filter((block) => block.role === "assistant").map((block) => block.text).join("\n");
          const metrics = blocks.slice(Math.max(0, session.blocks.length - 1)).findLast((block) => block.role === "user")?.turnMetrics;
          const toolCalls = blocks.slice(session.blocks.length).filter((block) => block.role === "tool").length;
          completion({ status: active.cancelled ? "cancelled" : error || active.failed || active.persistenceFailed ? "failed" : "completed", text: result.slice(-20_000), ...(error ? { error } : {}), ...(metrics ? { metrics } : {}), toolCalls });
        }
        if (!this.closing) this.orchestration.sync();
        this.titles.settled(session.id, active.cancelled || this.closing || active.persistenceFailed);
        if (!this.closing && !nativeTurn) {
          try { this.nativeSessions.recordLazy(session.id); } catch (reason) {
            console.error("Could not record native identity:", reason instanceof Error ? reason.message : reason);
          }
        }
        // stop/forget releases callbacks and native resources; bind only retained
        // provider conversation identity for an explicit future follow-up.
        const persisted = this.store.session(session.id).session;
        if (persisted.providerSessionId)
          this.bindRetainedSession(persisted);
        if (
          !error &&
          !active.failed &&
          !active.cancelled &&
          !active.persistenceFailed &&
          !this.closing
        )
          this.dispatchQueue(session.id);
      }))
      .catch(async (error) => {
        clearTimeout(this.live.get(session.id)?.timer);
        console.error(
          "Session persistence failed; stopping its provider:",
          error instanceof Error ? error.message : "unknown error",
        );
        await provider.stop(session.id).catch(() => undefined);
        this.retrySettlement(session.id, runId!, provider);
      }).finally(() => resources.close());
  }

  private executionPhase(id: string, runId: string, phase: NonNullable<Session["executionState"]>["phase"], blockers?: NonNullable<Session["executionState"]>["blockers"], persist = true): void {
    const live = this.live.get(id);
    if (!live || live.value.runId !== runId || live.value.status !== "running") return;
    const previous = live.value.session.executionState;
    if (previous?.runId === runId && previous.phase === phase && JSON.stringify(previous.blockers) === JSON.stringify(blockers)) return;
    const since = previous?.phase === phase ? previous.since : Date.now();
    const state: NonNullable<Session["executionState"]> = { runId, phase, since,
      providerStartedAt: previous?.providerStartedAt ?? (phase === "awaiting-response" || phase === "active" ? Date.now() : undefined),
      ...(blockers ? { blockers, reason: blockers.some(b => b.kind === "computer") ? "computer" : blockers.some(b => b.kind === "removing") ? "removing" : "integrating" } : {}),
    };
    if (persist) this.flush(id);
    const next = { ...live.value, session: { ...live.value.session, executionState: state } };
    live.value = persist ? this.save(next, { type: "session.executionState", state }) : next;
  }

  private event(id: string, runId: string, event: HarnessEvent, expectedHarness?: string, expectedAccount?: string): void {
    if (event.type === "session.titleUpdated" || event.type === "session.titleRefreshRequested") {
      if (this.closing) return;
      let current: HostSession; try { current = this.store.session(id); } catch { return; }
      if (current.session.providerSessionId === event.providerSessionId && (!expectedHarness || current.session.harness === expectedHarness) && (current.session.providerAccountId ?? "default") === (expectedAccount ?? "default")) {
        if (event.type === "session.titleUpdated") this.titles.native(id, event.providerSessionId, event.title);
        else void this.titles.read(id);
      }
      return;
    }
    const live = this.live.get(id);
    if (!live || live.value.runId !== runId || live.value.status !== "running")
      return;
    const phase = live.value.session.executionState?.phase;
    if ((event.type === "session.started" || event.type === "turn.started") && phase !== "active" && phase !== "settling")
      this.executionPhase(id, runId, "awaiting-response");
    else if (["message.delta", "reasoning.delta", "tool.started", "image.generated"].includes(event.type) && phase !== "active" && phase !== "settling")
      this.executionPhase(id, runId, "active", undefined, false);
    if (event.type === "session.error" || event.type === "usage.limited") {
      const active = this.running.get(id);
      if (active) active.failed = true;
      live.value = {
        ...live.value,
        session: {
          ...live.value.session,
          queueStatus: live.value.session.queuedMessages?.length
            ? "paused"
            : undefined,
        },
      };
    }
    let savedImage: Attachment | undefined;
    if (event.type === "image.generated" && "data" in event) {
      if (live.imageRunId !== runId) { live.imageRunId = runId; live.imageIds = new Set(); }
      const imageKey = `${event.agentCallId ?? "root"}:${event.itemId}`;
      if (live.imageIds!.has(imageKey)) return;
      live.imageIds!.add(imageKey);
      try {
        if (
          event.mimeType &&
          event.mimeType.trim().toLowerCase() !== "image/png"
        )
          throw new Error("Unsupported generated image type");
        savedImage = saveGeneratedImageAttachment(
          this.store,
          event.data,
          event.name,
        );
        event = {
          type: "image.generated",
          itemId: event.itemId,
          ...(event.agentCallId ? { agentCallId: event.agentCallId } : {}),
          path: savedImage.path!,
          name: savedImage.name,
          mimeType: savedImage.mimeType,
          size: savedImage.size,
          attachment: savedImage,
          ...(event.alt ? { alt: event.alt } : {}),
        };
      } catch (error) {
        const message = `Could not save generated image: ${error instanceof Error ? error.message : String(error)}`;
        event = event.agentCallId
          ? { type: "agent.step", callId: event.agentCallId, stepId: `${event.itemId}:error`, kind: "message", text: message }
          : { type: "session.error", message };
      }
    }
    this.orchestration.observe(id, event);
    this.trackCheckpoint(live.value.session, event);
    const previousSession = live.value.session;
    const session = applyHarnessEvent(live.value.session, event);
    if (session === live.value.session) return;
    live.value = { ...live.value, session };
    live.events.push(event);
    this.orchestration.sync();
    if (event.type === "session.providerBound") { this.flush(id); void this.titles.read(id); }
    if (!BATCHED.has(event.type)) {
      if (!this.scheduledFlush(id, this.provider(session.harness)) && savedImage) {
        try { unlinkSync(savedImage.path!); } catch { /* Keep persistence failure primary. */ }
        live.value = { ...live.value, session: previousSession };
        live.events = live.events.filter((value) => value !== event);
      }
    }
    else
      live.timer ??= setTimeout(
        () => this.scheduledFlush(id, this.provider(session.harness)),
        FLUSH_MS,
      );
  }

  private settled(
    value: HostSession,
    status: "idle" | "interrupted",
    message?: string,
    endedAt = Date.now(),
  ): HostSession {
    const stopped = stopStreaming(value.session, endedAt);
    const session = {
      ...stopped,
      executionState: undefined,
      queueStatus:
        stopped.queuedMessages?.length && (message || status === "interrupted")
          ? ("paused" as const)
          : stopped.queueStatus,
      blocks: stopped.blocks.map((block) =>
        block.role === "plan" && block.plan?.status === "building"
          ? {
              ...block,
              plan: {
                ...block.plan,
                status:
                  status === "idle" && !message
                    ? ("built" as const)
                    : ("ready" as const),
              },
            }
          : block,
      ),
    };
    if (message)
      session.blocks.push({
        id: randomUUID(),
        role: "system",
        text: message,
        streaming: false,
      });
    return {
      ...value,
      status,
      lastCompletedRunId: status === "idle" ? value.runId : value.lastCompletedRunId,
      queueSteeringId: undefined,
      session,
    };
  }

  /** Variables from the named environment that contains this session's folder. */
  environmentVariables(id: string): Record<string, string> {
    const value = this.store.sessionIfExists(id);
    if (!value) return {};
    return this.clientState.environmentVariables(sessionExecutionCwd(value.session), this.store.project(value.projectId).machine);
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.botTaskWorktrees.close();
    for (const active of this.running.values()) active.abort.abort();
    this.resourceWaiter.close();
    this.nativeSessions.close();
    await this.im.close();
    await this.workflows.close();
    await this.bots.close();
    await this.orchestration.close();
    this.titles.close();
    this.skills.close();
    this.notes.close();
    await Promise.allSettled([...this.providerStops.keys()].map(id => this.cleanPreviousProviders(id)));
    await Promise.all([...this.parked.entries()].map(async ([id, entry]) => { clearTimeout(entry.timer); await this.provider(entry.harness).stop(id); }));
    this.parked.clear();
    for (const editor of this.editors.values()) clearTimeout(editor.timer);
    this.editors.clear();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    await Promise.all(
      [...this.running.keys()].map((id) =>
        this.provider(this.store.session(id).session.harness).stop(id),
      ),
    );
    await Promise.all([...this.running.values()].map((active) => active.done));
    for (const release of this.checkoutReleases.values()) release();
    this.checkoutReleases.clear();
  }
}
