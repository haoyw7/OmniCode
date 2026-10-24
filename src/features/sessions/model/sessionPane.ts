import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import type { Session, WorkspaceMode, HarnessId, RuntimeMode, Attachment, ComposerTurnOptions, LinkedWorkItem, UserQuestionReply, Block, PlanBuildTarget, ModelTarget } from "../../../contracts/session";
import type { ApprovalDecision } from "../../../contracts/harness";
import type { HostSession } from "../../../contracts/protocol";
import type { RecentProject } from "../../projects/model/recents";
import type { Worktree } from "../../../contracts/worktree";
import type { TranscriptPool } from "../ui/TranscriptPool";

export type SessionPaneProps = {
  clockOffsetMs?: number;
  session: Session;
  workspaceSwitchingSessionId?: string;
  reviewUndoLocked?: boolean;
  visible: boolean;
  focused: boolean;
  addToChatTarget?: boolean;
  inSplit: boolean;
  /** Replaces the split heading using the resolved local or Host session. */
  renderHeader?: (session: Session) => ReactNode;
  composerFocused: boolean;
  composerFocusToken?: number;
  recents: RecentProject[];
  hideProjectPicker?: boolean;
  onFocus: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCwdChange: (sessionId: string, cwd: string) => void;
  onBranchChange: (sessionId: string) => void;
  onWorktreeChange?: (sessionId: string, tree: Worktree) => Promise<void>;
  onRemoteSnapshot?: (shellId: string, snapshot?: HostSession) => void;
  onWorkspaceModeChange: (
    sessionId: string,
    mode: WorkspaceMode,
    base?: string,
  ) => void;
  onWorktreeBaseChange: (sessionId: string, base: string) => void;
  onManageWorktrees?: () => void;
  onModelChange: (sessionId: string, harness: HarnessId, model: string) => void;
  onModelSettingsChange: (
    sessionId: string,
    settings: Record<string, string>,
  ) => void;
  onRuntimeModeChange: (sessionId: string, mode: RuntimeMode) => void;
  onSubmit: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => boolean | void;
  onSaveDraft: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
  ) => boolean | void;
  onRemoveDraft: (sessionId: string, draftBlockId: string) => boolean | void;
  onStop: (sessionId: string) => void;
  onStopBackgroundTask?: (sessionId: string, taskId: string) => Promise<void>;
  onCompactContext: (sessionId: string) => boolean;
  onDeleteQueuedMessage: (sessionId: string, messageId: string) => void;
  onReorderQueuedMessage: (
    sessionId: string,
    messageId: string,
    beforeId?: string,
  ) => void;
  onSteerQueuedMessage: (sessionId: string, messageId: string) => void;
  onResumeQueue: (sessionId: string) => void;
  onUsageLimitResume: (sessionId: string) => void;
  /** Omitted where nothing can resume the session once the limit resets. */
  onUsageLimitResumeAtReset?: (sessionId: string, enabled: boolean) => void;
  onUsageLimitDismiss: (sessionId: string) => void;
  onInboxCardDismiss?: (sessionId: string) => void;
  onLinkedWorkItemUpdateCardDismiss?: (sessionId: string) => void;
  onNoteCardDismiss?: (sessionId: string) => void;
  onHandoffCardDismiss?: (sessionId: string) => void;
  onOpenLinkedWorkItem?: (item: LinkedWorkItem, sessionId: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => Promise<boolean>;
  onDeleteSession?: (sessionId: string) => Promise<boolean>;
  onApproval: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  onQuestionReply: (
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ) => void;
  onQuestionInteraction?: (sessionId: string, requestId: number) => void;
  onOpenFile: (path: string) => void;
  onOpenBot?: (sessionId: string, origin: NonNullable<Block["origin"]>) => void | Promise<void>;
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string; turnId?: string },
  ) => void;
  onOpenPlan: (sessionId: string, blockId: string) => void;
  onBuildPlan: (
    sessionId: string,
    blockId: string,
    target?: PlanBuildTarget,
  ) => void;
  onSecondOpinion?: (
    sessionId: string,
    target: ModelTarget,
    turn: Block[],
  ) => void;
  onHandoff?: (sessionId: string, target: ModelTarget, turn: Block[]) => void;
  onBtwSubmit?: (
    sessionId: string,
    turn: Block[],
    threadId: string,
    messageId: string,
    text: string,
    model?: string,
    modelSettings?: Record<string, string>,
  ) => boolean | void;
  onBtwRetry?: (sessionId: string, turn: Block[], threadId: string) => void;
  onBtwDelete?: (sessionId: string, turn: Block[], threadId: string) => void;
  onBtwStop?: (sessionId: string, turn: Block[], threadId: string) => void;
  onBtwModelChange?: (
    sessionId: string,
    turn: Block[],
    threadId: string,
    model: string,
    modelSettings: Record<string, string>,
  ) => void;

  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Keeps this transcript mounted after the pane closes. */
  transcriptPool?: TranscriptPool;
  /** History received by the first Host sync after opening or returning to a tab. */
  transcriptHistory?: readonly Block[];
};
