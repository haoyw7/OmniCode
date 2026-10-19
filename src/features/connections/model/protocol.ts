import type { Block, Session, RuntimeMode, RemoteControlDevice } from "../../sessions/model/session";
import type { QuestionAnswer, UserQuestionReply } from "../../sessions/model/userQuestion";
import type { AgentModel } from "../../sessions/model/models";
import type { LinkedWorkItem, QueueReturnPosition } from "../../sessions/model/session";
import type { Skill } from "../../skills/model/skillTypes";
import type { HarnessId } from "../../sessions/model/session";
import type { OrchestrationWorkspace, TaskStatus } from "../../orchestration/model/orchestrationState";
import type { ProposedTask } from "../../orchestration/model/orchestrationPlan";
import type { SessionNotificationPreview } from "../../sessions/model/sessionActivity";
import type { PersistedWorktreeCreation } from "../../source-control/model/worktreeCreation";
import { isRemoteProvider, type RemoteProvider } from "../../../integrations/harness/core/provider";
export { REMOTE_PROVIDERS, isRemoteProvider, type RemoteProvider } from "../../../integrations/harness/core/provider";

/** Public run projection. Execution credentials and journals remain on Host. */
export type HostOrchestrationView = {
  id: string;
  leadId: string;
  proposalId?: string;
  cwd: string;
  workspace?: OrchestrationWorkspace;
  status: "active" | "paused" | "stopped" | "finished";
  allowedHarnesses: HarnessId[];
  maxWorkers: number;
  tasks: {
    id: string;
    sessionId: string;
    title: string;
    harness: HarnessId;
    model: string;
    status: TaskStatus;
    error?: string;
    needsInput?: boolean;
  }[];
  error?: string;
  resumeBlocker?: { sessionId: string; title: string };
  resumeLeadBusy?: boolean;
};

export type HostOrchestrationCommand =
  | {
      type: "orchestration";
      action: "editProposal" | "confirmProposal";
      commandId: string;
      projectId: string;
      sessionId: string;
      proposalBlockId: string;
      expectedRevision: number;
      edit?: { maxWorkers: number; tasks: ProposedTask[] };
    }
  | {
      type: "orchestration";
      action: "resume" | "stop" | "cancelTask";
      commandId: string;
      projectId: string;
      sessionId: string;
      orchestrationId: string;
      taskId?: string;
    };

export const HOST_PROTOCOL_VERSION = 1;
/** Optional hardware metadata reported by a paired client. */
export type HostDeviceInfo = {
  /** Private app installation UUID; independent of network addresses, never an access token. */
  installationId?: string;
  deviceType?: "desktop" | "mobile";
  hostname?: string;
  model?: string;
  manufacturer?: string;
};

export type HostDescriptor = {
  protocolVersion: number;
  environmentId: string;
  name: string;
  providers: RemoteProvider[];
  capabilities: string[];
  platform?: "win32" | "darwin" | "linux";
};
export type HostProject = { id: string; cwd: string; name: string; kind?: "assistant"; machine?: import("../../../integrations/harness/core/machine").ProjectMachine };
export type HostDirectory = {
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
};
export type HostModelCatalog = {
  models: Partial<Record<RemoteProvider, AgentModel[]>>;
  errors: Partial<Record<RemoteProvider, string>>;
};
/** Named login profiles the paired desktop shares; `default` is the CLI's own. */
export type HostAccountIdentity = { email?: string; name?: string; plan?: string; organization?: string };
export type HostProviderAccount = {
  id: string;
  label: string;
  identity?: HostAccountIdentity;
  /** Builtin entry describes where a new conversation following Host defaults goes. */
  defaultAccountId?: string;
  defaultAccountLabel?: string;
  defaultIdentity?: HostAccountIdentity;
  defaultError?: string;
};
export type HostProviderAccounts = Partial<
  Record<RemoteProvider, HostProviderAccount[]>
>;
export type HostProviderUsageRequest = {
  provider: "claude" | "codex";
  accountId: string;
  refresh?: boolean;
};
export type HostProviderUsage = import("../../providers/model/rateLimits").ProviderRateLimits;
export type HostSkillCatalog = {
  skills: Skill[];
  native: boolean;
  canCompact: boolean;
};
export type HostWorktree = {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  missing: boolean;
  /** Git's own output while a new worktree was created, one line per entry. */
  log?: string[];
};
export type HostSession = {
  /** Execution differences such as a WSL-installed provider or filtered configuration. */
  executionWarnings?: string[];
  /** A paired device created or sent a message in this conversation. */
  remoteControl?: boolean;
  remoteControlDevice?: RemoteControlDevice;
  /** Client-only estimate: Host time minus local time; never changes stored timestamps. */
  clockOffsetMs?: number;
  session: Session;
  projectId: string;
  revision: number;
  runId?: string;
  status: "idle" | "running" | "interrupted";
  /** Queue ownership stays on the Host for every connected client. */
  supportsQueue?: boolean;
  canSteer?: boolean;
  queueSteeringId?: string;
  /** Missing from snapshots written before creation time was stored. */
  createdAt?: number;
  updatedAt: number;
  /** Revision of the latest received reply/input/completed turn, not metadata. */
  lastReplyRevision?: number | null;
  /** Durable completion identity survives an immediately dispatched queued turn. */
  lastCompletedRunId?: string | null;
  archived?: boolean;
  pinned?: boolean;
  /** Temporary branch created by the composer for automatic first-turn naming. */
  autoWorktreeBranch?: string;
  /** Host-only: the revision at which each block last changed. */
  blockRevisions?: Record<string, number>;
  /** Host-managed native history status (absent for ordinary sessions and older Hosts). */
  nativeStatus?: import("../../../integrations/harness/core/nativeSessions").NativeSyncStatus;
  /** Host-only lazy identity for a OmniCode-started provider conversation. */
  nativeBinding?: import("../../../integrations/harness/core/nativeSessions").NativeBinding;
  orchestration?: HostOrchestrationView;
};
export type HostSessionSummary = Omit<
  HostSession,
  "session" | "blockRevisions"
> & {
  id: string;
  title: string;
  titleState?: Session["titleState"];
  harness: RemoteProvider;
  cwd?: string;
  model?: string;
  runtimeMode?: RuntimeMode;
  providerSessionId?: string | null;
  createdAt?: number;
  /** Last submitted user block's timestamp; absent on older Hosts. */
  lastUserMessageAt?: number | null;
  /** Current turn's last user send while running, otherwise the last AI reply. */
  activityAt?: number | null;
  pendingInputKey?: string | null;
  /** Transcript excerpts for notification delivery; absent on older Hosts. */
  notificationPreview?: SessionNotificationPreview;
  linkedWorkItem?: LinkedWorkItem;
  needsInput?: boolean;
  branch?: string;
  executionCwd?: string;
  linkedWorktree?: boolean;
  repo?: string;
  draft?: boolean;
  nativeSession?: Session["nativeSession"];
  nativeStatus?: HostSession["nativeStatus"];
  orchestrationLeadId?: string;
  workflowParentId?: string;
  assistantOwnerId?: string;
};

export type HostSessionActivity = {
  environmentId: string;
  sessions: HostSessionSummary[];
  /** Public assistant messages; absent on older Hosts. */
  assistant?: import("../../bots/model/botNotifications").BotNotificationActivity | null;
};

export type RemoteAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "audio" | "file";
  size: number;
};

/** `sessions.sync` sends only the blocks that changed after the client's
 * revision, so a long transcript is not re-downloaded on every poll. */
export type SessionSync = {
  /** Client-only clock sample taken when receiving this sync. */
  clockOffsetMs?: number;
} & (
  | { kind: "unchanged"; revision: number }
  | { kind: "snapshot"; value: HostSession }
  | {
      kind: "delta";
      base: number;
      value: Omit<HostSession, "session" | "blockRevisions"> & {
        session: Omit<Session, "blocks">;
      };
      blockIds: string[];
      blocks: Block[];
    });

/** A sync too large for one response. Its serialized JSON is read in bounded
 * pieces with `sessions.syncChunk`, so every piece describes one revision. */
export type SessionSyncTransfer = {
  kind: "chunked";
  transfer: string;
  /** UTF-16 length of the serialized `SessionSync`. */
  length: number;
};
export type SessionSyncChunk = { data: string };
export type SessionSyncResponse = (SessionSync | SessionSyncTransfer) & {
  /** Host wall clock at response time, including unchanged and chunked syncs. */
  serverTime?: number;
  /** Time spent waiting for a revision, excluded from network clock estimation. */
  serverWaitMs?: number;
};

const CLOCK_OFFSET_TOLERANCE_MS = 1_000;

export function sessionClockOffset(
  response: SessionSyncResponse,
  sentAt: number,
  receivedAt: number,
): number | undefined {
  const waited = typeof response.serverWaitMs === "number" && Number.isFinite(response.serverWaitMs)
    ? Math.max(0, Math.min(receivedAt - sentAt, response.serverWaitMs)) : 0;
  return typeof response.serverTime === "number" && Number.isFinite(response.serverTime)
    ? response.serverTime - (sentAt + receivedAt + waited) / 2
    : undefined;
}

/** Throws when the delta does not apply to `known`; request a snapshot then. */
export function applySessionSync(
  known: HostSession | undefined,
  sync: SessionSync,
): HostSession {
  const result = mergeSessionSync(known, sync);
  const previous = known?.clockOffsetMs;
  const measured = sync.clockOffsetMs;
  // Each measurement jitters by the request's latency. Keep the known offset
  // within that noise so an unchanged sync returns the same snapshot object
  // and polling does not re-render the conversation every few seconds.
  const offset =
    measured == null ||
    (previous != null && Math.abs(measured - previous) < CLOCK_OFFSET_TOLERANCE_MS)
      ? previous
      : measured;
  return offset == null || result.clockOffsetMs === offset
    ? result
    : { ...result, clockOffsetMs: offset };
}

function mergeSessionSync(known: HostSession | undefined, sync: SessionSync): HostSession {
  if (sync.kind === "snapshot") return sync.value;
  if (
    !known ||
    known.revision !== (sync.kind === "delta" ? sync.base : sync.revision)
  )
    throw new Error("Session sync base does not match");
  if (sync.kind === "unchanged") return known;
  const blocks = new Map(
    known.session.blocks.map((block) => [block.id, block]),
  );
  for (const block of sync.blocks) blocks.set(block.id, block);
  return {
    ...sync.value,
    session: {
      ...sync.value.session,
      blocks: sync.blockIds.map((id) => {
        const block = blocks.get(id);
        if (!block) throw new Error("Session sync is missing a block");
        return block;
      }),
    },
  };
}
/** Upgrade persisted outbox entries only; live commands use executionCwd. */
export function migrateSavedHostCommand(command: HostCommand): HostCommand {
  if (command.type !== "create" || !("worktreeCwd" in command)) return command;
  const { worktreeCwd, ...current } = command;
  return { ...current, executionCwd: current.executionCwd ?? (typeof worktreeCwd === "string" ? worktreeCwd : undefined) };
}

export type HostCommand =
  | HostOrchestrationCommand
  | {
      type: "create";
      commandId: string;
      projectId: string;
      /** Requested execution directory; defaults to the project's current directory. */
      executionCwd?: string;
      autoWorktreeBranch?: string;
      harness: RemoteProvider;
      model: string;
      modelSettings?: Record<string, string>;
      runtimeMode: RuntimeMode;
      /** Named desktop account profile; omitted for the default login. */
      providerAccountId?: string;
    }
  | {
      type: "configure";
      commandId: string;
      sessionId: string;
      /** Change agents with a context handoff; omitted by older clients. */
      harness?: RemoteProvider;
      model: string;
      modelSettings: Record<string, string>;
      runtimeMode: RuntimeMode;
    }
  | { type: "compact"; commandId: string; sessionId: string }
  | {
      type: "queue";
      commandId: string;
      sessionId: string;
      action: "remove" | "edit" | "hold" | "release" | "resume" | "steer" | "move";
      messageId?: string;
      /** Move before this remaining queue row; omitted means the end. */
      beforeId?: string;
      text?: string;
      editor?: string;
      runId?: string;
    }
  | {
      type: "send";
      queueReturnPosition?: QueueReturnPosition;
      questionAnswer?: QuestionAnswer;
      refreshTitle?: boolean;
      commandId: string;
      sessionId: string;
      text: string;
      attachments?: RemoteAttachment[];
      intent?: "default" | "plan" | "build" | "orchestrate";
      /** Active-turn delivery preference; omitted retains the existing queue behavior. */
      followUpBehavior?: "queue" | "steer";
      retryProposalBlockId?: string;
      draftBlockId?: string;
      planBlockId?: string;
      /** Host FIFO dispatch; callers cannot bypass a paused or edited head. */
      queuedMessageId?: string;
      /** The worktree this first message created; the Host keeps it on the message. */
      worktreeCreation?: PersistedWorktreeCreation;
    }
  | {
      type: "draft";
      commandId: string;
      sessionId: string;
      text: string;
      attachments?: RemoteAttachment[];
    }
  | {
      type: "removeDraft";
      commandId: string;
      sessionId: string;
      draftBlockId: string;
    }
  | { type: "cancel"; commandId: string; sessionId: string; runId: string }
  | {
      type: "approve";
      commandId: string;
      sessionId: string;
      runId: string;
      requestId: number;
      decision: "allow" | "deny";
    }
  | {
      type: "keepQuestionOpen";
      commandId: string;
      sessionId: string;
      runId: string;
      requestId: number;
    }
  | {
      type: "answer";
      commandId: string;
      sessionId: string;
      runId: string;
      requestId: number;
      reply: UserQuestionReply;
    };
export type CommandReceipt = {
  commandId: string;
  sessionId: string;
  revision: number;
};

/** Credentials never leave the desktop's native connection store. */
export type RemoteMachine = {
  id: string;
  name: string;
  endpoint: string;
  environmentId: string;
  ssh?: { target: string; port?: number | null; remotePort: number } | null;
  wsl?: { distribution: string } | null;
};

export type SshSetup = {
  id: string;
  message: string;
  prompt?: { id: string; message: string; confirm: boolean } | null;
  done: boolean;
  error?: string | null;
  machine?: RemoteMachine | null;
};

export function requireHostDescriptor(value: HostDescriptor): HostDescriptor {
  if (
    value?.protocolVersion !== HOST_PROTOCOL_VERSION ||
    typeof value.environmentId !== "string" ||
    !value.environmentId ||
    !Array.isArray(value.providers) ||
    !value.providers.every(isRemoteProvider)
  ) {
    throw new Error("This machine is running an incompatible OmniCode Host");
  }
  return value;
}
