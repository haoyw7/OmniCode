import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { MenuPanel } from "../../../shared/ui/primitives/MenuPanel";
import { useInlineBreakpoints } from "../../../shared/hooks/useInlineBreakpoints";
import { MessageInput } from "../../../shared/ui/messaging/MessageInput";
import { motion } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { MessageQueue } from "./MessageQueue";
import { captureQueueReturnPosition } from "../model/messageQueue";
import { ComposerEnvironmentPicker } from "./ComposerEnvironmentPicker";
import { useComposerEnvironment } from "./useComposerEnvironment";
import { parseWslPath } from "../../../shared/lib/wslPaths";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { MenuHover } from "../../../shared/ui/MenuHover";
import type { SessionModelSettings } from "../model/models";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  AiIdea,
  Check,
  CircleDashed,
  CursorMagicSelection,
  FilePlus,
  Folder,
  Link,
  Plus,
  Share,
  Terminal,
  X,
} from "../../../shared/ui/icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  attachmentsFromFiles,
  attachmentsFromPaths,
  filesFromClipboard,
  mergeAttachments,
  pickAttachments,
  revokeAttachment,
} from "../model/attachments";
import {
  growComposer,
  isInsertion,
  resizeComposer,
} from "../model/composerResize";
import {
  isFileReferenceText,
  messageFilesFromClipboard,
  nativeClipboardAttachments,
} from "../../../platform/tauri/clipboard";
import {
  EXPLORER_FILE_POINTER_DRAG_EVENT,
  type ExplorerFilePointerDragDetail,
} from "../../../shared/lib/drag";
import { dragPointToClient } from "../../../shared/lib/dragPoint";
import type { ContextUsage } from "../model/contextUsage";
import {
  mentionLabel,
  mentionTokenAt,
  replaceMentionToken,
  type MentionToken,
} from "../../connections/files/model/fileMentions";
import type { ProjectFile } from "../../../platform/tauri/fs";
import {
  composeInboxMessage,
  type InboxComposerCard,
} from "../../inbox/model/githubTasks";
import type { HandoffComposerCard } from "../model/handoff";
import {
  looksLikeProject,
  isRemoteProjectPath,
  type RecentProject,
} from "../../projects/model/recents";
import type {
  Attachment,
  HarnessId,
  MessageQueueStatus,
  QueuedMessage,
  QueueReturnPosition,
  UsageLimit,
  RuntimeMode,
  WorkspaceMode,
  ComposerTurnOptions,
} from "../model/session";
import { HARNESS_TITLE, harnessSupportsAttachments } from "../model/session";
import type {
  UserQuestionPrompt,
  UserQuestionReply,
} from "../model/userQuestion";
import { isImeComposition } from "../../../shared/lib/keyboard";
import {
  captureDraft,
  dropPastedText,
  insertRestoredText,
} from "../../../shared/lib/draftRestore";
import {
  createBlankSkill,
  rankSkills,
  hasNativeCommands,
  isNativeCommandPrompt,
  replaceSlashToken,
  slashTokenAt,
  type Skill,
  type SlashToken,
} from "../../skills/model/skills";
import { AccessPicker } from "./AccessPicker";
import { ContextMeter } from "./ContextMeter";
import { ComposerAttachments } from "./ComposerAttachments";
import { BranchPicker } from "../../source-control/ui/BranchPicker";
import { WorktreePicker } from "../../source-control/ui/WorktreePicker";
import {
  isWorkspaceModeShortcut,
  WorkspaceIdentity,
  WorkspacePicker,
  WorktreeBasePicker,
} from "../../workspace/ui/WorkspacePicker";
import { WorkspaceMenuRows } from "./WorkspaceMenuRows";
import { registeredWorktreeAt, type Worktree } from "../../source-control/model/worktrees";
import { useProjectWorktrees } from "../../source-control/hooks/useProjectWorktrees";
import { resolveWorktreeBase } from "../../source-control/model/worktreeBase";
import { CwdPicker } from "../../projects/ui/CwdPicker";
import { FileMentionPicker } from "./FileMentionPicker";
import { McpServerPicker } from "./McpServerPicker";
import { InboxMiniCard } from "../../inbox/ui/InboxMiniCard";
import { NoteMiniCard } from "../../notes/ui/NoteMiniCard";
import { HandoffMiniCard } from "./HandoffMiniCard";
import { ModelControlPills, ModelPicker } from "./ModelPicker";
import { QuestionForm } from "./QuestionForm";
import { SkillPicker } from "../../skills/ui/SkillPicker";
import { projectKey, projectName } from "../../../shared/lib/paths";
import type { WorktreeCreation } from "../../source-control/model/worktreeCreation";
import { consumeQuoteRequest, type QuoteRequest } from "../model/quoteDraft";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import {
  MODEL_CONTROLS_DEFAULT,
  loadModelControls,
  loadNotesEnabled,
  subscribeModelControls,
  subscribeNotesEnabled,
} from "../../settings/model/settings";
import {
  isNoteMentionPath,
  type NoteComposerCard,
} from "../../notes";
import { resolveTabGroupLogo } from "../../workspace/model/tabGroups";
import { useComposerSkills } from "./useComposerSkills";
import { UsageLimitNotice } from "./UsageLimitNotice";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { consumePlanCommand, PLAN_COMMAND } from "../model/plan";
import {
  consumeOperatorCommand,
  OPERATOR_COMMAND,
} from "../model/operatorCommand";
import {
  consumeOrchestratorCommand,
  ORCHESTRATOR_COMMAND,
} from "../model/orchestratorCommand";
import { consumeDraftCommand, DRAFT_COMMAND } from "../model/draftCommand";
import {
  leadingModeCommand,
  MODE_COMMAND_INDENT,
  ModeCommandPill,
} from "./modeCommands";
import {
  BTW_COMMAND,
  consumeBtwCommand,
  consumeBtwPrefix,
  supportsBtwHarness,
} from "../model/btw";
import { COMPACT_COMMAND, isCompactCommand } from "../model/compact";
import { MCP_COMMAND, isMcpCommand } from "../model/mcpCommand";
import {
  mcpContextText,
  newMcpTag,
  taggedMcpServers,
} from "../model/mcpPicker";
import {
  beginComposerAttachmentRead,
  getComposerQueuedDraft,
  parkedComposerDrafts,
  peekComposerAttachments,
  setComposerAttachmentCount,
  setComposerDraft,
  setComposerQueuedDraft,
  stashComposerAttachments,
  takeComposerAttachments,
  type QueuedComposerDraft,
} from "../model/draftCache";
import type { LastTurnRecall } from "../model/editLastTurn";
import { useComposerMcpPicker } from "./useComposerMcpPicker";
import { useComposerMentionCatalog } from "./useComposerMentionCatalog";
import { useSendKick } from "./useSendKick";
import { ComposerHighlight } from "./ComposerHighlight";
import { ComposerAction, ToolButton } from "./ComposerAction";

const COMPOSER_BREAKPOINTS = [220, 280, 360, 480] as const;

type Props = {
  enabled?: boolean;
  focused: boolean;
  /** Bump to force a refocus even when `focused` was already true (e.g. window regains OS focus). */
  focusToken?: number;
  shell?: boolean;
  compact?: boolean;
  placeholder?: string;
  inputAriaLabel?: string;
  disabled?: boolean;
  readOnlyReason?: string;
  allowedModelHarnesses?: readonly HarnessId[];
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  modelSettingOptions?: SessionModelSettings;
  runtimeMode: RuntimeMode;
  cwd?: string;
  executionCwd: string;
  sessionId?: string;
  branch?: string;
  recents?: RecentProject[];
  hideProjectPicker?: boolean;
  /**
   * A started conversation keeps its machine, folder and working copy, so the
   * bar drops those pickers; only a removed worktree keeps its recovery picker.
   */
  startedSession?: boolean;
  hideBranchPicker?: boolean;
  hideTopBar?: boolean;
  /** Queue presentation supplied by the owning runtime. */
  messageQueue?: { render: (restore: (message: QueuedMessage, position?: QueueReturnPosition) => void) => ReactNode };
  /** Runtime notices share the queue's lane above the input. */
  composerNotice?: ReactNode;
  /** Host commands and capabilities apply to both local and remote workspaces. */
  hostManaged?: boolean;
  /** Workspace location is independent of Host ownership. */
  remoteSession?: boolean;
  hostFeatures?: {
    attachments: boolean;
    plan: boolean;
    draft: boolean;
    orchestration?: boolean;
  };
  orchestrationAvailable?: boolean;
  context?: ContextUsage;
  compactSupported?: boolean;
  quoteRequest?: QuoteRequest;
  initialDraft?: string;
  draftResetToken?: number;
  inboxCard?: InboxComposerCard;
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  worktreeCreation?: WorktreeCreation;
  question?: UserQuestionPrompt;
  busy?: boolean;
  /** Allow typed text to replace Stop with Send while a turn is running. */
  allowBusySubmit?: boolean;
  editLastTurnSupported?: boolean;
  lastTurnRecall?: LastTurnRecall | null;
  queuedMessages?: QueuedMessage[];
  queueLastUserMessageId?: string;
  queueStatus?: MessageQueueStatus;
  usageLimit?: UsageLimit;
  hotkeys?: boolean;
  onFocus: () => void;
  onCwdChange: (cwd: string) => void;
  onBranchChange?: () => void;
  onWorktreeChange?: (tree: Worktree) => Promise<void>;
  draftWorkspace?: boolean;
  workspaceMode?: WorkspaceMode;
  worktreeBase?: string;
  onWorkspaceModeChange?: (mode: WorkspaceMode, base?: string) => void;
  onWorktreeBaseChange?: (base: string) => void;
  worktreeRemoved?: boolean;
  onManageWorktrees?: () => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelSettingsChange?: (settings: Record<string, string>) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onQuoteRequestConsumed?: (id: number) => void;
  onInboxCardDismiss?: () => void;
  onNoteCardDismiss?: () => void;
  onHandoffCardDismiss?: () => void;
  onQuestionReply?: (requestId: number, reply: UserQuestionReply) => void;
  onQuestionInteraction?: (requestId: number) => void;
  onSubmit: (
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => boolean | void;
  /** `draft` opens the side question with the text unsent, for a typed `/btw `. */
  onBtwCommand?: (
    text: string,
    options?: { draft?: boolean },
  ) => boolean | void;
  canSaveDraft?: boolean;
  onSaveDraft?: (text: string, attachments: Attachment[]) => boolean | void;
  onStop?: () => void;
  onCompactContext?: () => boolean;
  onDeleteQueuedMessage?: (messageId: string) => void;
  onReorderQueuedMessage?: (messageId: string, beforeId?: string) => void;
  onSteerQueuedMessage?: (messageId: string) => void;
  onResumeQueue?: () => void;
  onUsageLimitResume?: () => void;
  onUsageLimitResumeAtReset?: (enabled: boolean) => void;
  onUsageLimitDismiss?: () => void;
  onOpenFile?: (path: string) => void;
  onDraftChange?: (text: string) => void;
  onRecallLastTurnReady?: (recall: () => void) => void;
  onEditingLastTurnChange?: (editing: boolean) => void;
  children?: ReactNode;
};

const EMPTY_MODEL_SETTINGS: Record<string, string> = {};
const EMPTY_RECENTS: RecentProject[] = [];
const EMPTY_QUEUE: QueuedMessage[] = [];

export function Composer({
  enabled = true,
  focused,
  focusToken,
  hotkeys = false,
  shell = false,
  compact = false,
  placeholder,
  inputAriaLabel,
  disabled = false,
  readOnlyReason,
  harness,
  model,
  allowedModelHarnesses,
  modelSettings = EMPTY_MODEL_SETTINGS,
  modelSettingOptions,
  runtimeMode,
  cwd = "~",
  executionCwd,
  sessionId,
  branch,
  recents = EMPTY_RECENTS,
  hideProjectPicker = false,
  startedSession = false,
  hideBranchPicker = false,
  hideTopBar = false,
  messageQueue,
  composerNotice,
  hostManaged = false,
  remoteSession = false,
  hostFeatures,
  orchestrationAvailable = true,
  context,
  compactSupported = false,
  quoteRequest,
  initialDraft,
  draftResetToken,
  inboxCard,
  noteCard: suppliedNoteCard,
  handoffCard: suppliedHandoffCard,
  question,
  busy = false,
  allowBusySubmit = true,
  editLastTurnSupported = false,
  lastTurnRecall = null,
  queuedMessages = EMPTY_QUEUE,
  queueLastUserMessageId,
  queueStatus,
  usageLimit,
  onFocus,
  onCwdChange,
  onBranchChange,
  onWorktreeChange,
  draftWorkspace = false,
  workspaceMode,
  worktreeBase,
  onWorkspaceModeChange,
  onWorktreeBaseChange,
  worktreeRemoved = false,
  onManageWorktrees,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onQuoteRequestConsumed,
  onInboxCardDismiss,
  onBtwCommand,
  onNoteCardDismiss,
  onHandoffCardDismiss,
  worktreeCreation,
  onQuestionReply,
  onQuestionInteraction,
  onSubmit,
  canSaveDraft = false,
  onSaveDraft,
  onStop,
  onCompactContext,
  onDeleteQueuedMessage,
  onReorderQueuedMessage,
  onSteerQueuedMessage,
  onResumeQueue,
  onUsageLimitResume,
  onUsageLimitResumeAtReset,
  onUsageLimitDismiss,
  onOpenFile,
  onDraftChange,
  onRecallLastTurnReady,
  onEditingLastTurnChange,
  children,
}: Props) {
  const { t: uiT } = useTranslation();
  const composerEnvironment = useComposerEnvironment(sessionId, cwd ?? executionCwd, onCwdChange);
  const needsEnvironmentProject = !remoteSession && !startedSession && composerEnvironment.needsProject;
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const surfaceWidthRef = useInlineBreakpoints(COMPOSER_BREAKPOINTS, "px", !compact);
  const toolbarWidthRef = useInlineBreakpoints(COMPOSER_BREAKPOINTS, "px", compact);
  const plusRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // Attachments left unsent when this session's Composer last unmounted.
  const [restoredAttachments] = useState(() =>
    sessionId ? peekComposerAttachments(sessionId) : undefined,
  );
  const attachmentsRef = useRef<Attachment[]>(
    restoredAttachments?.attachments ?? [],
  );
  const borrowedAttachmentIdsRef = useRef(
    new Set<string>(restoredAttachments?.borrowedIds),
  );
  const attachmentLifecycleRef = useRef(0);
  const consumedQuoteId = useRef<number | null>(null);
  const draftRevisionRef = useRef(0);
  const draftResetTokenRef = useRef(draftResetToken);
  /** Bumped when the draft is cleared, so a late file read cannot land on the next one. */
  const pasteGenerationRef = useRef(0);
  /** Pasted and dropped files still reading when Send is pressed. */
  const pasteFlightRef = useRef<Promise<void> | null>(null);
  const submitLockRef = useRef(false);
  const positionedInitialDraft = useRef(false);
  const slashRef = useRef<SlashToken | null>(null);
  const mentionRef = useRef<MentionToken | null>(null);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const parkedDrafts = useMemo(() => sessionId ? parkedComposerDrafts(sessionId) : [], [sessionId]);
  const [restoredQueueMessage, setRestoredQueueMessage] = useState<QueuedComposerDraft | undefined>(() => sessionId ? getComposerQueuedDraft(sessionId) : undefined);
  const noteCard = restoredQueueMessage ? restoredQueueMessage.noteCard : suppliedNoteCard;
  const handoffCard = restoredQueueMessage ? restoredQueueMessage.handoffCard : suppliedHandoffCard;
  // React rewrites a textarea's text node whenever defaultValue changes, and
  // WebKit then resets the field, committing any IME composition. Parents
  // re-render with the latest draft (remote sessions on every poll), so keep
  // the mount-time value; the effect below applies later changes.
  const [mountDraft] = useState(initialDraft);
  // Desktop folder menus also name a started session's branch, even mid-turn.
  const { branches: draftBranches, settled: draftBranchesSettled } = useProjectBranchesState(
    worktreeRemoved ? cwd : executionCwd,
    enabled,
  );
  // A non-repository returns an empty snapshot on desktop (and may reject on
  // Host). Neither it nor a pending lookup should expose the previous folder's
  // branch/worktree controls or enable their keyboard shortcut.
  const hasGitRepository = !!(draftBranches && (
    draftBranches.current || draftBranches.detached || draftBranches.branches.length
  ));
  const currentBranch = draftBranches?.current ?? (draftBranches?.detached ? "HEAD" : worktreeRemoved ? branch : undefined);
  const resolvedWorktreeBase = hasGitRepository
    ? resolveWorktreeBase(worktreeBase, draftBranches, currentBranch)
    : undefined;
  const { data: registeredWorktrees } = useProjectWorktrees(executionCwd, enabled && hasGitRepository && !worktreeRemoved);
  const executionTree = registeredWorktreeAt(executionCwd, registeredWorktrees?.worktrees ?? []);
  const inWorktree = !!executionTree && !executionTree.isMain;
  const workingName = inWorktree ? projectName(executionTree.path) : undefined;
  const creating = worktreeCreation?.status === "creating";
  useEffect(() => {
    if (
      draftWorkspace &&
      workspaceMode === "worktree" &&
      (!worktreeBase || worktreeBase === "HEAD") &&
      draftBranches &&
      resolvedWorktreeBase && resolvedWorktreeBase !== "HEAD"
    ) {
      onWorktreeBaseChange?.(resolvedWorktreeBase);
    }
  }, [
    draftBranches,
    resolvedWorktreeBase,
    draftWorkspace,
    onWorktreeBaseChange,
    workspaceMode,
    worktreeBase,
  ]);
  const [hasValue, setHasValue] = useState(
    () =>
      (initialDraft ?? "").trim().length > 0 ||
      !!restoredAttachments?.attachments.length ||
      !!inboxCard ||
      !!noteCard ||
      !!handoffCard,
  );
  const [attachments, setAttachments] = useState<Attachment[]>(
    () => restoredAttachments?.attachments ?? [],
  );
  const [pasteError, setPasteError] = useState<string | null>(null);
  const reducedMotion = useMotionPreference();
  const { sendKick, setSendKick, sendScale } = useSendKick(reducedMotion);
  const [fileDrag, setFileDrag] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [planSelected, setPlanSelected] = useState(restoredQueueMessage?.intent === "plan");
  const [operatorSelected, setOperatorSelected] = useState(false);
  const [orchestrationSelected, setOrchestrationSelected] = useState(restoredQueueMessage?.intent === "orchestrate");
  useEffect(() => {
    if (sessionId) setComposerQueuedDraft(sessionId, restoredQueueMessage && {
      ...restoredQueueMessage,
      intent: planSelected ? "plan" : orchestrationSelected ? "orchestrate" : "default",
    });
  }, [sessionId, restoredQueueMessage, planSelected, orchestrationSelected]);
  const [draftSelected, setDraftSelected] = useState(false);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [skillActive, setSkillActive] = useState(0);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const {
    mcpPickerOpen,
    setMcpPickerOpen,
    mcpConnections,
    mcpStatus,
    mcpLoading,
    mcpError,
    selectedMcp,
    setSelectedMcp,
    mcpInsertAt,
    openMcpPicker,
  } = useComposerMcpPicker({ executionCwd, harness, sessionId });
  const [createError, setCreateError] = useState<string | null>(null);
  const createSkillMutation = useMutation({ mutationFn: createBlankSkill }, queryClient);
  const createBusy = createSkillMutation.isPending;
  const remote = remoteSession;
  // Local indexes (files, skills) must never read a remote session's path.
  const localCwd = remote ? "" : executionCwd;
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const modelControls = useSyncExternalStore(
    subscribeModelControls,
    loadModelControls,
    () => MODEL_CONTROLS_DEFAULT,
  );
  const controlsBeside = modelControls === "beside";
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [resendEdited, setResendEdited] = useState(false);
  const groupLogos = useTabGroupLogos();
  const projectLogoPath = resolveTabGroupLogo(projectKey(cwd), groupLogos);

  slashRef.current = slash;
  mentionRef.current = mention;

  attachmentsRef.current = attachments;

  const mentionOpen =
    !remote && mention !== null && (looksLikeProject(cwd) || notesEnabled);
  const { mentionIndex, mentionIndexRef, rankedFiles, mentionActive, setMentionActive, filesLoading } =
    useComposerMentionCatalog({
      localCwd,
      executionCwd,
      cwd,
      mentionOpen,
      mentionQuery: mention?.query,
      notesEnabled,
    });
  const navigationEmpty =
    draft.length === 0 &&
    attachments.length === 0 &&
    !inboxCard &&
    !noteCard &&
    !handoffCard;
  const skillPickerOpen = creatingSkill || slash !== null;
  const pickerOpen = skillPickerOpen || mcpPickerOpen;
  const skillCatalog = useComposerSkills({
    harness,
    executionCwd: localCwd,
    sessionId,
    pickerOpen: pickerOpen && !hostManaged,
  });
  const skills = skillCatalog.skills;
  const slashItems = useMemo(
    () =>
      hostManaged
        ? [
            ...(hostFeatures?.orchestration && !hideTopBar
              ? [ORCHESTRATOR_COMMAND]
              : []),
            ...(hostFeatures?.plan ? [PLAN_COMMAND] : []),
            COMPACT_COMMAND,
          ]
        : [
            MCP_COMMAND,
            OPERATOR_COMMAND,
            ...(hideTopBar || !orchestrationAvailable
              ? []
              : [ORCHESTRATOR_COMMAND]),
            PLAN_COMMAND,
            ...(canSaveDraft && onSaveDraft ? [DRAFT_COMMAND] : []),
            COMPACT_COMMAND,
            ...(supportsBtwHarness(harness) ? [BTW_COMMAND] : []),
            ...skills.filter(
              (skill) =>
                ![OPERATOR_COMMAND.name, "mono", "omnicode"].includes(
                  skill.name,
                ) &&
                (skill.kind === "native" ||
                  (skill.name !== PLAN_COMMAND.name &&
                    skill.name !== COMPACT_COMMAND.name &&
                    skill.name !== MCP_COMMAND.name &&
                    skill.name !== ORCHESTRATOR_COMMAND.name &&
                    skill.name !== DRAFT_COMMAND.name &&
                    skill.name !== BTW_COMMAND.name)),
            ),
          ],
    [
      harness,
      skills,
      hostManaged,
      hostFeatures?.plan,
      hostFeatures?.orchestration,
      orchestrationAvailable,
      hideTopBar,
      canSaveDraft,
      onSaveDraft,
    ],
  );
  const skillLimit = hasNativeCommands(harness)
    ? Number.POSITIVE_INFINITY
    : undefined;
  const slashQuery = slash?.query;
  // Sorting the catalog is costly, so typing outside a `/` token skips it.
  const rankedSkills = useMemo(
    () =>
      slashQuery === undefined
        ? []
        : rankSkills(slashItems, slashQuery, skillLimit),
    [slashItems, slashQuery, skillLimit],
  );
  const attachmentsSupported =
    (!hostManaged || !!hostFeatures?.attachments) &&
    harnessSupportsAttachments(harness);
  const skillNames = useMemo(
    () => new Set(slashItems.map((skill) => skill.invocation)),
    [slashItems],
  );
  const leadingMode = leadingModeCommand(draft, skillNames);
  const modeIndent = leadingMode ? MODE_COMMAND_INDENT : undefined;
  useLayoutEffect(() => {
    // The indent can rewrap the first line after the input already resized.
    if (ref.current) resizeComposer(ref.current);
  }, [modeIndent]);
  const syncHasValue = useCallback(
    (text: string, files: Attachment[]) => {
      if (sessionId) {
        setComposerDraft(sessionId, text);
        setComposerAttachmentCount(sessionId, files.length);
      }
      setHasValue(
        text.trim().length > 0 ||
          files.length > 0 ||
          !!inboxCard ||
          !!noteCard ||
          !!handoffCard,
      );
    },
    [inboxCard, noteCard, handoffCard, sessionId],
  );

  // A leading mode command in the text shows the same pill as picking the mode.
  const operatorActive =
    operatorSelected || leadingMode?.name === OPERATOR_COMMAND.name;
  const orchestrationActive =
    orchestrationSelected || leadingMode?.name === ORCHESTRATOR_COMMAND.name;
  const draftActive = draftSelected || leadingMode?.name === DRAFT_COMMAND.name;
  const planActive = planSelected || leadingMode?.name === PLAN_COMMAND.name;

  /** Turning a mode off also drops its leading command from the text. */
  const clearLeadingMode = (name: string) => {
    const el = ref.current;
    if (!el || leadingModeCommand(el.value, skillNames)?.name !== name) return;
    const next = el.value.replace(/^\/[a-z]+\s?/, "");
    el.value = next;
    resizeComposer(el);
    el.setSelectionRange(0, 0);
    setDraft(next);
    onDraftChange?.(next);
    syncHasValue(next, attachmentsRef.current);
  };

  useEffect(() => {
    syncHasValue(ref.current?.value ?? "", attachmentsRef.current);
  }, [inboxCard, noteCard, handoffCard, syncHasValue]);

  const addAttachments = useCallback(
    (incoming: Attachment[]) => {
      // Capability checks happen before starting a read. Keep accepted files
      // even if the selected provider changes while that read is pending.
      if (incoming.length === 0) return;
      const next = mergeAttachments(attachmentsRef.current, incoming);
      attachmentsRef.current = next;
      setAttachments(next);
      setPasteError(null);
      draftRevisionRef.current += 1;
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [syncHasValue],
  );
  // Native listener registration crosses several IPC hops. Keep changing
  // composer callbacks and capabilities out of its subscription dependencies.
  const fileDropStateRef = useRef({
    attachmentsSupported,
    remote,
    addAttachments,
    uiT,
  });
  fileDropStateRef.current = {
    attachmentsSupported,
    remote,
    addAttachments,
    uiT,
  };

  const attachmentRead = useMutation({ mutationFn: (work: Promise<void>) => work }, queryClient);
  const rememberAttachmentRead = useCallback((work: Promise<void>) => {
    const finishRead = sessionId ? beginComposerAttachmentRead(sessionId) : undefined;
    const flight = attachmentRead.mutateAsync(work).then(
      () => undefined,
      () => undefined,
    );
    const previous = pasteFlightRef.current;
    const joined = previous ? previous.then(() => flight) : flight;
    pasteFlightRef.current = joined;
    void joined.finally(() => {
      if (pasteFlightRef.current === joined) pasteFlightRef.current = null;
      finishRead?.();
    });
  }, [sessionId, attachmentRead.mutateAsync]);

  const readDroppedAttachments = useCallback(
    (read: () => Promise<Attachment[]>) => {
      const generation = pasteGenerationRef.current;
      setPasteError(null);
      rememberAttachmentRead(
        read()
          .then((incoming) => {
            if (pasteGenerationRef.current !== generation) {
              incoming.forEach(revokeAttachment);
              return;
            }
            if (incoming.length === 0) {
              setPasteError(
                fileDropStateRef.current.uiT(
                  "Nothing to attach from that drop — the file may have been moved, renamed, or deleted.",
                ),
              );
              return;
            }
            fileDropStateRef.current.addAttachments(incoming);
          })
          .catch((reason: unknown) => {
            if (pasteGenerationRef.current !== generation) return;
            setPasteError(
              reason instanceof Error ? reason.message : String(reason),
            );
          }),
      );
    },
    [rememberAttachmentRead],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const previous = attachmentsRef.current;
      const removed = previous.find((file) => file.id === id);
      if (removed && !borrowedAttachmentIdsRef.current.delete(removed.id)) {
        revokeAttachment(removed);
      }
      const next = previous.filter((file) => file.id !== id);
      attachmentsRef.current = next;
      draftRevisionRef.current += 1;
      setAttachments(next);
      setPasteError(null);
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [syncHasValue],
  );
  useEffect(() => {
    const lifecycle = ++attachmentLifecycleRef.current;
    if (sessionId) {
      // Runs after a previous Composer's unmount stash for this session, which
      // may land after this one rendered (a pane moving between splits).
      queueMicrotask(() => {
        if (attachmentLifecycleRef.current !== lifecycle) return;
        const stash = takeComposerAttachments(sessionId);
        if (!stash) return;
        const known = new Set(attachmentsRef.current.map((file) => file.id));
        const added = stash.attachments.filter((file) => !known.has(file.id));
        for (const id of stash.borrowedIds) {
          borrowedAttachmentIdsRef.current.add(id);
        }
        if (!added.length) return;
        const next = [...attachmentsRef.current, ...added];
        attachmentsRef.current = next;
        setAttachments(next);
        syncHasValue(ref.current?.value ?? "", next);
      });
    }
    return () => {
      queueMicrotask(() => {
        if (attachmentLifecycleRef.current !== lifecycle) return;
        pasteGenerationRef.current += 1;
        if (sessionId) {
          // Unsent attachments outlive the pane, like the draft text does.
          stashComposerAttachments(
            sessionId,
            attachmentsRef.current,
            borrowedAttachmentIdsRef.current,
          );
        } else {
          for (const file of attachmentsRef.current) {
            if (!borrowedAttachmentIdsRef.current.delete(file.id)) {
              revokeAttachment(file);
            }
          }
        }
        attachmentsRef.current = [];
        borrowedAttachmentIdsRef.current = new Set();
      });
    };
  }, [sessionId]);

  useEffect(() => {
    setSkillActive(0);
  }, [slash?.query, cwd]);

  useEffect(() => {
    setSkillActive((index) =>
      rankedSkills.length === 0 ? 0 : Math.min(index, rankedSkills.length - 1),
    );
  }, [rankedSkills.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !initialDraft) return;
    if (el.value !== initialDraft) el.value = initialDraft;
    if (!positionedInitialDraft.current) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
      positionedInitialDraft.current = true;
    }
    resizeComposer(el);
  }, [initialDraft]);

  // Drafts changed while hidden could not be measured. Inbox panes are portaled
  // into place by a parent effect that runs after this one, so the first pass
  // can still find no layout box; retry once the move has landed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    resizeComposer(el);
    if (el.scrollHeight !== 0) return;
    const frame = requestAnimationFrame(() => {
      if (ref.current === el) resizeComposer(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);
  useEffect(() => {
    if (
      draftResetToken == null ||
      draftResetTokenRef.current === draftResetToken
    ) {
      return;
    }
    draftResetTokenRef.current = draftResetToken;
    setRestoredQueueMessage(undefined);
    pasteGenerationRef.current += 1;
    draftRevisionRef.current += 1;
    if (ref.current) {
      ref.current.value = "";
      resizeComposer(ref.current);
    }
    setDraft("");
    onDraftChange?.("");
    setDraftSelected(false);
    setPlanSelected(false);
    setOrchestrationSelected(false);
    setMcpPickerOpen(false);
    setSelectedMcp([]);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    syncHasValue("", attachmentsRef.current);
  }, [draftResetToken, onDraftChange, syncHasValue]);

  const syncHighlightScroll = useCallback((el: HTMLTextAreaElement) => {
    const highlight = highlightRef.current;
    if (!highlight) return;
    highlight.scrollTop = el.scrollTop;
    highlight.scrollLeft = el.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The textarea can scroll itself to keep the caret visible before React
    // commits the updated highlight text. Sync again after that commit, when
    // the overlay has enough scrollable content to accept the same offset.
    syncHighlightScroll(el);
    const frame = requestAnimationFrame(() => {
      if (ref.current === el) syncHighlightScroll(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [draft, syncHighlightScroll]);

  const syncTokensFromTextarea = (el: HTMLTextAreaElement) => {
    if (creatingSkill) return;
    const cursor = el.selectionStart ?? 0;
    const token = slashTokenAt(el.value, cursor, hasNativeCommands(harness));
    const nextMention = token ? null : mentionTokenAt(el.value, cursor);
    // Input, keyup and select all land here for one keystroke; keep the same
    // token object so unchanged tokens do not re-render the composer again.
    setSlash((current) => (sameToken(current, token) ? current : token));
    setMention((current) =>
      sameToken(current, nextMention) ? current : nextMention,
    );
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !quoteRequest) return;

    const result = consumeQuoteRequest(
      el.value,
      consumedQuoteId.current,
      quoteRequest,
    );
    consumedQuoteId.current = result.consumedId;
    if (result.changed) {
      el.value = result.draft;
      resizeComposer(el);
      setDraft(result.draft);
      syncHasValue(result.draft, attachmentsRef.current);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      el.setSelectionRange(result.draft.length, result.draft.length);
      el.focus();
    }
    onQuoteRequestConsumed?.(quoteRequest.id);
  }, [onQuoteRequestConsumed, quoteRequest, syncHasValue]);

  // `/btw ` opens the side conversation as soon as it is typed, carrying any
  // text after it over as the unsent side question.
  const enterBtwFromPrefix = useCallback(
    (el: HTMLTextAreaElement) => {
      if (!onBtwCommand || inboxCard || noteCard || handoffCard) return false;
      if (attachmentsRef.current.length > 0) return false;
      const rest = consumeBtwPrefix(el.value);
      if (rest == null || onBtwCommand(rest, { draft: true }) === false) {
        return false;
      }
      el.value = "";
      resizeComposer(el);
      draftRevisionRef.current += 1;
      setDraft("");
      onDraftChange?.("");
      syncHasValue("", attachmentsRef.current);
      setSlash(null);
      setMention(null);
      return true;
    },
    [
      handoffCard,
      inboxCard,
      noteCard,
      onBtwCommand,
      onDraftChange,
      syncHasValue,
    ],
  );

  const pickSkill = useCallback(
    (skill: Skill) => {
      const el = ref.current;
      const token = slashRef.current;
      if (!el || !token) {
        setSlash(null);
        setCreatingSkill(false);
        return;
      }
      if (skill.kind === "builtin" && skill.name === MCP_COMMAND.name) {
        const next = `${el.value.slice(0, token.start)}${el.value.slice(token.end).replace(/^\s/, "")}`;
        el.value = next;
        resizeComposer(el);
        mcpInsertAt.current = token.start;
        el.setSelectionRange(token.start, token.start);
        setDraft(next);
        onDraftChange?.(next);
        syncHasValue(next, attachmentsRef.current);
        setSlash(null);
        openMcpPicker();
        return;
      }
      const next = replaceSlashToken(el.value, token, skill.invocation);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + skill.invocation.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      setDraft(next);
      syncHasValue(next, attachmentsRef.current);
      setSlash(null);
      setCreatingSkill(false);
      if (skill.kind === "builtin" && skill.name === BTW_COMMAND.name) {
        enterBtwFromPrefix(el);
      }
      el.focus();
    },
    [enterBtwFromPrefix, onDraftChange, openMcpPicker, syncHasValue],
  );

  const pickMention = useCallback(
    (file: ProjectFile) => {
      const el = ref.current;
      const token = mentionRef.current;
      if (!el || !token) {
        setMention(null);
        return;
      }
      const label = isNoteMentionPath(file.path)
        ? file.relative
        : mentionLabel(file, mentionIndexRef.current);
      const next = replaceMentionToken(el.value, token, label);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + label.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      setDraft(next);
      syncHasValue(next, attachmentsRef.current);
      setMention(null);
      el.focus();
    },
    [syncHasValue],
  );

  useEffect(() => {
    if (!focused || disabled) return;
    const field = ref.current;
    if (!field || document.activeElement === field) return;

    const composer = field.closest("[data-composer]");
    const activeComposer = document.activeElement?.closest("[data-composer]");
    const activeComposerHidden = activeComposer?.closest(
      '[aria-hidden="true"], [inert]',
    );
    // Inactive workspace tabs stay mounted, so focus can still be sitting in
    // their composer when a new session becomes active. Only preserve focus
    // for another composer that is still visible (for example, a split pane).
    if (activeComposer && activeComposer !== composer && !activeComposerHidden)
      return;

    if (
      composer?.querySelector(
        "[data-skill-picker], [data-session-folder-picker], [data-mention-picker], [data-mcp-picker], [data-composer-plus], [data-question-form]",
      )
    )
      return;
    // Model/access/branch/settings/file pickers render through a portal into
    // document.body (see Popover.tsx), so they never appear under this
    // composer's own DOM subtree — check the whole document for those.
    if (
      document.querySelector(
        "[data-model-picker], [data-access-picker], [data-model-settings], [data-file-picker], [data-branch-picker]",
      )
    )
      return;
    field.focus({ preventScroll: true });
  }, [disabled, focused, question, busy, focusToken]);

  useEffect(() => {
    if (!enabled || disabled) {
      setFileDrag(false);
      return;
    }
    const dropRoot = () =>
      boxRef.current?.closest("[data-session-drop]") as HTMLElement | null;
    let nativeDropAt = 0;
    let cancelled = false;

    const overTarget = (x: number, y: number) => {
      const root = dropRoot();
      if (!root) return false;
      const rect = root.getBoundingClientRect();
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    };

    const onDragOver = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFiles(data)) return;
      event.preventDefault();
      const supported = fileDropStateRef.current.attachmentsSupported;
      data.dropEffect = supported ? "copy" : "none";
      setFileDrag(supported);
    };
    const onDragLeave = (event: DragEvent) => {
      const root = dropRoot();
      if (!root) return;
      const next = event.relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      setFileDrag(false);
    };
    const onDrop = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFiles(data)) return;
      event.preventDefault();
      setFileDrag(false);
      if (!fileDropStateRef.current.attachmentsSupported) return;
      if (Date.now() - nativeDropAt < 250) return;
      const files = filesFromClipboard(data);
      if (files.length === 0) return;
      readDroppedAttachments(() => attachmentsFromFiles(files));
    };

    const onExplorerFilePointerDrag = (event: Event) => {
      if (fileDropStateRef.current.remote) return;
      const detail = (event as CustomEvent<ExplorerFilePointerDragDetail>)
        .detail;
      if (!detail || detail.type === "end") {
        setFileDrag(false);
        return;
      }
      const over = overTarget(detail.x, detail.y);
      const supported = fileDropStateRef.current.attachmentsSupported;
      if (detail.type === "move") {
        setFileDrag(over && supported);
        return;
      }
      setFileDrag(false);
      if (!over || !supported) return;
      readDroppedAttachments(() => attachmentsFromPaths([detail.path]));
    };

    const root = dropRoot();
    root?.addEventListener("dragover", onDragOver);
    root?.addEventListener("dragleave", onDragLeave);
    root?.addEventListener("drop", onDrop);
    window.addEventListener(
      EXPLORER_FILE_POINTER_DRAG_EVENT,
      onExplorerFilePointerDrag,
    );

    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        if (event.payload.type === "leave") {
          setFileDrag(false);
          return;
        }
        const { x, y } = event.payload.position;
        const point = dragPointToClient(x, y);
        const over = overTarget(point.x, point.y);
        const supported = fileDropStateRef.current.attachmentsSupported;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setFileDrag(over && supported);
          return;
        }
        if (event.payload.type !== "drop") return;
        setFileDrag(false);
        if (!over || !supported) return;
        if (event.payload.paths.length === 0) {
          setPasteError(
            fileDropStateRef.current.uiT(
              "This drag did not provide a file. Save the image, then drag the saved file here.",
            ),
          );
          return;
        }
        nativeDropAt = Date.now();
        const paths = event.payload.paths;
        readDroppedAttachments(() => attachmentsFromPaths(paths));
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      root?.removeEventListener("dragover", onDragOver);
      root?.removeEventListener("dragleave", onDragLeave);
      root?.removeEventListener("drop", onDrop);
      window.removeEventListener(
        EXPLORER_FILE_POINTER_DRAG_EVENT,
        onExplorerFilePointerDrag,
      );
      unlisten?.();
    };
  }, [disabled, enabled, readDroppedAttachments]);
  useEffect(() => {
    if (!attachmentsSupported) setFileDrag(false);
  }, [attachmentsSupported]);
  const restoreDraft = useCallback(
    (
      text: string,
      nextAttachments: Attachment[],
      borrowedIds: ReadonlySet<string> = borrowedAttachmentIdsRef.current,
    ) => {
      setDraft(text);
      onDraftChange?.(text);
      if (ref.current) {
        ref.current.value = text;
        resizeComposer(ref.current);
      }

      const nextIds = new Set(nextAttachments.map((file) => file.id));
      for (const file of attachmentsRef.current) {
        if (
          nextIds.has(file.id) ||
          borrowedAttachmentIdsRef.current.delete(file.id)
        ) {
          continue;
        }
        revokeAttachment(file);
      }
      borrowedAttachmentIdsRef.current = new Set(
        nextAttachments
          .filter((file) => borrowedIds.has(file.id))
          .map((file) => file.id),
      );
      attachmentsRef.current = nextAttachments;
      setAttachments(nextAttachments);
      syncHasValue(text, nextAttachments);
      ref.current?.focus();
    },
    [onDraftChange, syncHasValue],
  );

  const exitEditMode = useCallback(() => {
    setRestoredQueueMessage(undefined);
    draftRevisionRef.current += 1;
    pasteGenerationRef.current += 1;
    if (ref.current) {
      ref.current.value = "";
      resizeComposer(ref.current);
    }
    setDraft("");
    onDraftChange?.("");
    const previous = attachmentsRef.current;
    for (const file of previous) {
      if (!borrowedAttachmentIdsRef.current.delete(file.id)) {
        revokeAttachment(file);
      }
    }
    attachmentsRef.current = [];
    setAttachments([]);
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setMcpPickerOpen(false);
    setSelectedMcp([]);
    syncHasValue("", []);
    ref.current?.focus();
  }, [onDraftChange, onEditingLastTurnChange, syncHasValue]);

  const restoreQueuedMessage = useCallback((message: QueuedMessage, position?: QueueReturnPosition) => {
    const text = ref.current?.value ?? "";
    if (text.length || attachmentsRef.current.length) {
      parkedDrafts.push({
        text,
        attachments: attachmentsRef.current,
        borrowedIds: new Set(borrowedAttachmentIdsRef.current),
        intent: planSelected ? "plan" : orchestrationSelected ? "orchestrate" : "default",
        operator: operatorSelected,
        draft: draftSelected,
        mcp: selectedMcp,
        queued: restoredQueueMessage ?? (noteCard || handoffCard ? { noteCard, handoffCard } : undefined),
      });
      attachmentsRef.current = [];
      borrowedAttachmentIdsRef.current.clear();
    }
    draftRevisionRef.current += 1;
    pasteGenerationRef.current += 1;
    restoreDraft(message.text, message.attachments, new Set());
    setRestoredQueueMessage({ ...message, queueReturnPosition: position });
    setPlanSelected(message.intent === "plan");
    setOrchestrationSelected(message.intent === "orchestrate");
    setOperatorSelected(false);
    setDraftSelected(false);
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
    setSelectedMcp([]);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
  }, [parkedDrafts, planSelected, orchestrationSelected, operatorSelected, draftSelected, selectedMcp, restoredQueueMessage, noteCard, handoffCard, restoreDraft, onEditingLastTurnChange]);

  const recallLastTurn = useCallback(() => {
    if (!editLastTurnSupported || !lastTurnRecall) return;
    if (resendEdited) {
      exitEditMode();
      return;
    }
    setRestoredQueueMessage(undefined);
    restoreDraft(
      lastTurnRecall.text,
      lastTurnRecall.attachments,
      new Set(lastTurnRecall.attachments.map((file) => file.id)),
    );
    setResendEdited(true);
    onEditingLastTurnChange?.(true);
  }, [
    editLastTurnSupported,
    exitEditMode,
    lastTurnRecall,
    onEditingLastTurnChange,
    resendEdited,
    restoreDraft,
  ]);

  useEffect(() => {
    draftRevisionRef.current += 1;
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
  }, [sessionId, onEditingLastTurnChange]);

  useEffect(() => {
    if (editLastTurnSupported) return;
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
  }, [editLastTurnSupported, onEditingLastTurnChange]);

  useEffect(() => {
    if (!editLastTurnSupported || !onRecallLastTurnReady) return;
    onRecallLastTurnReady(recallLastTurn);
  }, [editLastTurnSupported, onRecallLastTurnReady, recallLastTurn]);

  const submit = (value: string) => {
    if (disabled || worktreeRemoved || submitLockRef.current) return;
    submitLockRef.current = true;
    void completeSubmit(value).finally(() => {
      submitLockRef.current = false;
    });
  };
  const completeSubmit = async (submittedValue: string) => {
    let pending = pasteFlightRef.current;
    const generation = pasteGenerationRef.current;
    while (pending) {
      await pending;
      // A reset or an earlier send retired this draft while the read was out.
      if (pasteGenerationRef.current !== generation) return;
      pending = pasteFlightRef.current;
    }
    const value = ref.current?.value ?? submittedValue;
    if (disabled || worktreeRemoved) return;
    if (!fileDropStateRef.current.attachmentsSupported && attachmentsRef.current.length > 0) {
      toast.error(uiT("Choose a provider that supports attachments, or remove the attached files."));
      return;
    }
    if (needsEnvironmentProject) {
      toast.error(uiT("Choose a project folder in the selected environment before sending."));
      return;
    }
    if (isMcpCommand(value)) {
      mcpInsertAt.current = 0;
      if (ref.current) {
        ref.current.value = "";
        resizeComposer(ref.current);
      }
      setDraft("");
      onDraftChange?.("");
      setSlash(null);
      syncHasValue("", attachments);
      openMcpPicker();
      return;
    }
    const draftCommand = canSaveDraft
      ? consumeDraftCommand(value)
      : { text: value, matched: false };
    if ((draftSelected || draftCommand.matched) && onSaveDraft) {
      const files = attachmentsRef.current;
      const text = draftCommand.text;
      if (!text.trim() && files.length === 0) return;
      const accepted = onSaveDraft(
        mcpContextText(taggedMcpServers(text, selectedMcp), text),
        files,
      );
      if (accepted === false || !ref.current) return;
      pasteGenerationRef.current += 1;
      ref.current.value = "";
      resizeComposer(ref.current);
      setDraft("");
      onDraftChange?.("");
      setAttachments([]);
      setDraftSelected(false);
      setSelectedMcp([]);
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", []);
      return;
    }
    const btwCommand = consumeBtwCommand(value);
    if (
      btwCommand.matched &&
      onBtwCommand &&
      attachmentsRef.current.length === 0 &&
      !inboxCard &&
      !noteCard &&
      !handoffCard
    ) {
      const accepted = onBtwCommand(btwCommand.text);
      if (accepted === false) return;
      pasteGenerationRef.current += 1;
      if (ref.current) {
        ref.current.value = "";
        resizeComposer(ref.current);
      }
      setDraft("");
      onDraftChange?.("");
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", []);
      return;
    }

    if (isCompactCommand(value)) {
      if (!onCompactContext?.()) return;
      if (!ref.current) return;
      pasteGenerationRef.current += 1;
      ref.current.value = "";
      resizeComposer(ref.current);
      setDraft("");
      onDraftChange?.("");
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", attachmentsRef.current);
      return;
    }

    const command = consumePlanCommand(value);
    const orchestratorCommand =
      !hideTopBar && !command.planning
        ? consumeOrchestratorCommand(command.text)
        : { text: command.text, matched: false };
    const text = isNativeCommandPrompt(orchestratorCommand.text, harness)
      ? orchestratorCommand.text
      : composeInboxMessage(inboxCard, orchestratorCommand.text);
    const submittedText =
      operatorSelected && !consumeOperatorCommand(text).matched
        ? `/operator ${text}`
        : text;
    const files = attachmentsRef.current;
    if (!text && files.length === 0 && !noteCard && !handoffCard) return;
    // Clear the parent draft before onSubmit. The app can synchronously remount
    // the composer when the first message leaves an empty session (EmptySession →
    // docked layout). If draftRef still holds the sent text, the new instance
    // resurrects it as initialDraft.
    const resendDraftRevision = draftRevisionRef.current;
    const resendBorrowedAttachmentIds = new Set(
      borrowedAttachmentIdsRef.current,
    );
    const resendSelectedMcp = selectedMcp;
    onDraftChange?.("");
    const accepted = onSubmit(
      mcpContextText(
        taggedMcpServers(submittedText, selectedMcp),
        submittedText,
      ),
      files,
      {
        ...(restoredQueueMessage ? {
          noteCard, handoffCard,
          ...(restoredQueueMessage.queueReturnPosition ? { queueReturnPosition: restoredQueueMessage.queueReturnPosition } : {}),
        } : {}),
        intent:
          planSelected || command.planning
            ? "plan"
            : orchestrationSelected || orchestratorCommand.matched
              ? "orchestrate"
              : "default",
        ...(resendEdited
          ? {
              resendEdited: true,
              onResendRejected: ({ providerRewound }) => {
                if (draftRevisionRef.current !== resendDraftRevision) return;
                restoreDraft(text, files, resendBorrowedAttachmentIds);
                setSelectedMcp(resendSelectedMcp);
                setResendEdited(!providerRewound);
                onEditingLastTurnChange?.(!providerRewound);
              },
            }
          : {}),
      },
    );
    // The app can reject a turn before it is recorded (for example while an
    // orchestration is paused). Keep the user's text, files and selected mode
    // intact so resolving the blocker never destroys their work.
    if (accepted === false) {
      restoreDraft(value, files);
      return;
    }
    pasteGenerationRef.current += 1;
    setSendKick(true);
    if (ref.current) {
      ref.current.value = "";
      resizeComposer(ref.current);
    }
    setDraft("");
    onDraftChange?.("");
    borrowedAttachmentIdsRef.current.clear();
    attachmentsRef.current = [];
    setAttachments([]);
    setSelectedMcp([]);
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
    setPlanSelected(false);
    setOperatorSelected(false);
    setOrchestrationSelected(false);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    setPasteError(null);
    syncHasValue("", []);
    setRestoredQueueMessage(undefined);
    const parked = parkedDrafts.pop();
    if (parked) {
      restoreDraft(parked.text, parked.attachments, parked.borrowedIds);
      setPlanSelected(parked.intent === "plan");
      setOrchestrationSelected(parked.intent === "orchestrate");
      setOperatorSelected(parked.operator);
      setDraftSelected(parked.draft);
      setSelectedMcp(parked.mcp);
      setRestoredQueueMessage(parked.queued);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    if (isImeComposition(e.nativeEvent)) return;
    if (creatingSkill) return;
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      consumeBtwCommand(e.currentTarget.value).matched
    ) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }

    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive((index) => (index + 1) % rankedFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive(
          (index) => (index - 1 + rankedFiles.length) % rankedFiles.length,
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const file = rankedFiles[mentionActive];
        if (file) pickMention(file);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const file = rankedFiles[mentionActive];
        if (file) {
          e.preventDefault();
          pickMention(file);
          return;
        }
        setMention(null);
      }
    }

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      (isCompactCommand(e.currentTarget.value) ||
        isMcpCommand(e.currentTarget.value))
    ) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }

    if (slash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rankedSkills.length === 0) return;
        setSkillActive((index) => (index + 1) % rankedSkills.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rankedSkills.length === 0) return;
        setSkillActive(
          (index) => (index - 1 + rankedSkills.length) % rankedSkills.length,
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const skill = rankedSkills[skillActive];
        if (skill) pickSkill(skill);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const skill = rankedSkills[skillActive];
        if (skill) {
          e.preventDefault();
          pickSkill(skill);
          return;
        }
        if (!slash.query) {
          e.preventDefault();
          return;
        }
        setSlash(null);
      }
    }

    if (
      e.key === "ArrowUp" &&
      editLastTurnSupported &&
      navigationEmpty &&
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === 0
    ) {
      e.preventDefault();
      recallLastTurn();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e.currentTarget.value);
    }
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (
      !draftWorkspace ||
      !hasGitRepository ||
      needsEnvironmentProject ||
      !onWorkspaceModeChange ||
      !enabled ||
      busy ||
      isImeComposition(e.nativeEvent) ||
      !isWorkspaceModeShortcut(e)
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const next =
      (workspaceMode ?? "current") === "current" ? "worktree" : "current";
    if (next === "worktree" && (!resolvedWorktreeBase || (!draftBranches && !draftBranchesSettled))) return;
    onWorkspaceModeChange(
      next,
      next === "worktree" ? resolvedWorktreeBase : undefined,
    );
    ref.current?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    setPasteError(null);
    const messageFiles = messageFilesFromClipboard(e.clipboardData);
    if (messageFiles) {
      e.preventDefault();
      const generation = pasteGenerationRef.current;
      const captured = captureDraft(e.currentTarget);
      const text = e.clipboardData.getData("text/plain");
      if (captured) insertRestoredText(captured, text);
      if (!attachmentsSupported) return;
      rememberAttachmentRead(
        attachmentsFromFiles(messageFiles).then((pasted) => {
          if (pasteGenerationRef.current !== generation) {
            pasted.forEach(revokeAttachment);
            return;
          }
          addAttachments(pasted);
        }),
      );
      return;
    }
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) {
      // A webview reports a paste as text only, so a screenshot or a file
      // copied in a file manager arrives with nothing to attach; both live on
      // the native clipboard.
      if (!attachmentsSupported) return;
      const text = e.clipboardData.getData("text/plain");
      // Prose and whitespace alike are the webview's to insert.
      if (text && !isFileReferenceText(text)) return;
      // A file URI becomes a chip, so it is kept out of the draft; with no text
      // at all the paste carried an image the webview cannot see.
      e.preventDefault();
      // Captured before the read crosses an IPC hop. Send and draft reset bump
      // the generation, so a finished read cannot attach onto a draft that is gone.
      const generation = pasteGenerationRef.current;
      const captured = isFileReferenceText(text)
        ? captureDraft(e.currentTarget)
        : null;
      rememberAttachmentRead(
        nativeClipboardAttachments(text)
          .then(({ files: pasted, warning }) => {
            if (pasteGenerationRef.current !== generation) {
              pasted.forEach(revokeAttachment);
              return;
            }
            if (pasted.length) {
              // WebKit can insert the URI after preventDefault. The chip
              // replaces it, so the draft must not keep that text.
              if (captured) dropPastedText(captured, text);
              addAttachments(pasted);
            } else if (captured) insertRestoredText(captured, text);
            if (warning) setPasteError(warning);
          })
          .catch((reason: unknown) => {
            if (pasteGenerationRef.current !== generation) return;
            setPasteError(
              reason instanceof Error ? reason.message : String(reason),
            );
          }),
      );
      return;
    }
    e.preventDefault();
    if (!attachmentsSupported) return;
    const generation = pasteGenerationRef.current;
    rememberAttachmentRead(
      attachmentsFromFiles(files).then((pasted) => {
        if (pasteGenerationRef.current !== generation) {
          pasted.forEach(revokeAttachment);
          return;
        }
        addAttachments(pasted);
      }),
    );
  };

  const attachFromPicker = () => {
    if (!attachmentsSupported) return;
    const generation = pasteGenerationRef.current;
    rememberAttachmentRead(
      pickAttachments().then((files) => {
        if (pasteGenerationRef.current !== generation) {
          files.forEach(revokeAttachment);
          return;
        }
        addAttachments(files);
      }),
    );
  };

  const openReferencePicker = (trigger: "@" | "/") => {
    setPlusOpen(false);
    const captured = captureDraft(ref.current);
    if (!captured) return;
    const before = captured.value.slice(0, captured.start);
    insertRestoredText(
      captured,
      `${before && !/\s$/.test(before) ? " " : ""}${trigger}`,
    );
    captured.field.focus();
  };

  const focusInput = useCallback(() => ref.current?.focus(), []);
  const changeModelSettings = useCallback(
    (settings: Record<string, string>) => onModelSettingsChange?.(settings),
    [onModelSettingsChange],
  );

  // Typing and menu toggles re-render the composer on every change. The
  // pickers below only depend on props, so keep their elements stable and let
  // React skip them instead of reconciling every picker per keystroke.
  const contextControls = useMemo(() => hideTopBar ? null : (
    <div className="composer-context-controls flex shrink-0 items-center" data-composer-context>
      <ContextMeter
        usage={context}
        onCompact={compactSupported && !worktreeRemoved && !disabled ? onCompactContext : undefined}
        compactDisabled={busy}
      />
    </div>
  ), [hideTopBar, context, compactSupported, worktreeRemoved, disabled, onCompactContext, busy]);
  const workspaceBar = useMemo(
    () => {
      if (hideTopBar) return null;
      const projectPicker = !remote && !startedSession && (!hideProjectPicker || !compact);
      const draftGit =
        draftWorkspace && !!onWorkspaceModeChange && !!onWorktreeBaseChange;
      // A removed worktree keeps its recovery picker in the bar.
      const recoveringWorktree = !draftGit && !!worktreeRemoved && !!onWorktreeChange;
      // Desktop keeps branch and worktree choices inside the folder menu; a
      // started session can still switch branches but not its working copy.
      const foldGit =
        projectPicker && !compact && !hideBranchPicker && !recoveringWorktree;
      const worktreeMode = draftGit && (workspaceMode ?? "current") === "worktree";
      const gitEnabled = enabled && !busy;
      const gitMenuRows = foldGit && hasGitRepository
        ? ({ close, hold }: { close: () => void; hold: (held: boolean) => void }) => (
            <WorkspaceMenuRows
              branchTitle={worktreeMode ? uiT("Base branch") : uiT("Branch")}
              branchLabel={
                worktreeMode
                  ? resolvedWorktreeBase || "HEAD"
                  : (currentBranch ?? uiT("No repo"))
              }
              branchDisabled={
                !gitEnabled || (worktreeMode ? !draftBranches : !currentBranch)
              }
              worktree={
                draftGit ? worktreeMode : onWorktreeChange ? inWorktree : null
              }
              worktreeName={!draftGit && inWorktree ? workingName : undefined}
              worktreeDisabled={
                !draftGit ||
                !gitEnabled ||
                (!draftBranches && !draftBranchesSettled) ||
                !resolvedWorktreeBase ||
                creating
              }
              onHold={hold}
              onClose={close}
              renderPicker={({ anchor, onOpenChange, onFinish }) =>
                worktreeMode ? (
                  <WorktreeBasePicker
                    branches={draftBranches?.branches ?? []}
                    selected={resolvedWorktreeBase || "HEAD"}
                    loading={!draftBranchesSettled}
                    enabled={gitEnabled && !!draftBranches}
                    initialOpen
                    menuAnchor={anchor}
                    popoverSide="right"
                    onChange={(base) => onWorktreeBaseChange?.(base)}
                    onOpenChange={onOpenChange}
                    onClose={onFinish}
                  />
                ) : (
                  <BranchPicker
                    cwd={executionCwd}
                    branch={currentBranch}
                    enabled={gitEnabled}
                    initialOpen
                    menuAnchor={anchor}
                    popoverSide="right"
                    onChange={onBranchChange}
                    onOpenChange={onOpenChange}
                    onClose={onFinish}
                  />
                )
              }
              onWorktreeChange={
                draftGit
                  ? (next) =>
                      onWorkspaceModeChange?.(
                        next ? "worktree" : "current",
                        next ? resolvedWorktreeBase || "HEAD" : undefined,
                      )
                  : undefined
              }
            />
          )
        : undefined;
      return (
        <div className="composer-workspace-bar flex min-w-0 items-center gap-2.5 px-3 pt-2.5">
          {!compact && !startedSession ? <ComposerEnvironmentPicker remote={remote} cwd={cwd ?? executionCwd} onCwdChange={onCwdChange}
            selectedDistribution={remote ? undefined : composerEnvironment.distribution}
            onEnvironmentChange={composerEnvironment.select} /> : null}
          {projectPicker ? (
            <div className="composer-project-picker" data-picker-hidden={hideProjectPicker || undefined}>
            <CwdPicker
              cwd={needsEnvironmentProject ? "~" : cwd}
              recents={recents.filter(item => !isRemoteProjectPath(item.path) && (parseWslPath(item.path)?.machine.distribution ?? null) === composerEnvironment.distribution)}
              projectLogoPath={needsEnvironmentProject ? undefined : projectLogoPath}
              enabled={enabled}
              buttonClassName={
                compact ? undefined : "composer-workspace-trigger"
              }
              chevron={!compact}
              shortLabel={!compact && !needsEnvironmentProject ? projectName(cwd ?? executionCwd) : undefined}
              openFolder={!compact}
              onOpenFolder={composerEnvironment.distribution ? () => void composerEnvironment.pickFolder() : undefined}
              menuFooter={needsEnvironmentProject ? undefined : gitMenuRows}
              onCwdChange={onCwdChange}
              onClear={composerEnvironment.distribution ? undefined : () => onCwdChange("~")}
              onClose={() => ref.current?.focus()}
            />
            </div>
          ) : null}
          {hideBranchPicker || foldGit || needsEnvironmentProject || !hasGitRepository ? null : draftWorkspace &&
            onWorkspaceModeChange &&
            onWorktreeBaseChange ? (
            <div className="composer-git-controls">
              <WorkspacePicker
                composerControls={!compact}
                cwd={executionCwd}
                mode={workspaceMode ?? "current"}
                base={resolvedWorktreeBase}
                workingName={workingName}
                creating={creating}
                enabled={enabled && !busy}
                onModeChange={onWorkspaceModeChange}
                onBaseChange={onWorktreeBaseChange}
                onSelectWorktree={onWorktreeChange}
                onOpenSettings={onManageWorktrees}
                onClose={() => ref.current?.focus()}
              />
              {(workspaceMode ?? "current") === "current" ? (
                <div className="composer-current-branch"><BranchPicker
                  cwd={executionCwd}
                  branch={currentBranch}
                  enabled={enabled && !busy}
                  onChange={onBranchChange}
                  onClose={() => ref.current?.focus()}
                /></div>
              ) : null}
            </div>
          ) : worktreeRemoved && onWorktreeChange ? (
            <WorktreePicker
              cwd={cwd}
              executionCwd={executionCwd}
              enabled={enabled && !busy}
              onSelect={onWorktreeChange}
              worktreeRemoved={worktreeRemoved}
              onBranchChange={onBranchChange}
              onManage={onManageWorktrees}
              onClose={() => ref.current?.focus()}
            />
          ) : startedSession ? null : (
            <>
              {onWorktreeChange ? (
                <WorkspaceIdentity
                  worktree={inWorktree}
                  name={workingName}
                />
              ) : null}
              <BranchPicker
                cwd={executionCwd}
                branch={currentBranch}
                enabled={enabled && !busy}
                onChange={onBranchChange}
                onClose={() => ref.current?.focus()}
              />
            </>
          )}
          {compact ? contextControls : null}
        </div>
      );
    },
    [
      currentBranch,
      hasGitRepository,
      busy,
      compact,
      draftBranches,
      draftBranchesSettled,
      compactSupported,
      context,
      contextControls,
      cwd,
      disabled,
      draftWorkspace,
      enabled,
      executionCwd,
      focusInput,
      hideBranchPicker,
      hideProjectPicker,
      startedSession,
      hideTopBar,
      onBranchChange,
      onCompactContext,
      onCwdChange,
      composerEnvironment,
      needsEnvironmentProject,
      onManageWorktrees,
      onWorkspaceModeChange,
      onWorktreeBaseChange,
      onWorktreeChange,
      projectLogoPath,
      recents,
      remote,
      resolvedWorktreeBase,
      workingName,
      inWorktree,
      creating,
      workspaceMode,
      worktreeRemoved,
      uiT,
    ],
  );

  const accessPicker = useMemo(
    () =>
      !compact && harness !== "fx" ? (
        <AccessPicker
          appearance="composer"
          value={runtimeMode}
          busy={busy}
          onChange={onRuntimeModeChange}
          onClose={focusInput}
        />
      ) : null,
    [busy, compact, focusInput, harness, onRuntimeModeChange, runtimeMode],
  );

  const modelControlElements = useMemo(
    () => (
      <>
        <ModelPicker
          appearance={compact ? undefined : "composer"}
          harness={harness}
          model={model}
          values={modelSettings}
          modelSettingOptions={modelSettingOptions}
          allowedHarnesses={allowedModelHarnesses}
          project={cwd}
          hideSettings={controlsBeside}
          align="end"
          hotkeys={hotkeys && enabled}
          onChange={onModelChange}
          onSettingsChange={changeModelSettings}
          onClose={focusInput}
        />
        {controlsBeside ? (
          <ModelControlPills
            appearance={compact ? undefined : "composer"}
            harness={harness}
            model={model}
            values={modelSettings}
            modelSettingOptions={modelSettingOptions}
            align="end"
            onSettingsChange={changeModelSettings}
            onClose={focusInput}
          />
        ) : null}
      </>
    ),
    [
      allowedModelHarnesses,
      changeModelSettings,
      compact,
      controlsBeside,
      cwd,
      enabled,
      focusInput,
      harness,
      hotkeys,
      model,
      modelSettingOptions,
      modelSettings,
      onModelChange,
    ],
  );

  // The notice keeps its last limit while it collapses away.
  const [shownUsageLimit, setShownUsageLimit] = useState(usageLimit);
  if (usageLimit && usageLimit !== shownUsageLimit) setShownUsageLimit(usageLimit);

  const leadingSurfaces = useMemo(
    () => (
      <>
        {readOnlyReason ? (
          <p
            role="status"
            className="mb-2 rounded-md border border-border bg-content/3 px-3 py-2 text-xs text-muted"
          >
            {readOnlyReason}
          </p>
        ) : null}
        {question && onQuestionReply ? (
          <QuestionForm
            prompt={question}
            onReply={onQuestionReply}
            onInteraction={onQuestionInteraction}
            variant="dock"
          />
        ) : null}
        {children}
        <AnimatedCollapse expanded={!!usageLimit}>
          {shownUsageLimit ? (
            <UsageLimitNotice
              limit={shownUsageLimit}
              onResume={onUsageLimitResume}
              onResumeAtReset={onUsageLimitResumeAtReset}
              onDismiss={onUsageLimitDismiss}
            />
          ) : null}
        </AnimatedCollapse>
        {messageQueue ? messageQueue.render(restoreQueuedMessage) : (
          <MessageQueue
            messages={queuedMessages}
            status={queueStatus}
            remote={remote}
            disabled={disabled}
            canSteer={!hostManaged || busy}
            canResume={!hostManaged || !busy}
            onDelete={onDeleteQueuedMessage}
            onRestore={onDeleteQueuedMessage ? (message) => {
              const position = captureQueueReturnPosition(queuedMessages, message.id, queueLastUserMessageId);
              onDeleteQueuedMessage(message.id);
              restoreQueuedMessage(message, position);
            } : undefined}
            onReorder={onReorderQueuedMessage}
            onSteer={onSteerQueuedMessage}
            onResume={onResumeQueue}
          />
        )}
        <AnimatedCollapse expanded={!!composerNotice}>
          {composerNotice}
        </AnimatedCollapse>
      </>
    ),
    [
      busy,
      children,
      composerNotice,
      disabled,
      messageQueue,
      onDeleteQueuedMessage,
      onReorderQueuedMessage,
      restoreQueuedMessage,
      onQuestionInteraction,
      onQuestionReply,
      onResumeQueue,
      onSteerQueuedMessage,
      onUsageLimitDismiss,
      onUsageLimitResume,
      onUsageLimitResumeAtReset,
      question,
      queueStatus,
      queuedMessages,
      queueLastUserMessageId,
      hostManaged,
      readOnlyReason,
      remote,
      shownUsageLimit,
      usageLimit,
    ],
  );

  const footerControls = (
    <div
      ref={toolbarWidthRef}
      className="composer-toolbar flex min-w-0 flex-1 items-center gap-1"
      onWheel={(e) => {
        if (
          e.target instanceof Element &&
          e.target.closest(
            "[data-model-picker], [data-model-control], [data-access-picker], [data-model-settings]",
          )
        ) {
          return;
        }
        const el = e.currentTarget;
        if (el.scrollWidth <= el.clientWidth) return;
        if (e.deltaX === 0 && e.deltaY !== 0)
          el.scrollLeft += e.deltaY;
      }}
    >
      <div className="composer-leading-controls flex shrink-0 items-center gap-1">
        {accessPicker}
        {!compact && operatorActive ? (
          <ModeCommandPill
            name={OPERATOR_COMMAND.name}
            onClear={() => {
              setOperatorSelected(false);
              clearLeadingMode(OPERATOR_COMMAND.name);
              ref.current?.focus();
            }}
          />
        ) : null}
        {!compact && orchestrationActive ? (
          <ModeCommandPill
            name={ORCHESTRATOR_COMMAND.name}
            onClear={() => {
              setOrchestrationSelected(false);
              clearLeadingMode(ORCHESTRATOR_COMMAND.name);
              ref.current?.focus();
            }}
          />
        ) : null}
        {!compact && planActive ? (
          <ModeCommandPill
            name={PLAN_COMMAND.name}
            onClear={() => {
              setPlanSelected(false);
              clearLeadingMode(PLAN_COMMAND.name);
              ref.current?.focus();
            }}
          />
        ) : null}
        {!compact && draftActive ? (
          <ModeCommandPill
            name={DRAFT_COMMAND.name}
            onClear={() => {
              setDraftSelected(false);
              clearLeadingMode(DRAFT_COMMAND.name);
              ref.current?.focus();
            }}
          />
        ) : null}
      </div>
      <div className="composer-model-controls ml-auto flex min-w-0 items-center gap-1">
        {resendEdited ? (
          <Button variant="ghost" size="content"
            type="button"
            title={uiT("Stop editing last message")}
            aria-label={uiT("Stop editing last message")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={exitEditMode}
            className="edit-last-turn-button flex h-6.5 shrink-0 items-center gap-1 rounded-md border border-current/20 px-2 text-[11px] font-medium transition-[background-color,color,border-color] hover:border-current/35 hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X className="size-3" strokeWidth={1.8} />
            <span>{uiT("Cancel edit")}</span>
          </Button>
        ) : null}
        {modelControlElements}
      </div>
    </div>
  );

  return (
    <div
      data-composer
      data-composer-layout={compact ? "compact" : "desktop"}
      data-native-readonly={readOnlyReason ? "true" : undefined}
      className={cn("relative shrink-0", shell || compact ? "" : "p-1.5 pt-0")}
      onMouseDown={disabled ? undefined : onFocus}
      onKeyDownCapture={disabled ? undefined : onComposerKeyDown}
    >
      {leadingSurfaces}
      <div className="relative overflow-visible">
        {mcpPickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <McpServerPicker
              connections={mcpConnections}
              harness={harness}
              claudeStatus={mcpStatus}
              loading={mcpLoading}
              error={mcpError}
              onPick={(server) => {
                const el = ref.current;
                if (!el) return;
                const previous = selectedMcp.find(
                  (item) =>
                    item.server.provider === server.provider &&
                    item.server.name === server.name &&
                    item.server.scope === server.scope &&
                    item.server.configPath === server.configPath,
                );
                const tag = previous ?? newMcpTag(server, selectedMcp);
                if (!previous) setSelectedMcp((current) => [...current, tag]);
                if (!previous || !taggedMcpServers(el.value, [tag]).length) {
                  const at = Math.min(
                    mcpInsertAt.current ?? el.selectionStart,
                    el.value.length,
                  );
                  const before = el.value.slice(0, at);
                  const after = el.value.slice(at);
                  const leading = before && !/\s$/.test(before) ? " " : "";
                  const trailing = after && /^\s/.test(after) ? "" : " ";
                  const insertion = `${leading}${tag.token}${trailing}`;
                  const next = before + insertion + after;
                  el.value = next;
                  resizeComposer(el);
                  el.setSelectionRange(
                    at + insertion.length,
                    at + insertion.length,
                  );
                  draftRevisionRef.current += 1;
                  setDraft(next);
                  syncHasValue(next, attachmentsRef.current);
                  setMention(null);
                }
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                el.focus();
              }}
              onManage={() => {
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                window.dispatchEvent(new Event("omnicode:open-mcp-settings"));
              }}
              onDismiss={(reason) => {
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                if (reason === "escape") ref.current?.focus();
              }}
            />
          </div>
        ) : skillPickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <SkillPicker
              skills={rankedSkills}
              query={slash?.query ?? ""}
              active={skillActive}
              creating={creatingSkill}
              cwd={executionCwd}
              error={createError}
              busy={createBusy}
              onActive={setSkillActive}
              onPick={pickSkill}
              onStartCreate={() => {
                setCreatingSkill(true);
                setCreateError(null);
              }}
              onCancelCreate={() => {
                setCreatingSkill(false);
                setCreateError(null);
                const el = ref.current;
                if (el) syncTokensFromTextarea(el);
                el?.focus();
              }}
              onCreate={(name, scope) => {
                if (createBusy) return;
                setCreateError(null);
                const contextToken = skillCatalog.contextToken;
                const requestedDraft = ref.current?.value;
                createSkillMutation.mutate({ cwd: executionCwd, name, scope }, {
                  onSuccess: (path) => {
                    if (!skillCatalog.isCurrent(contextToken)) return;
                    const el = ref.current;
                    const token = slashRef.current;
                    if (el && token && el.value === requestedDraft) {
                      const rest = el.value.slice(token.end).replace(/^\s/, "");
                      const next = `${el.value.slice(0, token.start)}${rest}`;
                      el.value = next;
                      resizeComposer(el);
                      el.setSelectionRange(token.start, token.start);
                      setDraft(next);
                      syncHasValue(next, attachments);
                    }
                    setCreatingSkill(false);
                    setSlash(null);
                    setCreateError(null);
                    void skillCatalog
                      .refresh({ refresh: true })
                      .catch(() => undefined);
                    onOpenFile?.(path);
                    el?.focus();
                  },
                  onError: (err) => {
                    if (!skillCatalog.isCurrent(contextToken)) return;
                    toast.error(err instanceof Error ? err.message : String(err));
                    setCreateError(
                      err instanceof Error ? err.message : String(err),
                    );
                  },
                });
              }}
            />
          </div>
        ) : null}
        {mentionOpen && !pickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <FileMentionPicker
              files={rankedFiles}
              query={mention?.query ?? ""}
              active={mentionActive}
              loading={filesLoading}
              includeNotes={notesEnabled}
              onActive={setMentionActive}
              onPick={pickMention}
            />
          </div>
        ) : null}
        <div
          ref={surfaceWidthRef}
          className={cn("composer-surface", hideTopBar ? "" : "composer-surface-with-workspace")}
        >
          <MessageInput
            ref={boxRef}
            data-composer-box
            data-composer-editing={resendEdited ? "" : undefined}
            data-composer-file-drag={fileDrag || undefined}
            className={cn("z-10 border bg-content/3 backdrop-blur-sm", resendEdited
                ? "edit-last-turn-composer rounded-lg"
                : "rounded-lg border-content/10 has-focus:border-content/20", fileDrag ? "border-accent/60" : "")}
          >
            {compact ? workspaceBar : null}
            {fileDrag ? (
              <div className="composer-file-drop pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-accent/8 text-[12px] text-content/70">
                {uiT("Drop files to attach")}
              </div>
            ) : null}

            <ComposerAttachments
              className="composer-attachments flex flex-wrap gap-1.5 px-3 pt-2"
              attachments={attachments}
              onRemove={removeAttachment}
            />

            {pasteError ? (
              <p
                role="alert"
                className="composer-paste-error px-3 pt-2 text-xs text-red-400"
              >
                {pasteError}
              </p>
            ) : null}

            {inboxCard ? (
              <InboxMiniCard card={inboxCard} onDismiss={onInboxCardDismiss} />
            ) : null}

            {noteCard ? (
              <NoteMiniCard card={noteCard} onDismiss={restoredQueueMessage
                ? () => setRestoredQueueMessage((message) => message && { ...message, noteCard: undefined })
                : onNoteCardDismiss} />
            ) : null}

            {handoffCard ? (
              <HandoffMiniCard
                card={handoffCard}
                onDismiss={restoredQueueMessage
                  ? () => setRestoredQueueMessage((message) => message && { ...message, handoffCard: undefined })
                  : onHandoffCardDismiss}
              />
            ) : null}

            <motion.div layout transition={reducedMotion ? immediateTransition : panelTransition} className="composer-editor relative">
              <div
                ref={highlightRef}
                aria-hidden
                style={{ textIndent: modeIndent }}
                className={cn("composer-highlight pointer-events-none absolute inset-0 max-h-40 overflow-hidden whitespace-pre-wrap wrap-break-word px-3 text-sm leading-5.5 text-content font-sans", shell ? "py-4" : "py-3")}
              >
                <ComposerHighlight
                  text={draft}
                  mode={leadingMode}
                  names={skillNames}
                  mentions={mentionIndex.labels}
                  mcpTags={selectedMcp}
                />
              </div>
              <motion.textarea
                layout
                transition={reducedMotion ? immediateTransition : panelTransition}
                ref={ref}
                data-composer-empty={navigationEmpty ? "true" : undefined}
                style={{ textIndent: modeIndent }}
                rows={1}
                spellCheck={false}
                defaultValue={mountDraft}
                placeholder={
                  worktreeRemoved
                    ? uiT("Select a branch or worktree to continue…")
                    : inboxCard
                      ? uiT("Add a note, or send to start…")
                      : noteCard
                        ? uiT("Add a message, or send…")
                        : handoffCard
                          ? uiT("Add context, or send to continue…")
                          : (placeholder ??
                            (shell
                              ? uiT(
                                  "Ask, build, / for commands, @ for references... ",
                                )
                              : uiT(
                                  "Ask, build, / for commands, @ for references... ",
                                )))
                }
                aria-label={inputAriaLabel}
                disabled={disabled}
                className={cn("composer-field scrollbar-none relative max-h-40 w-full resize-none overflow-x-hidden whitespace-pre-wrap wrap-break-word bg-transparent px-3 text-sm leading-5.5 outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap font-sans", shell ? "py-4" : "py-3")}
                onFocus={onFocus}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onScroll={(e) => syncHighlightScroll(e.currentTarget)}
                onClick={(e) => syncTokensFromTextarea(e.currentTarget)}
                onKeyUp={(e) => syncTokensFromTextarea(e.currentTarget)}
                onSelect={(e) => syncTokensFromTextarea(e.currentTarget)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  if (enterBtwFromPrefix(el)) return;
                  if (isInsertion(draft, el.value)) growComposer(el);
                  else resizeComposer(el);
                  draftRevisionRef.current += 1;
                  setDraft(el.value);
                  setSelectedMcp((current) => {
                    const retained = current.filter(
                      (tag) => taggedMcpServers(el.value, [tag]).length > 0,
                    );
                    return retained.length === current.length
                      ? current
                      : retained;
                  });
                  setPasteError(null);
                  syncHasValue(el.value, attachments);
                  syncTokensFromTextarea(el);
                }}
              />
            </motion.div>

            <div className="composer-footer flex items-center gap-1 px-2 pb-2">
              <div
                ref={plusRef}
                className={compact ? "hidden" : "composer-plus-container relative shrink-0"}
              >
                <ToolButton
                  label={uiT("Add files or choose a mode")}
                  active={plusOpen}
                  onClick={() => setPlusOpen((open) => !open)}
                >
                  <Plus className="size-4" />
                </ToolButton>
                <MenuPanel
                  open={plusOpen}
                  inset={!compact}
                  anchor={plusRef}
                  side="top"
                  align="start"
                  width={288}
                  onDismiss={() => setPlusOpen(false)}
                  data-composer-plus
                  role="menu"
                  aria-label={uiT("Add to message")}
                  className="composer-action-menu p-1.5"
                >
                  <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-content/40">
                    {uiT("Add to message")}
                  </p>
                  <Button variant="ghost" size="content"
                    type="button"
                    data-menu-row="description"
                    disabled={!attachmentsSupported}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPlusOpen(false);
                      attachFromPicker();
                    }}
                    className="relative isolate flex w-full items-start gap-2.5 rounded-lg text-left text-content hover:bg-content/6 disabled:cursor-not-allowed disabled:opacity-40 justify-start"
                  >
                    <MenuHover />
                    <FilePlus className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0">
                      <span data-menu-title className="block text-[13px]">
                        {uiT("Upload file")}
                      </span>
                      <span data-menu-description className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                        {attachmentsSupported
                          ? uiT("Attach files or images")
                          : hostManaged && !hostFeatures?.attachments
                            ? uiT("Update this machine’s host to attach files")
                            : uiT("{value0} does not support attachments", {
                                value0: String(HARNESS_TITLE[harness]),
                              })}
                      </span>
                    </span>
                  </Button>
                  {!remote ? (
                    <>
                      <Button variant="ghost" size="content"
                        type="button"
                        data-menu-row="single"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => openReferencePicker("@")}
                        className="composer-add-reference relative isolate"
                      >
                        <MenuHover />
                        <Folder className="size-4 shrink-0" />
                        <span data-menu-title>
                          {uiT(notesEnabled ? "Files and notes" : "Files")}
                        </span>
                        <span className="ml-auto text-content/45">@</span>
                      </Button>
                      {!hostManaged ? (
                        <>
                          <Button variant="ghost" size="content"
                            type="button"
                            data-menu-row="single"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => openReferencePicker("/")}
                            className="composer-add-reference relative isolate"
                          >
                            <MenuHover />
                            <Terminal className="size-4 shrink-0" />
                            <span data-menu-title>{uiT("Skills and commands")}</span>
                            <span className="ml-auto text-content/45">/</span>
                          </Button>
                          <Button variant="ghost" size="content"
                            type="button"
                            data-menu-row="single"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setPlusOpen(false);
                              openMcpPicker();
                              ref.current?.focus();
                            }}
                            className="composer-add-reference relative isolate"
                          >
                            <MenuHover />
                            <Link className="size-4 shrink-0" />
                            <span data-menu-title>{uiT("MCP servers")}</span>
                          </Button>
                        </>
                      ) : null}
                      <div
                        role="separator"
                        className="my-1 h-px bg-content/10"
                      />
                    </>
                  ) : null}
                  {!hostManaged || hostFeatures?.plan ? (
                    <Button variant="ghost" size="content"
                      type="button"
                      data-menu-row="description"
                      aria-pressed={planActive}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setPlanSelected(!planActive);
                        if (planActive) clearLeadingMode(PLAN_COMMAND.name);
                        setOperatorSelected(false);
                        setOrchestrationSelected(false);
                        setDraftSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      className="relative isolate flex w-full items-start gap-2.5 rounded-lg text-left text-content hover:bg-content/6 justify-start"
                    >
                      <MenuHover />
                      <AiIdea className="mt-0.5 size-4 shrink-0 text-yellow-300/80" />
                      <span className="min-w-0 flex-1">
                        <span data-menu-title className="block text-[13px]">
                          {uiT("Plan mode")}
                        </span>
                        <span data-menu-description className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          {uiT("Review a plan before building")}
                        </span>
                      </span>
                      {planActive ? (
                        <Check data-menu-check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                      ) : null}
                    </Button>
                  ) : null}
                  {!hostManaged ? (
                    <Button variant="ghost" size="content"
                      type="button"
                      data-menu-row="description"
                      aria-pressed={operatorActive}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setOperatorSelected(!operatorActive);
                        if (operatorActive) {
                          clearLeadingMode(OPERATOR_COMMAND.name);
                        }
                        setPlanSelected(false);
                        setOrchestrationSelected(false);
                        setDraftSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      className="relative isolate flex w-full items-start gap-2.5 rounded-lg text-left text-content hover:bg-content/6 justify-start"
                    >
                      <MenuHover />
                      <CursorMagicSelection className="mt-0.5 size-4 shrink-0 text-sky-300/80" />
                      <span className="min-w-0 flex-1">
                        <span data-menu-title className="block text-[13px]">
                          {uiT("Operator")}
                        </span>
                        <span data-menu-description className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          {uiT("Give this thread access to OmniCode")}
                        </span>
                      </span>
                      {operatorActive ? (
                        <Check data-menu-check className="mt-0.5 size-3.5 shrink-0 text-sky-300/80" />
                      ) : null}
                    </Button>
                  ) : null}
                  {orchestrationAvailable &&
                    (!hostManaged || hostFeatures?.orchestration) &&
                    !hideTopBar && (
                      <Button variant="ghost" size="content"
                        type="button"
                        data-menu-row="description"
                        aria-pressed={orchestrationActive}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setOrchestrationSelected(!orchestrationActive);
                          if (orchestrationActive) {
                            clearLeadingMode(ORCHESTRATOR_COMMAND.name);
                          }
                          setPlanSelected(false);
                          setOperatorSelected(false);
                          setDraftSelected(false);
                          setPlusOpen(false);
                          ref.current?.focus();
                        }}
                        className="relative isolate flex w-full items-start gap-2.5 rounded-lg text-left text-content hover:bg-content/6 justify-start"
                      >
                        <MenuHover />
                        <Share className="mt-0.5 size-4 shrink-0 text-fuchsia-300/65" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span data-menu-title className="text-[13px]">
                              {uiT("Orchestrator")}
                            </span>
                            <span className="rounded-full bg-fuchsia-300/10 px-1.5 py-0.5 text-[9px] font-medium leading-none tracking-wide text-fuchsia-200/55 mb-px">
                              v1
                            </span>
                          </span>
                          <span data-menu-description className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                            {uiT("Plan and coordinate agent work")}
                          </span>
                        </span>
                        {orchestrationActive && (
                          <Check data-menu-check className="mt-0.5 size-3.5 shrink-0 text-fuchsia-300/80" />
                        )}
                      </Button>
                    )}
                  {canSaveDraft && onSaveDraft ? (
                    <Button variant="ghost" size="content"
                      type="button"
                      data-menu-row="description"
                      aria-pressed={draftActive}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setDraftSelected(!draftActive);
                        if (draftActive) clearLeadingMode(DRAFT_COMMAND.name);
                        setPlanSelected(false);
                        setOperatorSelected(false);
                        setOrchestrationSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      className="relative isolate flex w-full items-start gap-2.5 rounded-lg text-left text-content hover:bg-content/6 justify-start"
                    >
                      <MenuHover />
                      <CircleDashed className="mt-0.5 size-4 shrink-0 text-content/60" />
                      <span className="min-w-0 flex-1">
                        <span data-menu-title className="block text-[13px]">
                          {uiT("Draft")}
                        </span>
                        <span data-menu-description className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          {uiT("Save this message without starting the agent")}
                        </span>
                      </span>
                      {draftActive ? (
                        <Check data-menu-check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                      ) : null}
                    </Button>
                  ) : null}
                </MenuPanel>
              </div>
              {compact ? footerControls : null}
              <motion.div
                data-send-kick={sendKick || undefined}
                style={{ scale: sendScale }}
                className="composer-submit-controls flex shrink-0 items-center gap-1"
              >
                <ComposerAction
                  busy={busy}
                  disabled={disabled}
                  hasValue={hasValue && !worktreeRemoved}
                  allowBusySubmit={allowBusySubmit}
                  label={draftActive ? uiT("Save draft") : uiT("Send")}
                  onSend={() => submit(ref.current?.value ?? "")}
                  onStop={() => onStop?.()}
                />
              </motion.div>
            </div>
          </MessageInput>
          {!compact ? (
            <div className="composer-meta">
              {workspaceBar}
              {footerControls}
              {contextControls}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function sameToken(
  a: SlashToken | MentionToken | null,
  b: SlashToken | MentionToken | null,
): boolean {
  if (a === b) return true;
  return (
    !!a && !!b && a.start === b.start && a.end === b.end && a.query === b.query
  );
}

function hasFiles(data: DataTransfer | null): data is DataTransfer {
  if (!data) return false;
  return (
    data.files.length > 0 ||
    [...data.types].some(
      (type) => type === "Files" || type === "application/x-moz-file",
    ) ||
    Array.from(data.items ?? []).some((item) => item.kind === "file")
  );
}
