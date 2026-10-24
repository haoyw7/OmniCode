import type { InboxAskContext } from "./inbox";

export type ResourceBlocker = {
  id: string;
  kind: string;
  path: string;
  ownerPid: number;
};

/** Snapshot of the last authenticated device to control a conversation. */
export type RemoteControlDevice = {
  id: string;
  name: string;
  model?: string;
  manufacturer?: string;
  hostname?: string;
};

export type SessionExecutionState = {
  runId: string;
  phase:
    | "waiting-resource"
    | "starting"
    | "awaiting-response"
    | "active"
    | "settling";
  since: number;
  /** Separate resource queue time from provider time. */
  providerStartedAt?: number;
  reason?: "integrating" | "removing" | "computer";
  blockers?: ResourceBlocker[];
};

export type HarnessId =
  | "deepseek"
  | "claude"
  | "codex"
  | "cursor"
  | "grok"
  | "opencode"
  | "pi"
  | "omp"
  | "fx"
  | "hermes"
  | "antigravity"
  | "workbuddy";

export type BlockRole =
  | "user"
  | "assistant"
  | "image"
  | "reasoning"
  | "tool"
  | "approval"
  | "tasks"
  | "plan"
  | "system"
  | "handoff";

export type TaskListItemStatus =
  "pending" | "in_progress" | "completed" | "cancelled";

export type TaskListItem = {
  /** Stable provider identity, when available, for merging status-only updates. */
  id?: string;
  text: string;
  status: TaskListItemStatus;
};

export type TaskListMeta = {
  /** Provider identity for replacing later snapshots of the same list. */
  key?: string;
  /** Provider conversation that produced this list, when the provider scopes task ids to one. */
  providerSessionId?: string;
  explanation?: string;
  items: TaskListItem[];
};

/** One-shot behavior selected in the composer for the next harness turn. */
export type TurnIntent = "default" | "plan" | "build" | "orchestrate";

export type EditedResendRejection = {
  /** The provider removed the old turn, so retry as a normal unsent prompt. */
  providerRewound: boolean;
};

export type ComposerTurnOptions = {
  /** Restore an edited follow-up's place while that queue slot is still ahead. */
  queueReturnPosition?: QueueReturnPosition;
  questionAnswer?: QuestionAnswer;
  refreshTitle?: boolean;
  intent?: TurnIntent;
  resendEdited?: boolean;
  /** Restore an edited prompt when the resend rejects asynchronously. */
  onResendRejected?: (recovery: EditedResendRejection) => void;
  /** Restore the unsent composer after deferred preparation rejects a turn. */
  onSubmissionRejected?: () => void;
  /** Promote an existing unsent transcript block instead of appending a turn. */
  draftBlockId?: string;
  /** Retry an existing Host orchestration proposal using its saved request. */
  retryProposalBlockId?: string;
};

export type PlanStatus = "streaming" | "ready" | "building" | "built";

export type PlanBlockMeta = {
  /** Provider or turn identity used to merge streamed snapshots. */
  key?: string;
  status: PlanStatus;
  /** Provider-authored plan before any user edits. */
  originalText?: string;
  /** Exact markdown the user approved with Build. */
  approvedText?: string;
  edited?: boolean;
};

export type ModelTarget = {
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
};

export type PlanBuildTarget = ModelTarget;

export type HandoffStatus = "preparing" | "ready";

export type HandoffMeta = {
  from: HarnessId;
  to: HarnessId;
  status: HandoffStatus;
  /** Inject this brief into prompts to `to` until that harness accepts a turn. */
  pending?: boolean;
};

/** One persisted question/answer in a completed turn's side conversation. */
export type BtwMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  /** Rich harness activity for assistant replies, when available. */
  blocks?: Block[];
};

export type BtwThreadStatus = "running" | "ready" | "error";

/** Independent, read-only "by the way" conversation anchored to a turn. */
export type BtwThread = {
  id: string;
  sourceEndBlockId: string;
  createdAt: number;
  updatedAt: number;
  status: BtwThreadStatus;
  messages: BtwMessage[];
  /** Provider that answered this side thread. */
  harness?: HarnessId;
  /** Selected harness model for this side thread; absent means session default. */
  model?: string;
  /** Provider settings selected for this side thread's model. */
  modelSettings?: Record<string, string>;
  /** Provider-specific side-thread id when the text runner supports resume. */
  providerThreadId?: string;
  error?: string;
  /** Live harness blocks for the in-flight reply; not persisted. */
  pendingBlocks?: Block[];
};

/** Compact transcript card for a second-opinion or split-pane handoff turn. */
export type SecondOpinionMeta = {
  from: HarnessId;
  to: HarnessId;
  request?: string;
  files?: number;
  /** Split-pane continue. Default is a second-opinion review. */
  kind?: "handoff";
};

/** A mid-turn interjection the harness asked to surface, e.g. OMP advisor notes. */
export type InterjectionSeverity = "nit" | "concern" | "blocker";

export type InterjectionMeta = {
  customType: string;
  /** Highest severity among this interjection's retained notes, when any is known. */
  severity?: InterjectionSeverity;
};

export type ToolPreviewKind = "read" | "write" | "shell" | "search";

export type ToolPreviewLineKind = "add" | "del" | "context";

export type ToolPreviewLine = {
  number?: number;
  kind: ToolPreviewLineKind;
  text: string;
};

export type ToolPreview = {
  kind: ToolPreviewKind;
  title?: string;
  path?: string;
  fileName?: string;
  startLine?: number;
  additions?: number;
  deletions?: number;
  /** Write supplied new contents without the previous file to compare. */
  contentOnly?: boolean;
  query?: string;
  lines?: ToolPreviewLine[];
  output?: string;
};

/** One thing a subagent did, mirrored into the parent transcript. */
export type AgentStepKind = "tool" | "message" | "reasoning" | "user";

export type AgentStep = {
  /** Provider step identity, so repeats merge instead of stacking up. */
  id: string;
  kind: AgentStepKind;
  /** Tool label, or the prose the subagent wrote. */
  text: string;
  toolKind?: string;
  status?: string;
  detail?: string;
  preview?: ToolPreview;
};

/**
 * The inside of a delegated run: what the subagent is called, and the trail it
 * left. Held on the parent Agent tool block so the transcript can open it
 * without a second session.
 */
export type AgentRunMeta = {
  /** What the subagent is called, e.g. "Correctness review". */
  name: string;
  /** Provider agent type, e.g. "code-reviewer". */
  agentType?: string;
  /** Model reported for the child, which may differ from its parent. */
  model?: string;
  steps: AgentStep[];
  /** Complete captured conversation. Steps remain a bounded compatibility preview. */
  transcript?: Block[];
  providerSessionId?: string;
  /** Partial means the source only supplied a tail or some events were lost. */
  coverage?: "recorded" | "partial";
};

export type AttachmentKind = "image" | "audio" | "file";

export type GeneratedImageMeta = {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  alt?: string;
};

export type Attachment = {
  /** Live transcript only; deliberately excluded from persisted attachments. */
  copyFromPath?: boolean;
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
  /** Absolute path when the file lives on disk. */
  path?: string;
  /** Base64 payload for vision images (and pasted blobs) sent to the harness. */
  data?: string;
  /** Object URL for in-session thumbnails. Not persisted. */
  previewUrl?: string;
};

export type TurnOrigin = {
  kind: "assistant";
  assistantId: string;
  /** Host-signed Bot/Thread origin; absent on older Host records. */
  botId?: string;
  threadId?: string;
  assistantName?: string;
  actionId: string;
  wakeupId: string;
};

export type QueuedMessage = SubmissionMetadata & {
  questionReply?: ProviderQuestionReply;
  /** Retained for review; skipped until a human edits or removes the item. */
  blocked?: string;
  id: string;
  text: string;
  attachments: Attachment[];
  intent?: TurnIntent;
  origin?: TurnOrigin;
};

export type QueueReturnPosition = {
  precedingIds: string[];
  followingIds: string[];
  lastUserMessageId?: string;
};

export type MessageQueueStatus = "active" | "paused" | "resuming";

/** The provider stopped the last turn at a usage limit. */
export type UsageLimit = {
  /** Epoch ms when the provider's window resets, once known. */
  resetsAt?: number;
  /** Send a continue turn once the window resets. */
  resumeAtReset?: boolean;
};

/** Provider/model provenance captured when a user turn is submitted. */
export type TurnModel = {
  harness: HarnessId;
  id: string;
  name: string;
};

/** Provider-reported token accounting for one user turn. */
export type TurnMetrics = {
  /** Accumulated output and matching timing for this turn. Null clears unavailable metrics. */
  generationSample?: GenerationSample | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Provider-normalized share of input served from cache, as a percentage. */
  cacheHitPercent?: number;
};

export type Block = {
  turnOutcome?: SubmissionOutcome;
  /** Durable workspace recording belonging to this user turn. */
  checkpointTurnId?: string;
  id: string;
  role: BlockRole;
  /** Client-only copy of a user message the Host has not recorded yet. */
  sending?: boolean;
  origin?: TurnOrigin;
  text: string;
  /** Persistent clarifying question and the user's accepted answer. */
  question?: UserQuestionRecord;
  image?: GeneratedImageMeta;
  attachments?: Attachment[];
  streaming?: boolean;
  /** Epoch ms when this message, streamed thought, or tool call started. */
  startedAt?: number;
  /** Epoch ms of a user send or the latest content received for an AI message. */
  sentAt?: number;
  /** Duration of this user turn, thought, or tool call, in ms. */
  durationMs?: number;
  /** Stable model label for this turn. Present on newly created user blocks. */
  turnModel?: TurnModel;
  /** The worktree this user message created, kept with it so its log survives. */
  worktreeCreation?: PersistedWorktreeCreation;
  /** Provider turn boundary used to replace this user message, when known. */
  providerTurnId?: string;
  /** User turn saved to the session but not submitted to the harness yet. */
  draft?: boolean;
  /** This user turn activated OmniCode app access for its thread. */
  omnicode?: boolean;
  /** The Plan or Orchestrator mode this user turn was sent in. */
  intent?: Extract<TurnIntent, "plan" | "orchestrate">;
  /** Stable CLI request that submitted this turn, for safe retries. */
  appRequestId?: string;
  /** Provider-reported token metrics for this user turn, when available. */
  turnMetrics?: TurnMetrics;
  tool?: {
    callId?: string;
    title?: string;
    kind?: string;
    status?: string;
    detail?: string;
    /** Full provider request and result, independent of the short row preview. */
    input?: string;
    output?: string;
    preview?: ToolPreview;
    /** Every file in a multi-file edit, retained for checkpoint recovery. */
    paths?: string[];
    /** Left running by the agent when it yielded; the turn waits on it. */
    background?: boolean;
    /** Provider identity for independently stopping a background task. */
    backgroundTaskId?: string;
  };
  approval?: {
    requestId: number;
    decided?: "allow" | "deny" | "cancelled";
  };
  /** Inner activity of a delegated run. Present on Agent/Task tool blocks. */
  agentRun?: AgentRunMeta;
  taskList?: TaskListMeta;
  plan?: PlanBlockMeta;
  orchestration?: OrchestrationProposal;
  /** A dynamic workflow run launched from this conversation (rendered as its run card). */
  workflowRun?: import("./workflow").WorkflowRunBlock;
  /** Parent conversation for an internal orchestration worker. */
  orchestrationLeadId?: string;
  /**
   * A turn the app wrote on the user's behalf to keep an orchestration moving.
   * The harness needs it; the transcript hides it, so a run reads as one
   * conversation rather than the user narrating their own agents.
   */
  internal?: boolean;
  handoff?: HandoffMeta;
  secondOpinion?: SecondOpinionMeta;
  /** Independent read-only side conversations anchored to this user turn. */
  btwThreads?: BtwThread[];
  noteCard?: NoteCardMeta;
  /** Exact CI repair instructions and evidence supplied with this user turn. */
  ciContext?: string;
  /** Mid-turn interjection chrome; system blocks only. Body lives in text. */
  interjection?: InterjectionMeta;
  /**
   * A system row the reader must not miss — a warning, error or interruption —
   * rather than turn chrome like a status ping. Never folds into the trail.
   */
  notice?: "error" | "interrupt" | "warning";
  statusKey?: string;
};

export type RuntimeMode =
  "supervised" | "auto-accept-edits" | "auto" | "full-access";

/** One GitHub issue or pull request associated with a coding session. */
export type LinkedWorkItem = {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  url: string;
};

export type WorkspaceMode = "current" | "worktree";

export type NativeSessionLink = {
  provider: NativeSessionProvider;
  providerSessionId: string;
  /** Absent for records saved before multi-provider sync, which were all JSONL. */
  storage?: "jsonl" | "sqlite";
  /** Claude/Codex account profile that owns the native conversation. */
  accountId?: string;
  createdAt: number;
  updatedAt: number;
  path: string;
  revision: string;
  blockIds: string[];
  /** Host-managed: set once the Host owns this conversation's lifecycle. */
  mode?: "managed";
  /** Resolved provider account/data directory that owns the source. */
  dataDir?: string;
  /** Native transcript block IDs already represented in history (Host-managed). */
  nativeIds?: string[];
};

export type Session = {
  /** Stored activity timestamps, retained when projecting history/Host snapshots. */
  createdAt?: number;
  updatedAt?: number;
  /** Host-owned assistant brain, excluded from ordinary conversation lists. */
  assistantOwnerId?: string;
  titleState?: SessionTitleState;
  /** Native transcript tracked by the local import/sync feature. */
  nativeSession?: NativeSessionLink;
  /** Host-managed native history status, copied from the Host snapshot. */
  nativeSyncStatus?: NativeSyncStatus;
  /** Receipt for an acknowledged floating-composer handoff. */
  quickLaunchAccepted?: boolean;
  /** Internal worker: displayed in its lead's panel rather than a workspace tab. */
  orchestrationLeadId?: string;
  /** Dynamic workflow subagent: hidden from session lists, shown in its run's views. */
  workflowParentId?: string;
  /** The workflow run a subagent session belongs to. */
  workflowRunId?: string;
  /** Live and recent dynamic workflow runs launched from this conversation. */
  workflowRuns?: import("./workflow").WorkflowRunsState;
  /** Inbox source context retained on the ordinary Host-owned conversation. */
  inboxAsk?: InboxAskContext;
  id: string;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  /** Live runtime capabilities, refreshed on resume/model change. */
  modelSettingOptions?: SessionModelSettings;
  runtimeMode: RuntimeMode;
  title: string;
  /** Project / working directory for this session. */
  cwd: string;
  blocks: Block[];
  /** True while a harness turn is in flight. */
  busy?: boolean;
  executionState?: SessionExecutionState;
  /**
   * What the live turn is waiting on after the agent yielded with work still
   * running in the background. In-memory only.
   */
  backgroundTasks?: string[];
  /** Persisted Host queue projected to every connected client. */
  queuedMessages?: QueuedMessage[];
  /** Paused after user stops current turn; resuming waits for continued turn. */
  queueStatus?: MessageQueueStatus;
  /** Hold an edited queue row. The Host renews and expires the editing lease. */
  editingQueuedMessageId?: string;
  /** Last turn hit a provider usage limit; cleared by the next send. In-memory only. */
  usageLimit?: UsageLimit;
  /** Provider-side conversation id (Cursor ACP session id). */
  providerSessionId?: string;
  /** Named local credential profile used by Claude or Codex. */
  providerAccountId?: string;
  /** Context-window level reported by the harness. Absent until it reports. */
  context?: ContextUsage;
  /**
   * Composer switched providers, but the previous child is still live.
   * Handoff runs on the next send, not on picker change.
   */
  pendingSwitch?: PendingHarnessSwitch;
  /** Composer choice for the next send; the conversation still belongs to its current agent. */
  pendingConfiguration?: ModelTarget & { runtimeMode: RuntimeMode };
  /** Last known branch in the session's working copy. */
  branch?: string;
  /** Agent execution directory; defaults to cwd. This does not imply a Git worktree. */
  executionCwd?: string;
  /** Display metadata confirmed by Git; never infer it from the execution directory. */
  linkedWorktree?: boolean;
  /** Blank-composer choice; consumed when the first turn starts. */
  workspaceMode?: WorkspaceMode;
  /** Base ref for a worktree that will be created on first send. */
  worktreeBase?: string;
  /** Internal guard while the first turn creates its selected worktree. */
  worktreePreparing?: boolean;
  /** Progress card for that creation. In-memory only; never persisted. */
  worktreeCreation?: WorktreeCreation;
  /** Select a working copy before continuing after the previous one was deleted. */
  worktreeRemoved?: boolean;
  /** One-shot composer text when opening a session from Inbox. */
  composerSeed?: string;
  /** Inbox issue/PR chip shown above the composer. In-memory, one-shot. */
  inboxCard?: InboxComposerCard;
  /** GitHub issue or pull request shown on the persisted session card. */
  linkedWorkItem?: LinkedWorkItem;
  /** Automation that created or last launched this session. */
  automationId?: string;
  /** New linked-item activity shown above the composer. In-memory, one-shot. */
  linkedWorkItemUpdateCard?: LinkedWorkItemUpdateCard;
  /** Note chip shown above the composer. In-memory, one-shot. */
  noteCard?: NoteComposerCard;
  /** Handoff chip shown above the composer. In-memory, one-shot. */
  handoffCard?: HandoffComposerCard;
  /**
   * Live clarifying questions from AskUserQuestion / ask_question / etc.
   * In-memory; request ids do not survive restarts.
   */
  pendingQuestion?: UserQuestionPrompt;
};

export type PendingHarnessSwitch = {
  from: HarnessId;
  fromModel: string;
  fromSettings: Record<string, string>;
  fromProviderSessionId?: string;
  fromProviderAccountId?: string;
};

export const HARNESSES: HarnessId[] = [
  "claude",
  "codex",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "omp",
  "fx",
  "hermes",
  "antigravity",
  "deepseek",
  "workbuddy",
];

export const RUNTIME_MODES: RuntimeMode[] = [
  "supervised",
  "auto-accept-edits",
  "auto",
  "full-access",
];

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "supervised";

/** Provider output tokens over matching request or observed streaming durations. */
export type GenerationSample = {
  outputTokens: number;
  durationMs: number;
  tokenSource: "provider" | "text-estimate";
  estimator?: "text-heuristic-v1";
  method: "request-total" | "stream-observed";
  scope: "turn";
};

export type UserQuestionOption = {
  id: string;
  label: string;
  description?: string;
};

export type UserQuestion = {
  id: string;
  header?: string;
  prompt: string;
  /** Provider-owned supporting content, including the complete plan under review. */
  detail?: string;
  intent?: { kind: "plan-review"; approve: string; callId?: string };
  multiSelect: boolean;
  allowCustom: boolean;
  options: UserQuestionOption[];
  /** Optional native text/editor semantics; absent preserves existing questions. */
  input?: {
    kind: "text" | "multiline";
    initialValue?: string;
    placeholder?: string;
    preserveWhitespace?: boolean;
    allowEmpty?: boolean;
    maxLength?: number;
  };
};

export type UserQuestionPrompt = {
  requestId: number;
  /** Persistent transcript identity; request IDs alone can be reused. */
  historyId?: string;
  /** Stable native identity for providers with a structured late-answer API. */
  providerQuestionId?: string;
  title?: string;
  questions: UserQuestion[];
  /** Answers can be sent as a later user message after this request closes. */
  allowLateReply?: boolean;
  /** Deadline owned by the harness; interaction can disable automatic skipping. */
  autoResolveAt?: number;
};

export type UserQuestionReply =
  | {
      kind: "answered";
      answers: Record<string, string[]>;
      custom?: Record<string, string>;
    }
  | { kind: "skipped" };

export type UserQuestionRecord = UserQuestionPrompt & {
  decision?: "answered" | "skipped" | "cancelled";
  reply?: Extract<UserQuestionReply, { kind: "answered" }>;
};

export type QuestionAnswer = {
  blockId: string;
  reply: Extract<UserQuestionReply, { kind: "answered" }>;
};

export type ProviderQuestionReply = {
  requestId: string;
  reply: UserQuestionReply;
};

export type ModelSettingChoice = {
  value: string;
  label: string;
};

export type ModelSetting = {
  id: string;
  label: string;
  kind: "select" | "toggle";
  value: string;
  options: ModelSettingChoice[];
  description?: string;
};

/** Live choices belong to one session and one model, never the global catalog. */
export type SessionModelSettings = { model: string; settings: ModelSetting[] };

export type AgentModel = {
  supportsImages?: boolean;
  id: string;
  harness: HarnessId;
  name: string;
  nativeId?: string;
  /** Upstream provider inside a multi-provider harness such as Pi or OpenCode. */
  provider?: {
    id: string;
    name: string;
  };
  settings?: ModelSetting[];
  /** Context window, when the harness catalog reports one. */
  contextWindow?: number;
};

export type ModelPickerTab = "favorites" | HarnessId;

export type LastModelChoice = {
  harness: HarnessId;
  model: string;
};

export type SessionNotificationPreview = {
  reply: string | null;
  input: string | null;
};

/**
 * How much of the model context window the session is currently occupying.
 *
 * This is a level, not a running total: every harness reports the size of the
 * prompt it just sent, so the newest reading replaces the previous one. That
 * keeps compaction free — once the harness compacts, its next report is simply
 * smaller.
 */
export type ContextUsage = {
  /** Tokens in the context window as of the last request. */
  used: number;
  /** Context window for the active model, when the harness reports one. */
  window?: number;
  breakdown?: ContextBreakdown;
};

export type SessionTitleState = {
  source: "placeholder" | "native" | "generated" | "manual";
  epoch: number;
  purpose: "initial" | "automation";
  fallbackAttempted: boolean;
};

/** Composer chip: recap is injected on send so the user can add context first. */
export type HandoffComposerCard = {
  from: HarnessId;
  to: HarnessId;
  brief: string;
  request?: string;
  files?: number;
};

export type GithubTaskKind = "issue" | "pr";

export type GithubPrAction =
  "merge" | "squash" | "rebase" | "draft" | "ready" | "close" | "reopen";

export type InboxKind = GithubTaskKind | "linear" | "jira";

export type GithubLabel = {
  name: string;
  color: string;
};

export type GithubAssignee = {
  login: string;
  avatarUrl?: string;
};

export type GithubWorkItem = {
  kind: GithubTaskKind;
  number: number;
  title: string;
  url: string;
  state: string;
  /** GitHub issue closure reason, such as `completed` or `not_planned`. */
  stateReason?: string;
  createdAt?: string;
  updatedAt: string;
  labels: GithubLabel[];
  assignees: GithubAssignee[];
  draft: boolean;
  repo: string;
};

export type InboxProvider =
  "github" | "linear" | "jira" | "gitlab" | "azuredevops";

export type InboxItem = Omit<GithubWorkItem, "kind"> & {
  kind: InboxKind;
  projectPath: string;
  provider: InboxProvider;
  id?: string;
  identifier?: string;
  teamId?: string;
  teamName?: string;
  /** Linear project the issue belongs to. Empty when it sits outside every project. */
  projectId?: string;
  projectName?: string;
  stateType?: string;
  /** GitLab To-Do action that caused this item to need attention. */
  attentionReason?: string;
};

export type GithubWorkItemDetails = {
  body: string;
  author: string;
  authorAvatarUrl?: string;
  baseRefName?: string;
  headRefName?: string;
  reviewDecision?: string;
};

export type GithubWorkItemComment = {
  id: string;
  kind: string;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url: string;
  state: string;
  path: string;
  line: number | null;
  resolved: boolean;
  threadId: string;
  replies: GithubWorkItemComment[];
};

export type GithubWorkItemCommit = {
  oid: string;
  messageHeadline: string;
  author: string;
  committedDate: string;
  url: string;
};

export type GithubWorkItemThread = {
  comments: GithubWorkItemComment[];
  commits: GithubWorkItemCommit[];
  truncated: boolean;
  reviewDecision: string;
  baseRefName: string;
  headRefName: string;
};

export type GithubPrFile = {
  path: string;
  additions: number;
  deletions: number;
};

export type GithubPrDiff = {
  additions: number;
  deletions: number;
  files: GithubPrFile[];
  patch: string;
  truncated: boolean;
};

export type GithubWorkItemQuery = {
  kind: GithubTaskKind;
  assignedToMe: boolean;
  state: "open" | "all";
  search: string;
};

export type InboxQuery = Omit<GithubWorkItemQuery, "kind"> & {
  linearHiddenTeamIds?: string[];
  jiraHiddenProjectIds?: string[];
};

export type InboxProviderErrors = Partial<Record<InboxProvider, string>>;

export type GithubStatus = {
  connected: boolean;
  installed: boolean;
  authenticated: boolean;
};

export type InboxListResult = {
  items: InboxItem[];
  errors: InboxProviderErrors;
};

/** Compact chip shown above the composer when starting from Inbox. */
export type InboxComposerCard = {
  provider: InboxProvider;
  kind: InboxKind;
  identifier: string;
  title: string;
  url: string;
  source: string;
  labels: GithubLabel[];
  prompt: string;
};

export type LinkedWorkItemActivityKind =
  "comment" | "review" | "review_comment" | "commit";

export type LinkedWorkItemActivityEntry = {
  id: string;
  kind: LinkedWorkItemActivityKind;
  author: string;
  text: string;
  createdAt: string;
  url: string;
};

export type LinkedWorkItemActivityCounts = {
  comments: number;
  reviews: number;
  commits: number;
};

export type LinkedWorkItemTerminalState =
  "issue_closed" | "pr_merged" | "pr_closed";

/** In-memory, one-shot context shown when an updated linked session is opened. */
export type LinkedWorkItemUpdateCard = {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  since: number;
  updatedAt: number;
  status: "loading" | "ready" | "error";
  counts: LinkedWorkItemActivityCounts;
  entries: LinkedWorkItemActivityEntry[];
  truncated: boolean;
};

export type Note = {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  sourceSessionId?: string;
  sourceCwd?: string;
  /** Slug generated for a note created without a title; replaced once from its first real title. */
  slugPending: boolean;
  createdAt: number;
  updatedAt: number;
};

export type NoteUpsert = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  sourceSessionId?: string;
  /** Omit on update to keep the saved project directory. */
  sourceCwd?: string;
  /** Replace a pending slug from the title. Set once the title is done being typed; ignored unless the slug is pending. */
  finalizeSlug?: boolean;
};

/** Note chip shown in the composer and on the user turn in the thread. */
export type NoteCardMeta = {
  id: string;
  slug: string;
  title: string;
  sourceCwd?: string;
};

/** Composer chip: display fields plus the body injected into the harness prompt. */
export type NoteComposerCard = NoteCardMeta & {
  body: string;
};

export type OrchestrationChoice = {
  harness: HarnessId;
  model: string;
  name: string;
};

export type OrchestrationSettings = {
  choices: OrchestrationChoice[];
  maxWorkers: number;
};

export type ProposedTask = {
  id: string;
  title: string;
  prompt: string;
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  files: string[];
  dependsOn: string[];
};

export type OrchestrationProposal = {
  version: 1;
  leadId: string;
  /** Project identity retained for history and proposal ownership. */
  cwd: string;
  /** Concrete checkout inspected while preparing this proposal. */
  checkoutCwd?: string;
  request: string;
  author: OrchestrationChoice;
  settings: OrchestrationSettings;
  status: "planning" | "ready" | "invalid" | "starting" | "approved";
  title: string;
  summary: string;
  tasks: ProposedTask[];
  error?: string;
  /** Kept only for invalid cards so a retry can repair the response directly. */
  response?: string;
};

export type TaskStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "blocked"
  | "interrupted"
  | "cancelled";

export type WorkspacePolicy =
  "shared" | "isolated-child" | "isolated-top-level";

export type OrchestrationWorkspace = {
  /** Stable comparison identity; not a display path. */
  id: string;
  /** Project identity used by recents, history and project-level settings. */
  projectCwd: string;
  /** Concrete checkout in which this run may read and write. */
  checkoutCwd: string;
  kind: "main" | "worktree";
  branch?: string;
};

export type DispatchState =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "interrupted"
  | "cancelled"
  | "start_unknown"
  | "stop_unknown";

export type DispatchStage =
  | "accepted"
  | "session_prepared"
  | "turn_submitted"
  | "settled"
  | "integration_started"
  | "integrated"
  | "cleaned";

export type OrchestrationDispatch = {
  id: string;
  taskId: string;
  sessionId: string;
  workspace: OrchestrationWorkspace;
  state: DispatchState;
  stage: DispatchStage;
  startedAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
  cleanupError?: string;
};

export type OrchestrationTask = {
  id: string;
  /** Host-owned provenance for a queued assistant follow-up. */
  turnOrigin?: TurnOrigin;
  assignmentId?: string;
  sessionId: string;
  title: string;
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  prompt: string;
  files: string[];
  /** Logical scopes in the lead checkout, used for scheduling overlap. */
  scopes: string[];
  /** The same scopes resolved inside this worker's isolated checkout. */
  writeScopes?: string[];
  scratchDir?: string;
  dependsOn: string[];
  status: TaskStatus;
  accepted: boolean;
  result: string;
  error?: string;
  /** A retained worker can continue safely with this recovery turn. */
  recoveryPrompt?: string;
  delivered: boolean;
  /** Workspace selection is independent from task/dependency identity. */
  workspacePolicy?: WorkspacePolicy;
  /** A retry reuses its worker checkout so partial work is never orphaned. */
  workspace?: OrchestrationWorkspace;
  /** Only this dispatch may settle the task. A retry always gets a new id. */
  activeDispatchId?: string;
  lastDispatchId?: string;
  acceptedDispatchId?: string;
};

export type OrchestrationRun = {
  /** Version 1 remains readable; every committed snapshot is migrated to 2. */
  version: 1 | 2;
  leadId: string;
  /** Legacy project identity. Use workspace.checkoutCwd for filesystem work. */
  cwd: string;
  workspace?: OrchestrationWorkspace;
  canonicalRoot?: string;
  status: "active" | "paused" | "stopped" | "finished";
  allowedHarnesses: HarnessId[];
  allowedModels?: OrchestrationChoice[];
  proposalId?: string;
  maxWorkers: number;
  cli: string;
  tasks: OrchestrationTask[];
  dispatches?: OrchestrationDispatch[];
  error?: string;
  continuations: number;
  lastPauseReason?: string;
  requests: Record<string, { signature: string; result: unknown }>;
};

/** Live log for the draft worktree that a conversation's first send creates. */
export type WorktreeLogLine =
  /** Application text with an [info] tag; translated at render time. */
  | { kind: "info"; key: string; values?: Record<string, string> }
  /** Application text without a tag; translated at render time. */
  | { kind: "text"; key: string; values?: Record<string, string> }
  /** Git output, shown verbatim. */
  | { kind: "output"; text: string }
  | { kind: "error"; text: string };

export type WorktreeCreation = {
  id: string;
  base: string;
  status: "creating" | "created" | "failed";
  /** The user message that started the creation; its card sits under that message. */
  afterBlockId?: string;
  /** Set once a created worktree's log has been shown long enough to fold away. */
  folded?: boolean;
  log: WorktreeLogLine[];
  path?: string;
};

/**
 * What a finished creation keeps on its first message, so the log survives a
 * reload. Only a worktree that exists is worth keeping.
 */
export type PersistedWorktreeCreation = {
  base: string;
  path: string;
  log: WorktreeLogLine[];
};

export type RateLimitProvider = "claude" | "codex" | "opencode";

export type RateLimitStatus =
  "idle" | "fetching" | "ok" | "error" | "unavailable";

export type RateLimitWindow = {
  /** Percentage of the window consumed (0–100). */
  usedPercent: number;
  /** Window duration in minutes: 300 (5h) or 10080 (7d). */
  windowMinutes: number;
  /** Unix ms timestamp when the window resets, if known. */
  resetsAt: number | null;
};

export type RateLimitResetCredit = {
  id: string;
  resetType: "codexRateLimits" | "unknown";
  status: "available" | "redeeming" | "redeemed" | "unknown";
  grantedAt: number | null;
  expiresAt: number | null;
  title: string | null;
  description: string | null;
};

export type RateLimitResetCredits = {
  availableCount: number;
  /** Optional detail rows; the backend can report only the aggregate count. */
  credits: RateLimitResetCredit[] | null;
};

export type ProviderRateLimits = {
  provider: RateLimitProvider;
  session: RateLimitWindow | null;
  weekly: RateLimitWindow | null;
  monthly: RateLimitWindow | null;
  /** Codex-only banked rate-limit reset rewards, when supplied by app-server. */
  resetCredits: RateLimitResetCredits | null;
  updatedAt: number;
  error: string | null;
  status: RateLimitStatus;
};

/** Optional provider snapshot. Aggregate-only providers and old histories omit it. */
export type ContextBreakdown = {
  updatedAt: number;
  used: number;
  window: number;
  /** Summary queries use provider usage plus local category estimates. */
  estimated: boolean;
  categories: ContextCategory[];
  tools?: ContextToolUsage[];
  toolResultTokens?: number;
  autoCompactThreshold?: number;
  autoCompactEnabled?: boolean;
};

export type ContextCategory = {
  /** Provider-owned display name; unknown names must remain intact. */
  name: string;
  tokens: number;
  kind: "used" | "free" | "buffer" | "deferred";
};

export type ContextToolUsage = {
  name: string;
  tokens: number;
  group: "mcp" | "system";
  server?: string;
  deferred?: boolean;
};

export type NativeSessionProvider =
  "codex" | "pi" | "claude" | "omp" | "opencode";

export type NativeSessionFile = {
  provider: NativeSessionProvider;
  providerSessionId: string;
  cwd: string;
  /** JSONL transcript, or the shared database for `storage: "sqlite"`. */
  path: string;
  revision: string;
  modifiedAt: number;
  /** Absent in records listed before multi-provider sync. */
  storage?: "jsonl" | "sqlite";
  /** OmniCode provider account whose config directory owns the session. */
  accountId?: string;
  /** Title the agent generated or the user set in its CLI, when stored outside the transcript. */
  title?: string;
  /** First prompt, for lists only; never used as the conversation title. */
  preview?: string;
  /** Opaque Host-issued identity when the Host listed this source. */
  sourceId?: string;
};

export type NativeTranscript = {
  createdAt: number;
  blocks: Block[];
  model?: string;
  modelSettings: Record<string, string>;
  title?: string;
};

export type NativeSessionHolder = {
  pid: number;
  command: string;
  provider: NativeSessionProvider;
};

export type NativeSessionAccess = {
  state: "idle" | "external" | "unknown" | "checking";
  reason: string;
  checkedAt: number;
  path: string;
  /** External CLI process that keeps the session read-only (Linux only). */
  holder?: NativeSessionHolder;
};

/** Host-managed native history synchronization, separate from ownership access. */
export type NativeSyncStatus = {
  state: "ready" | "syncing" | "error";
  /** Machine code: `sourceMissing`, `sourceAmbiguous`, `readFailed`, `parseFailed`, `persistFailed`, `bindingMismatch`, `diverged`, `deferred`. */
  reason?: string;
  /** Diagnostic text; provider and system values are preserved. */
  message?: string;
  /** Last source revision applied to history. */
  revision?: string;
  /** The source changed while the session was busy; settlement reads it. */
  pendingChange?: boolean;
  /** A Host turn wrote records that settlement has not absorbed yet. */
  hostTurn?: boolean;
  /** Next automatic retry while in `error`. */
  retryAt?: number;
  checkedAt: number;
};

/**
 * Identity recorded for a Host conversation started by OmniCode itself. It is
 * not a `nativeSession` link: warm process reuse continues until the source
 * changes outside a Host turn, which promotes the session to a managed link.
 */
export type NativeBinding = {
  provider: NativeSessionProvider;
  providerSessionId: string;
  accountId?: string;
  dataDir?: string;
  path?: string;
  storage?: "jsonl" | "sqlite";
  /** Source revision after the last Host turn. */
  hostRevision?: string;
};

/** One Host-resolved native source offered for import. */
export type NativeSourceSummary = NativeSessionFile & {
  sourceId: string;
  boundSessionId?: string;
};

export type NativeSourceListing = {
  sources: NativeSourceSummary[];
  warnings: string[];
  scannedAt: number;
  autoSync: boolean;
  /** Conversations the Host manages. */
  managedCount: number;
  /** Last successful synchronization of any managed conversation. */
  lastSyncedAt?: number;
};

/** Execution location is separate from the Host that owns the conversation. */
export type ProjectMachine = { kind: "wsl"; distribution: string };

/** Accepted submission context retained while a message waits in the Host queue. */
export type SubmissionMetadata = {
  /** Commit the next agent/model choice atomically with this accepted turn. */
  buildTarget?: PlanBuildTarget;
  /** Rewind the last provider turn before submitting the edited replacement. */
  resendEdited?: boolean;
  ciContext?: string;
  /** Provider instructions for a CI repair; the transcript retains the user's text. */
  promptOverride?: string;
  secondOpinion?: SecondOpinionMeta;
  noteCard?: NoteComposerCard | null;
  handoffCard?: HandoffComposerCard | null;
  appRequestId?: string;
  displayText?: string;
  managed?: boolean;
};

/** Durable completion, keyed by the accepting command's user block ID. */
export type SubmissionOutcome = {
  status: "completed" | "failed" | "cancelled";
  text: string;
  error?: string;
  metrics?: TurnMetrics;
  toolCalls?: number;
  /** Present only for a rejected edited resend, before provider acceptance. */
  providerRewound?: boolean;
};

export const HARNESS_LABEL: Record<HarnessId, string> = {
  deepseek: "deepseek",
  workbuddy: "workbuddy",
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  grok: "grok",
  opencode: "opencode",
  pi: "pi",
  omp: "omp",
  fx: "fx",
  hermes: "hermes",
  antigravity: "antigravity",
};

export const HARNESS_TITLE: Record<HarnessId, string> = {
  deepseek: "DeepSeek Harness",
  workbuddy: "WorkBuddy",
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok Build",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "omp",
  fx: "fx",
  hermes: "Hermes Agent",
  antigravity: "Antigravity",
};

export const RUNTIME_MODE_LABEL: Record<RuntimeMode, string> = {
  supervised: "Supervised",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

export const RUNTIME_MODE_HINT: Record<RuntimeMode, string> = {
  supervised: "Ask before commands and file changes.",
  "auto-accept-edits": "Auto-approve edits, ask before other actions.",
  auto: "An AI reviewer can approve or deny actions.",
  "full-access":
    "Allow commands, edits, and supported MCP confirmations in non-plan turns without prompts.",
};
