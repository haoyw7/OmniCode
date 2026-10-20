import { useInlineBreakpoints } from "../../../shared/hooks/useInlineBreakpoints";
import { AnimatePresence } from "motion/react";
import { sessionComposerConfiguration } from "../model/composerConfiguration";
import { SessionWorktreeIcon } from "./SessionWorktreeIcon";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { GripVertical, X } from "../../../shared/ui/icons";
import { JumpToBottomButton } from "../../../shared/ui/messaging/JumpToBottomButton";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNativeSessionAccess } from "./useNativeSessionAccess";
import { Composer } from "./Composer";
import { lastQueueUserMessageId } from "../model/messageQueue";
import type { Worktree } from "../../source-control/model/worktrees";
import {
  orchestrationCheckoutCwd,
  sameCheckout,
} from "../../orchestration/model/orchestration";
import { OrchestrationRuntimeContext } from "../../orchestration/ui/OrchestrationActions";
import { DiscussionEmpty } from "./DiscussionEmpty";
import { LinkedWorkItemUpdateNotice } from "../../inbox/ui/LinkedWorkItemUpdateNotice";
import { SessionReview } from "./SessionReview";
import { PromptOutline } from "./PromptOutline";
import {
  canCompactHarnessContext,
  canStopHarnessBackgroundTask,
  stopHarnessBackgroundTask,
  type ApprovalDecision,
  type UserQuestionReply,
} from "../../../integrations/harness";
import {
  looksLikeProject,
  type RecentProject,
} from "../../projects/model/recents";
import {
  sessionDisplayTitle,
  sessionDraftBlock,
  sessionExecutionCwd,
  type Attachment,
  type Block,
  type HarnessId,
  type LinkedWorkItem,
  type ModelTarget,
  type PlanBuildTarget,
  type QueuedMessage,
  type QueueReturnPosition,
  type RuntimeMode,
  type Session,
  type WorkspaceMode,
  type ComposerTurnOptions,
} from "../model/session";
import { sessionHasBtwThreads, supportsBtwHarness } from "../model/btw";
import { BtwSheet, useBtwConversation } from "./BtwSheet";
import { AgentTranscript } from "./AgentTranscript";
import { PooledTranscript, type TranscriptPool } from "./TranscriptPool";
import { agentWaitingForWorktree } from "../../source-control/model/worktreeCreation";
import { TranscriptFind } from "./TranscriptFind";
import { SessionStatusPanel } from "./SessionStatusPanel";
import { hasSessionUsage, usageSessionFor } from "../../providers/model/sessionUsage";
import { useOpenSubagent } from "./SubagentTabsContext";
import { useProjectDiffStats } from "../../source-control/hooks/useProjectDiffStats";
import { useProjectBranches } from "../../source-control/hooks/useProjectBranches";
import {
  clearTranscriptJump,
  peekTranscriptJump,
  subscribeTranscriptJump,
} from "../model/transcriptJump";
import { EmptySession } from "./EmptySession";
import { useComposerDockMotion } from "./useComposerDockMotion";
import { useShortcutLabel } from "../../../app/commands/useCommandShortcut";
import {
  acknowledgeQuoteRequest,
  ADD_TO_CHAT_EVENT,
  type AddToChatRequest,
  type QuoteRequest,
} from "../model/quoteDraft";
import { createNote, noteTitle } from "../../notes";
import {
  loadNotesEnabled,
  subscribeNotesEnabled,
} from "../../settings/model/settings";
import { getComposerDraft, setComposerDraft } from "../model/draftCache";
import { resolveModel } from "../model/models";
import { isAstraModel } from "../model/astraWelcome";
import { isOpus55Model } from "../model/opusWelcome";
import { AstraWelcome } from "./AstraWelcome";
import { OpusWelcome } from "./OpusWelcome";
import { projectKey } from "../../../shared/lib/paths";
import { canEditLastTurn, lastTurnRecall } from "../model/editLastTurn";
import {
  loadProjectChatBackgroundSettings,
  projectChatBackgroundImageRevision,
  projectChatBackgroundRevision,
  subscribeProjectChatBackground,
} from "../../projects/model/projectChatBackground";
import { useProjectBackgroundEffect } from "../../projects/ui/useProjectBackgroundEffect";
import { GradientBlurBackground } from "../../settings/ui/GradientBlurBackground";
import {
  loadChatBackgroundPath,
  loadNewThreadBackgroundEffect,
  subscribeChatBackgroundPath,
} from "../../settings/model/appearance";
import { markLinkedSessionUpdateSeen } from "../../inbox/model/linkedSessionSeen";
import { RemoteSession } from "../../connections/ui/RemoteSession";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { isChatFolder } from "../../projects/model/chatFolderPath";
import {
  latestAnswerableQuestionId,
  questionAnswerableLater,
  questionFollowUp,
} from "../model/questionHistory";
import type { QuestionAnswer } from "../model/userQuestion";
import { QuestionHistoryForm } from "./QuestionHistoryForm";
import {
  IMPLEMENT_PLAN_PROMPT,
  skipPlanDecision,
  usePlanDecision,
} from "../model/planDecision";
import { PlanDecision } from "./PlanPreview";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { remoteProjectFor, sessionUsesHost } from "../../connections/model/remoteProjects";
import type { HostSession } from "../../connections/model/protocol";

/** Closed question panels stay closed when the pane remounts. */
const dismissedDockQuestions = new Set<string>();

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

const TRANSCRIPT_BREAKPOINTS = [28] as const;

type Props = SessionPaneProps & {
  /** A newly submitted prompt carried across the initial Host pane mount. */
  initialPromptId?: string;
  /** Queue presentation supplied by the owning runtime. */
  messageQueue?: { render: (restore: (message: QueuedMessage, position?: QueueReturnPosition) => void) => ReactNode };
  composerNotice?: ReactNode;
  hostManaged?: boolean;
  remoteSession?: boolean;
  hostFeatures?: { attachments: boolean; plan: boolean; draft: boolean; orchestration?: boolean; checkpoint?: boolean };
  /** An opened host conversation whose transcript has not arrived yet. */
  hostSessionLoading?: boolean;
  hostSessionStarted?: boolean;
  allowedModelHarnesses?: readonly HarnessId[];
};

export const SessionPane = memo(function SessionPane(props: SessionPaneProps) {
  // Both local and remote Host projects use the Host runtime. Location only
  // controls filesystem access and desktop presentation.
  const project = remoteProjectFor(props.session.cwd);
  if (isRemoteProjectPath(props.session.cwd) || sessionUsesHost(props.session))
    return (
      <RemoteSession
        shell={props.session}
        visible={props.visible}
        onSnapshot={props.onRemoteSnapshot}
        onOpenFile={props.onOpenFile}
        onOpenDiff={props.onOpenDiff}
        onOpenPlan={props.onOpenPlan}
        unavailableHeader={props.renderHeader?.(props.session)}
        render={(remote) => <LocalSessionPane {...props} {...remote}
          {...(project?.local ? {
            onManageWorktrees: props.onManageWorktrees, onCwdChange: props.onCwdChange } : {})} />}
      />
    );
  return <LocalSessionPane {...props} />;
});

const LocalSessionPane = memo(function LocalSessionPane({
  clockOffsetMs,
  messageQueue,
  composerNotice,
  hostManaged = false,
  remoteSession = false,
  hostFeatures,
  hostSessionLoading = false,
  hostSessionStarted = false,
  allowedModelHarnesses,
  session,
  workspaceSwitchingSessionId,
  reviewUndoLocked = false,
  visible,
  focused,
  addToChatTarget = focused,
  inSplit,
  renderHeader,
  composerFocused,
  composerFocusToken,
  recents,
  hideProjectPicker,
  onFocus,
  onClose,
  onCwdChange,
  onBranchChange,
  onWorktreeChange,
  onWorkspaceModeChange,
  onWorktreeBaseChange,
  onManageWorktrees,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onSaveDraft,
  onRemoveDraft,
  onSubmit,
  onStop,
  onStopBackgroundTask,
  onCompactContext,
  onDeleteQueuedMessage,
  onReorderQueuedMessage,
  onSteerQueuedMessage,
  onResumeQueue,
  onUsageLimitResume,
  onUsageLimitResumeAtReset,
  onUsageLimitDismiss,
  onInboxCardDismiss,
  onLinkedWorkItemUpdateCardDismiss,
  onNoteCardDismiss,
  onHandoffCardDismiss,
  onOpenLinkedWorkItem,
  onArchiveSession,
  onDeleteSession,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
  onOpenFile,
  onOpenBot,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  onSecondOpinion,
  onHandoff,
  onBtwSubmit,
  onBtwRetry,
  onBtwDelete,
  onBtwStop,
  onBtwModelChange,
  onPaneDragStart,
  transcriptPool,
  transcriptHistory,
  initialPromptId,
}: Props) {
  const { t: uiT } = useTranslation();
  const openSubagent = useOpenSubagent(session);
  const closePaneLabel = useShortcutLabel("Close Pane", "Pane: Close");
  const { readOnly: nativeReadOnly, hint: nativeAccessHint } =
    useNativeSessionAccess(session);
  const orchestrationRuntime = useContext(OrchestrationRuntimeContext);
  const orchestrationRuns = useSyncExternalStore(
    orchestrationRuntime.subscribe,
    orchestrationRuntime.snapshot,
    orchestrationRuntime.snapshot,
  );
  const managed = orchestrationRuns.some(
    (run) =>
      (run.status === "active" || run.status === "paused") &&
      sameCheckout(orchestrationCheckoutCwd(run), sessionExecutionCwd(session)),
  );
  const title = sessionDisplayTitle(session.title, session.harness);
  const isEmpty = session.blocks.length === 0;
  // The transcript mounts only after the first send. Mark that local submit
  // so its prompt can enter without replaying a restored running session.
  const firstSend = useRef<string | null>(null);
  const animateFrom = visible
    ? initialPromptId ?? (firstSend.current === session.id
        ? session.blocks.find(block => block.role === "user" && !block.draft)?.id
        : undefined)
    : undefined;
  useEffect(() => {
    if (!isEmpty || !visible || firstSend.current !== session.id)
      firstSend.current = null;
  }, [isEmpty, visible, session.id]);
  const recallLastTurnRef = useRef<(() => void) | null>(null);
  const editLastTurnSupported = !hostManaged && canEditLastTurn(session);
  const turnRecall = editLastTurnSupported ? lastTurnRecall(session) : null;
  const draftBlock = sessionDraftBlock(session);
  useSyncExternalStore(
    subscribeProjectChatBackground,
    projectChatBackgroundRevision,
    projectChatBackgroundRevision,
  );
  const globalBackgroundPath = useSyncExternalStore(
    subscribeChatBackgroundPath,
    loadChatBackgroundPath,
    loadChatBackgroundPath,
  );
  const globalBackgroundEffect = useSyncExternalStore(
    subscribeChatBackgroundPath,
    loadNewThreadBackgroundEffect,
    loadNewThreadBackgroundEffect,
  );
  const projectBackground = loadProjectChatBackgroundSettings(
    projectKey(session.cwd),
  );
  const projectBackgroundUrl = useProjectBackgroundEffect(
    projectBackground?.path ?? null,
    projectBackground?.effect ?? "none",
    projectChatBackgroundImageRevision(),
  );
  const projectBackgroundStyle = projectBackground
    ? ({
        "--chat-background-image": projectBackgroundUrl
          ? `url(${JSON.stringify(projectBackgroundUrl)})`
          : "none",
        "--chat-background-opacity": String(projectBackground.opacity),
      } as CSSProperties)
    : undefined;
  const approve = useCallback(
    (requestId: number, decision: ApprovalDecision) =>
      onApproval(session.id, requestId, decision),
    [onApproval, session.id],
  );
  const liveQuestionHistoryId = session.pendingQuestion?.historyId;
  const replyQuestion = useCallback(
    (requestId: number, reply: UserQuestionReply) => {
      // A live question the user skipped must not reopen once it is saved.
      if (reply.kind === "skipped" && liveQuestionHistoryId)
        dismissedDockQuestions.add(liveQuestionHistoryId);
      return onQuestionReply(session.id, requestId, reply);
    },
    [onQuestionReply, session.id, liveQuestionHistoryId],
  );
  const openPlan = useCallback(
    (blockId: string) => onOpenPlan(session.id, blockId),
    [onOpenPlan, session.id],
  );
  const openOriginBot = useCallback(
    (origin: NonNullable<Block["origin"]>) => onOpenBot?.(session.id, origin),
    [onOpenBot, session.id],
  );
  const buildPlan = useCallback(
    (blockId: string, target?: PlanBuildTarget) =>
      onBuildPlan(session.id, blockId, target),
    [onBuildPlan, session.id],
  );
  // The newest plan asks to be implemented from the composer, in plan
  // mode's place; a plain message runs the next turn in execution mode.
  const decidingPlanId = usePlanDecision(
    session.blocks,
    !session.busy &&
      !session.pendingQuestion &&
      !session.worktreeRemoved &&
      !session.inboxAsk,
  );
  // Keep an answered or skipped panel's plan while it folds away.
  const lastDecisionPlanId = useRef(decidingPlanId);
  if (decidingPlanId) lastDecisionPlanId.current = decidingPlanId;
  const dockedPlanId = decidingPlanId ?? lastDecisionPlanId.current;
  // Saved questions are answered from the composer dock, not inside history.
  const [openQuestionId, setOpenQuestionId] = useState<string>();
  const [, setDismissRevision] = useState(0);
  const latestQuestionId = latestAnswerableQuestionId(session);
  // Only a question the user has not already skipped or closed opens by itself.
  const autoQuestionId =
    latestQuestionId && !dismissedDockQuestions.has(latestQuestionId)
      ? latestQuestionId
      : undefined;
  const requestedQuestionId = openQuestionId ?? autoQuestionId;
  const lateQuestionsEnabled = !session.worktreeRemoved && session.harness === "codex";
  const shownQuestionId =
    lateQuestionsEnabled &&
    !session.pendingQuestion &&
    questionAnswerableLater(session, requestedQuestionId)
      ? requestedQuestionId
      : undefined;
  const lastShownQuestionId = useRef(shownQuestionId);
  if (shownQuestionId) lastShownQuestionId.current = shownQuestionId;
  const dockedQuestionId = shownQuestionId ?? lastShownQuestionId.current;
  const dockedQuestion = dockedQuestionId
    ? session.blocks.find((block) => block.id === dockedQuestionId)?.question
    : undefined;
  const blocksRef = useRef(session.blocks);
  blocksRef.current = session.blocks;
  // Closing covers every question asked so far; only a newer one opens again.
  const closeQuestionDock = useCallback(() => {
    for (const block of blocksRef.current)
      if (block.question) dismissedDockQuestions.add(block.id);
    setOpenQuestionId(undefined);
    setDismissRevision((revision) => revision + 1);
  }, []);
  const answerQuestionLater = (answer: QuestionAnswer) =>
    onSubmit(session.id, questionFollowUp(session, answer), [], {
      questionAnswer: answer,
    });
  const pendingQuestionId = useRef(session.pendingQuestion?.historyId);
  pendingQuestionId.current = session.pendingQuestion?.historyId;
  const openQuestion = useCallback((blockId: string) => {
    // The live question is already docked in the composer.
    if (blockId !== pendingQuestionId.current)
      setOpenQuestionId(blockId);
  }, []);
  const jumpToBottomRef = useRef<(() => void) | null>(null);
  const transcriptScope = useRef<HTMLDivElement>(null);
  const statusRow = useRef<HTMLDivElement>(null);
  const transcriptWidthRef = useInlineBreakpoints(TRANSCRIPT_BREAKPOINTS, "rem");
  const setTranscriptScope = useCallback((node: HTMLDivElement | null) => {
    transcriptScope.current = node;
    transcriptWidthRef(node);
  }, [transcriptWidthRef]);
  // Workspace commands already route remote:// paths to their owning Host.
  const statusGitCwd = sessionExecutionCwd(session);
  const completedTools = session.blocks.reduce((count, block) => count + Number(
    block.role === "tool" && (block.tool?.status === "completed" || block.tool?.status === "success"),
  ), 0);
  const statusDiff = useProjectDiffStats(statusGitCwd, visible && !isEmpty,
    `${session.id}:${!!session.busy}:${completedTools}`);
  const statusBranches = useProjectBranches(statusGitCwd, visible && !isEmpty);
  const statusBranch = statusBranches?.current || session.branch;
  const statusGit = useMemo(
    () =>
      statusDiff
        ? {
            additions: statusDiff.additions,
            deletions: statusDiff.deletions,
            files: statusDiff.files,
            branch: statusBranch,
          }
        : null,
    [statusDiff, statusBranch],
  );
  const linkedNoticeShown =
    !!session.linkedWorkItemUpdateCard &&
    session.linkedWorkItemUpdateCard.status !== "loading";
  const [transcriptScroller, setTranscriptScroller] =
    useState<HTMLDivElement | null>(null);
  const focusPane = useCallback(
    () => onFocus(session.id),
    [onFocus, session.id],
  );
  const quoteRequestId = useRef(0);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [editingLastTurn, setEditingLastTurn] = useState(false);
  useEffect(() => {
    setEditingLastTurn(false);
  }, [session.id, editLastTurnSupported]);
  const modelWelcomeSequence = useRef(0);
  const [modelWelcome, setModelWelcome] = useState<{
    kind: "astra" | "opus";
    run: number;
  } | null>(null);
  const dismissModelWelcome = useCallback(() => setModelWelcome(null), []);
  useEffect(() => {
    if (!visible) setModelWelcome(null);
  }, [visible]);
  // Restore a saved run for this lead; its agents render on the sidebar card.
  useEffect(() => {
    if (hostManaged && !session.inboxAsk && !session.worktreeRemoved)
      void orchestrationRuntime.hydrate(session.id).catch(console.error);
  }, [hostManaged, orchestrationRuntime, session.id, session.inboxAsk, session.worktreeRemoved]);
  const [quoteRequest, setQuoteRequest] = useState<QuoteRequest>();
  const btw = useBtwConversation({
    available:
      !hostManaged &&
      !isEmpty &&
      !managed &&
      !session.inboxAsk &&
      !session.worktreeRemoved &&
      !!onBtwSubmit &&
      !!onBtwRetry &&
      (supportsBtwHarness(session.harness) ||
        sessionHasBtwThreads(session.blocks)),
    blocks: session.blocks,
    harness: session.harness,
    managed,
    model: session.model,
    modelSettings: session.modelSettings,
    onSubmit: (turn, threadId, messageId, text, model, modelSettings) =>
      onBtwSubmit?.(
        session.id,
        turn,
        threadId,
        messageId,
        text,
        model,
        modelSettings,
      ),
    onRetry: (turn, threadId) => onBtwRetry?.(session.id, turn, threadId),
    onDelete: (turn, threadId) => onBtwDelete?.(session.id, turn, threadId),
    onStop: (turn, threadId) => onBtwStop?.(session.id, turn, threadId),
    onModelChange: (turn, threadId, model, modelSettings) =>
      onBtwModelChange?.(session.id, turn, threadId, model, modelSettings),
  });
  const onJumpToBottomReady = useCallback((jump: () => void) => {
    jumpToBottomRef.current = jump;
  }, []);
  const revealBlockRef = useRef<((blockId: string) => boolean) | null>(null);
  const onRevealReady = useCallback((reveal: (blockId: string) => boolean) => {
    revealBlockRef.current = reveal;
  }, []);
  const revealBlock = useCallback(
    (blockId: string) => revealBlockRef.current?.(blockId) ?? false,
    [],
  );
  const navigateBlockRef = useRef<
    ((blockId: string | null, query?: string) => boolean) | null
  >(null);
  const [navigatorReady, setNavigatorReady] = useState(false);
  const onNavigateReady = useCallback(
    (navigate: (blockId: string | null, query?: string) => boolean) => {
      navigateBlockRef.current = navigate;
      setNavigatorReady(true);
    },
    [],
  );
  const navigateBlock = useCallback(
    (blockId: string | null, query?: string) =>
      navigateBlockRef.current?.(blockId, query) ?? false,
    [],
  );
  const jumpRequest = useSyncExternalStore(
    subscribeTranscriptJump,
    () => peekTranscriptJump(session.id),
    () => null,
  );
  useEffect(() => {
    if (!visible || !navigatorReady || !jumpRequest) return;
    const frame = requestAnimationFrame(() => {
      if (navigateBlock(jumpRequest.blockId, jumpRequest.query)) {
        clearTranscriptJump(session.id, jumpRequest.token);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, navigatorReady, jumpRequest, navigateBlock, session.id]);
  const addSelectionToChat = useCallback(
    (text: string, mode?: QuoteRequest["mode"]) => {
      quoteRequestId.current += 1;
      setQuoteRequest({ id: quoteRequestId.current, text, mode });
    },
    [],
  );
  const acknowledgeQuote = useCallback((handledId: number) => {
    setQuoteRequest((current) => acknowledgeQuoteRequest(current, handledId));
  }, []);
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const saveNote = useCallback(
    async (text: string) => {
      const sessionTitle = sessionDisplayTitle(session.title, session.harness);
      await createNote({
        title:
          sessionTitle && sessionTitle !== "New session"
            ? sessionTitle
            : noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session.cwd, session.harness, session.id, session.title],
  );
  const saveSelectionNote = useCallback(
    async (text: string) => {
      await createNote({
        title: noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session.cwd, session.id],
  );

  useEffect(() => {
    if (!addToChatTarget) return;
    const onAdd = (event: Event) => {
      const detail = (event as CustomEvent<AddToChatRequest>).detail;
      if (!detail?.text) return;
      addSelectionToChat(detail.text, detail.mode);
    };
    window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
  }, [addSelectionToChat, addToChatTarget]);
  const workCwd = sessionExecutionCwd(session);
  const workflowParent = useMemo(
    () => session.blocks.some((block) => block.workflowRun)
      ? { id: session.id, harness: session.harness, model: session.model, modelSettings: session.modelSettings, workflowRuns: session.workflowRuns, cwd: session.cwd }
      : undefined,
    [session.blocks, session.id, session.harness, session.model, session.modelSettings, session.workflowRuns, session.cwd],
  );
  const showDeckProjectPicker = isEmpty && !looksLikeProject(session.cwd);
  const dockComposer =
    hostSessionLoading ||
    (!draftBlock && (!isEmpty || inSplit || !!session.inboxAsk));
  const composerDockMotion = useComposerDockMotion(dockComposer);
  const draftRef = useRef<string | undefined>(getComposerDraft(session.id));
  const composer = (
    <Composer
      key={session.id}
      disabled={
        workspaceSwitchingSessionId === session.id ||
        (nativeReadOnly && !session.busy)
      }
      readOnlyReason={nativeAccessHint}
      messageQueue={messageQueue}
      composerNotice={composerNotice}
      hostManaged={hostManaged}
      remoteSession={remoteSession}
      hostFeatures={hostFeatures}
      orchestrationAvailable={hostManaged && !session.nativeSession}
      allowedModelHarnesses={allowedModelHarnesses}
      enabled={visible}
      focused={focused && composerFocused && !btw.open}
      focusToken={composerFocusToken}
      hotkeys={focused && !btw.open}
      shell={!dockComposer}
      {...sessionComposerConfiguration(session)}
      modelSettingOptions={session.pendingConfiguration ? undefined : session.modelSettingOptions}
      cwd={session.cwd}
      executionCwd={workCwd}
      sessionId={session.id}
      compactSupported={canCompactHarnessContext(session.harness)}
      recents={recents}
      hideProjectPicker={
        !!session.inboxAsk ||
        (hideProjectPicker ? !showDeckProjectPicker : false)
      }
      startedSession={!isEmpty}
      hideBranchPicker={!!session.inboxAsk || managed || isChatFolder(session.cwd)}
      hideTopBar={!!session.inboxAsk}
      context={session.context}
      quoteRequest={quoteRequest}
      initialDraft={
        draftRef.current ??
        (session.inboxCard || session.noteCard || session.handoffCard
          ? undefined
          : session.composerSeed)
      }
      onDraftChange={(text) => {
        draftRef.current = text;
        setComposerDraft(session.id, text);
      }}
      inboxCard={session.inboxCard}
      noteCard={session.noteCard}
      handoffCard={session.handoffCard}
      worktreeCreation={session.worktreeCreation}
      question={session.pendingQuestion}
      children={
        <>
          <AnimatedCollapse expanded={!!shownQuestionId}>
            {dockedQuestionId && dockedQuestion ? (
              <QuestionHistoryForm
                key={dockedQuestionId}
                blockId={dockedQuestionId}
                question={dockedQuestion}
                disabled={!shownQuestionId}
                onAnswer={answerQuestionLater}
                onClose={closeQuestionDock}
                onCollapse={closeQuestionDock}
                variant="dock"
              />
            ) : null}
          </AnimatedCollapse>
          <AnimatedCollapse expanded={!!decidingPlanId}>
            {dockedPlanId ? (
              <PlanDecision
                key={dockedPlanId}
                onImplement={() =>
                  onSubmit(session.id, IMPLEMENT_PLAN_PROMPT, [])
                }
                onRevise={(feedback) =>
                  onSubmit(session.id, feedback, [], { intent: "plan" })
                }
                onSkip={() => skipPlanDecision(dockedPlanId)}
              />
            ) : null}
          </AnimatedCollapse>
        </>
      }
      onQuoteRequestConsumed={acknowledgeQuote}
      onInboxCardDismiss={() => onInboxCardDismiss?.(session.id)}
      onNoteCardDismiss={() => onNoteCardDismiss?.(session.id)}
      onHandoffCardDismiss={() => onHandoffCardDismiss?.(session.id)}
      onQuestionReply={replyQuestion}
      onQuestionInteraction={(id) => onQuestionInteraction?.(session.id, id)}
      onFocus={() => onFocus(session.id)}
      onCwdChange={(cwd) => onCwdChange(session.id, cwd)}
      onBranchChange={() => onBranchChange(session.id)}
      onWorktreeChange={
        onWorktreeChange
          ? (tree) => onWorktreeChange(session.id, tree)
          : undefined
      }
      draftWorkspace={
        !session.inboxAsk &&
        !session.worktreeRemoved &&
        !managed &&
        (hostManaged
          ? !hostSessionStarted
          : (isEmpty || !!session.workspaceMode))
      }
      workspaceMode={session.workspaceMode}
      worktreeBase={session.worktreeBase}
      onWorkspaceModeChange={(mode, base) =>
        onWorkspaceModeChange(session.id, mode, base)
      }
      onWorktreeBaseChange={(base) => onWorktreeBaseChange(session.id, base)}
      worktreeRemoved={session.worktreeRemoved}
      onManageWorktrees={onManageWorktrees}
      onModelChange={(harness, model) => {
        onModelChange(session.id, harness, model);
        const selected = resolveModel(harness, model);
        // A new key restarts the animation and its cleanup timer on every pick.
        const kind = isAstraModel(selected)
          ? "astra"
          : isOpus55Model(selected)
            ? "opus"
            : null;
        setModelWelcome(kind && { kind, run: ++modelWelcomeSequence.current });
      }}
      onModelSettingsChange={(settings) =>
        onModelSettingsChange(session.id, settings)
      }
      onRuntimeModeChange={(mode) => onRuntimeModeChange(session.id, mode)}
      canSaveDraft={
        (!hostManaged || !!hostFeatures?.draft) &&
        !session.busy &&
        !draftBlock &&
        !session.inboxAsk &&
        !session.inboxCard &&
        !session.noteCard &&
        !session.handoffCard
      }
      onSaveDraft={(text, attachments) =>
        onSaveDraft(session.id, text, attachments)
      }
      onSubmit={(text, attachments, options) => {
        if (!dockComposer) composerDockMotion.captureLaunch();
        if (isEmpty) firstSend.current = session.id;
        const accepted = onSubmit(session.id, text, attachments, options);
        if (accepted === false) firstSend.current = null;
        return accepted;
      }}
      onBtwCommand={btw.openWith}
      onStop={() => onStop(session.id)}
      onCompactContext={() => onCompactContext(session.id)}
      queuedMessages={session.queuedMessages}
      queueLastUserMessageId={lastQueueUserMessageId(session.blocks)}
      queueStatus={session.queueStatus}
      onDeleteQueuedMessage={(messageId) =>
        onDeleteQueuedMessage(session.id, messageId)
      }
      onReorderQueuedMessage={(messageId, beforeId) =>
        onReorderQueuedMessage(session.id, messageId, beforeId)
      }
      onSteerQueuedMessage={(messageId) =>
        onSteerQueuedMessage(session.id, messageId)
      }
      onResumeQueue={() => onResumeQueue(session.id)}
      usageLimit={session.usageLimit}
      onUsageLimitResume={() => onUsageLimitResume(session.id)}
      onUsageLimitResumeAtReset={
        onUsageLimitResumeAtReset &&
        ((enabled) => onUsageLimitResumeAtReset(session.id, enabled))
      }
      onUsageLimitDismiss={() => onUsageLimitDismiss(session.id)}
      onOpenFile={onOpenFile}
      busy={!!session.busy}
      allowBusySubmit={!nativeReadOnly}
      editLastTurnSupported={editLastTurnSupported}
      lastTurnRecall={turnRecall}
      onRecallLastTurnReady={(recall) => {
        recallLastTurnRef.current = recall;
      }}
      onEditingLastTurnChange={setEditingLastTurn}
    />
  );

  return (
    <div
      data-session-drop={session.id}
      data-session-empty={isEmpty}
      data-project-chat-background={!!projectBackground}
      data-project-background-effect={projectBackground?.effect}
      style={projectBackgroundStyle}
      className="desktop-session-pane chat-pane-background relative isolate flex h-full min-h-0 min-w-0 flex-1 flex-col"
      onMouseDown={() => onFocus(session.id)}
    >
      {projectBackground?.effect === "gradient-blur" ||
      (!projectBackground &&
        globalBackgroundPath &&
        globalBackgroundEffect === "gradient-blur") ? (
        <GradientBlurBackground />
      ) : null}
      {modelWelcome && visible ? (
        modelWelcome.kind === "astra" ? (
          <AstraWelcome key={modelWelcome.run} onDone={dismissModelWelcome} />
        ) : (
          <OpusWelcome key={modelWelcome.run} onDone={dismissModelWelcome} />
        )
      ) : null}
      {renderHeader ? renderHeader(session) : inSplit ? (
        <div
          data-session-pane-header
          className={`flex h-9 shrink-0 touch-none items-center gap-1.5 border-b border-stroke px-2 select-none ${
            onPaneDragStart ? "cursor-grab active:cursor-grabbing" : ""
          }`}
          onPointerDown={(event) => {
            if (event.button !== 0 || !onPaneDragStart) return;
            if (
              (event.target as HTMLElement | null)?.closest("[data-no-drag]")
            ) {
              return;
            }
            onPaneDragStart(event);
          }}
        >
          {onPaneDragStart ? (
            <GripVertical
              className="size-3.5 shrink-0 text-content/35"
              strokeWidth={1.75}
            />
          ) : null}
          <span
            className={`size-2 shrink-0 rounded-full ${focused ? "bg-accent" : "bg-transparent"}`}
          />
          <span
            className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-content"
            title={title}
          >
            <span className="truncate">{title}</span>
            <SessionWorktreeIcon session={session} />
          </span>
          <button
            type="button"
            title={closePaneLabel}
            aria-label={uiT("Close pane")}
            data-no-drag
            className="grid size-5 shrink-0 place-items-center rounded text-content/50 hover:bg-content/6 hover:text-content"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose(session.id);
            }}
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
      <div className="desktop-conversation-body relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Status cards float on the right; the transcript and composer lane keep clear of them. */}
        <div ref={statusRow} data-session-status-row className="relative flex min-h-0 min-w-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={setTranscriptScope}
          data-transcript-inline-size
          data-transcript-viewport={!isEmpty && !hostSessionLoading || undefined}
          className="relative min-h-0 min-w-0 flex-1"
        >
          <AnimatePresence>{visible && focused && !session.inboxAsk ? (
            <LinkedWorkItemUpdateNotice
              sessionId={session.id}
              card={session.linkedWorkItemUpdateCard}
              onAcknowledge={() => {
                const updatedAt = session.linkedWorkItemUpdateCard?.updatedAt;
                if (updatedAt != null) {
                  markLinkedSessionUpdateSeen(session.id, updatedAt);
                }
              }}
              onDismiss={() => onLinkedWorkItemUpdateCardDismiss?.(session.id)}
              onOpenDiscussion={() => {
                if (session.linkedWorkItem) {
                  onOpenLinkedWorkItem?.(session.linkedWorkItem, session.id);
                }
              }}
              onAddToChat={(text) => addSelectionToChat(text, "plain")}
              onArchiveSession={
                onArchiveSession
                  ? () => onArchiveSession(session.id, true)
                  : undefined
              }
              onDeleteSession={
                onDeleteSession ? () => onDeleteSession(session.id) : undefined
              }
            />
          ) : null}</AnimatePresence>
          {hostSessionLoading ? null : isEmpty ? (
            session.inboxAsk ? (
              <div className="scrollbar-none h-full min-h-0 overflow-y-auto">
                <DiscussionEmpty
                  message={uiT("Explore this item with your agent.")}
                />
              </div>
            ) : (
              <EmptySession
                cwd={session.cwd}
                composer={
                  dockComposer ? undefined : (
                    <div
                      ref={composerDockMotion.centeredRef}
                      data-session-composer
                    >
                      {composer}
                    </div>
                  )
                }
              />
            )
          ) : (
            <>
              <PooledTranscript
                pool={transcriptPool}
                sessionId={session.id}
                onMouseDown={focusPane}
              >
                <AgentTranscript
                  clockOffsetMs={clockOffsetMs}
                  blocks={session.blocks}
                  historyEntries={transcriptHistory}
                  animateFrom={animateFrom}
                  onOpenAgent={openSubagent}
                  onOpenBot={onOpenBot ? openOriginBot : undefined}
                  onOpenQuestion={openQuestion}
                  // No working clock until the worktree exists and the agent has the message.
                  busy={
                    !!session.busy &&
                    !agentWaitingForWorktree(session.worktreeCreation, session.blocks)
                  }
                  visible={visible}
                  cwd={workCwd}
                  harness={session.harness}
                  model={session.model}
                  modelSettings={session.modelSettings}
                  workflowParent={workflowParent}
                  worktreeCreation={session.worktreeCreation}
                  pendingQuestion={!!session.pendingQuestion}
                  pendingQuestionHistoryId={session.pendingQuestion?.historyId}
                  onQuestionFollowUp={lateQuestionsEnabled ? answerQuestionLater : undefined}
                  executionState={session.executionState}
                  backgroundTasks={session.backgroundTasks}
                  onApproval={session.worktreeRemoved ? undefined : approve}
                  onAddToChat={addSelectionToChat}
                  onSaveNote={notesEnabled ? saveNote : undefined}
                  onSendDraft={
                    draftBlock
                      ? (block) =>
                          onSubmit(
                            session.id,
                            block.text,
                            block.attachments ?? [],
                            {
                              draftBlockId: block.id,
                              ...(block.appRequestId
                                ? { appRequestId: block.appRequestId }
                                : {}),
                            },
                          )
                      : undefined
                  }
                  onRemoveDraft={
                    draftBlock
                      ? (block) => onRemoveDraft(session.id, block.id)
                      : undefined
                  }
                  onSaveSelectionNote={
                    notesEnabled ? saveSelectionNote : undefined
                  }
                  onOpenFile={onOpenFile}
                  onOpenDiff={onOpenDiff}
                  onOpenPlan={openPlan}
                  onBuildPlan={session.worktreeRemoved ? undefined : buildPlan}
                  decidingPlanId={decidingPlanId}
                  planBuildTargets={!hostManaged}
                  onSecondOpinion={
                    !session.inboxAsk &&
                    !session.worktreeRemoved &&
                    onSecondOpinion
                      ? (target, turn) =>
                          onSecondOpinion(session.id, target, turn)
                      : undefined
                  }
                  onHandoff={
                    !session.inboxAsk && !session.worktreeRemoved && onHandoff
                      ? (target, turn) => onHandoff(session.id, target, turn)
                      : undefined
                  }
                  onJumpToBottomChange={setShowJumpToBottom}
                  onJumpToBottomReady={onJumpToBottomReady}
                  onRevealReady={onRevealReady}
                  onNavigateReady={onNavigateReady}
                  onScrollerChange={setTranscriptScroller}
                  editingLastTurn={editingLastTurn}
                  onEditLastTurn={
                    editLastTurnSupported
                      ? () => {
                          onFocus(session.id);
                          recallLastTurnRef.current?.();
                        }
                      : undefined
                  }
                  turnAccessory={(user, latest) =>
                    (hostManaged && !hostFeatures?.checkpoint) ||
                    session.inboxAsk ||
                    session.worktreeRemoved ||
                    (latest && draftBlock) ? undefined : (
                      <SessionReview
                        key={user?.id}
                        turnId={user?.checkpointTurnId}
                        historical={!latest}
                        sessionId={session.id}
                        cwd={workCwd}
                        enabled={visible}
                        busy={latest && !!session.busy}
                        undoLocked={
                          reviewUndoLocked ||
                          orchestrationRuns.some(
                            (run) =>
                              (run.status === "active" ||
                                run.status === "paused") &&
                              (run.leadId === session.id ||
                                run.tasks.some(
                                  (task) => task.sessionId === session.id,
                                )),
                          )
                        }
                        onOpenDiff={onOpenDiff}
                      />
                    )
                  }
                />
              </PooledTranscript>
              {!session.inboxAsk ? (
                <TranscriptFind
                  blocks={session.blocks}
                  visible={visible}
                  focused={focused}
                  onNavigate={navigateBlock}
                  side={
                    session.linkedWorkItemUpdateCard &&
                    session.linkedWorkItemUpdateCard.status !== "loading"
                      ? "left"
                      : "right"
                  }
                />
              ) : null}
              <PromptOutline
                blocks={session.blocks}
                scope={transcriptScope}
                scroller={transcriptScroller}
                visible={visible}
                revealBlock={revealBlock}
              />
              {showJumpToBottom ? (
                <div className="desktop-jump-lane pointer-events-none absolute inset-x-0 bottom-2 z-30 flex justify-center">
                  <JumpToBottomButton
                    label={uiT("Jump to latest")}
                    busy={session.busy}
                    onClick={() => jumpToBottomRef.current?.()}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
        {dockComposer ? (
          <div className="desktop-composer-lane shrink-0">
          <div
            ref={composerDockMotion.dockedRef}
            data-session-composer
            inert={btw.open}
            className="desktop-composer-dock mx-auto w-full max-w-4xl shrink-0"
          >
            {composer}
          </div>
          </div>
        ) : null}
        </div>
          <AnimatePresence>{visible &&
          (!isEmpty || hasSessionUsage(usageSessionFor(session))) &&
          !hostSessionLoading &&
          !session.inboxAsk &&
          !linkedNoticeShown ? (
            <SessionStatusPanel
              key={session.id}
              blocks={session.blocks}
              backgroundTasks={session.backgroundTasks}
              busy={!!session.busy}
              git={statusGit}
              cwd={session.cwd}
              branch={statusBranch}
              context={session.context}
              usage={usageSessionFor(session)}
              scope={statusRow}
              onNavigate={navigateBlock}
              onOpenAgent={openSubagent}
              clockOffsetMs={clockOffsetMs}
              onStopBackgroundTask={onStopBackgroundTask
                ? (taskId) => onStopBackgroundTask(session.id, taskId)
                : !hostManaged && canStopHarnessBackgroundTask(session.harness)
                  ? (taskId) => stopHarnessBackgroundTask(session.harness, session.id, taskId)
                  : undefined}
            />
          ) : null}</AnimatePresence>
        </div>
        <BtwSheet
          btw={btw}
          cwd={workCwd}
          visible={visible}
          origin={() =>
            composerDockMotion.dockedRef.current?.querySelector<HTMLElement>(
              "[data-composer-box]",
            ) ?? null
          }
          onSaveNote={notesEnabled ? saveNote : undefined}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      </div>
    </div>
  );
});
