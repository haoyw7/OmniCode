import { cn } from "../../../shared/lib/cn";
import { Button } from "../../../shared/ui/forms/Button";
import { fitToolLayout } from "../model/fitToolLayout";
import { fitPaneWidths, paneMinimumWidths, paneWidthBounds } from "../model/paneWidths";
import { beginPaneResize, isPaneResizing, onPaneResizeSettled } from "../../../shared/lib/paneResize";
import { motion, useAnimationControls, type TargetAndTransition } from "motion/react";
import { panelTransition, immediateTransition, motionDistance } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useActiveDragPayload, useActiveDragPayloadRef } from "../../../shared/ui/primitives/Sortable";
import { PaneHeaderDrag, TerminalDockTarget } from "./PaneDrag";
import { PaneCardFrame, paneCardInset } from "./PaneCard";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle, type GroupImperativeHandle } from "../../../shared/ui/primitives/Resizable";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { Maximize2 } from "../../../shared/ui/icons";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { terminalDockOpen } from "../model/paneDrop";
import type {
  ApprovalDecision,
  UserQuestionReply,
} from "../../../integrations/harness";
import type { EditorNavigationTarget, OpenFileFn } from "../../search/model/search";
import {
  isTerminalTab,
  layoutLeaves,
  layoutSashes,
  setSplitRatio,
  splitSizesAtBoundary,
  type EditorPane,
  type LayoutLeaf,
  type LayoutNode,
  type LayoutSash,
  type PaneEdge,
} from "../model/layout";
import {
  sameProjectPath,
  type RecentProject,
} from "../../projects/model/recents";
import type { TerminalMetaPatch } from "../../terminal/model/terminalTab";
import {
  sessionExecutionCwd,
  type Attachment,
  type Block,
  type HarnessId,
  type LinkedWorkItem,
  type ModelTarget,
  type PlanBuildTarget,
  type RuntimeMode,
  type Session,
  type WorkspaceMode,
  type ComposerTurnOptions,
} from "../../sessions/model/session";
import { FilePane } from "../../connections/files/ui/FilePane";
import { SessionPane, type SessionPaneProps } from "../../sessions/ui/SessionPane";
import type { TranscriptPool } from "../../sessions/ui/TranscriptPool";
import type { Worktree } from "../../source-control/model/worktrees";
import {
  SessionHeaderTools,
  SessionSurfaceToolbar,
  type SessionSurfaceMode,
} from "./SessionSurfaceToolbar";
import { SessionSurfacePane } from "./SessionSurfacePane";
import { sessionSurfaceGrid } from "./sessionSurfaceGrid";
import { WindowNavigationSpace } from "../../../app/shell/WindowChrome";

type Shared = {
  workspaceSwitchingSessionId?: string;
  visible: boolean;
  sessions: Session[];
  editorPanes: EditorPane[];
  dirtyFileIds: Set<string>;
  fileErrorCounts: Map<string, number>;
  focusedId: string;
  surfaceMode?: SessionSurfaceMode;
  autoArrangeTools?: boolean;
  windowControls?: ReactNode;
  sessionHeaderHost?: HTMLElement | null;
  reserveWindowNavigationSpace?: boolean;
  addToChatSessionId?: string;
  composerFocused: boolean;
  composerFocusToken?: number;
  recents: RecentProject[];
  hideProjectPicker?: boolean;
  onFocus: (paneId: string) => void;
  onClose: (sessionId: string) => void;
  onSelectFile: (paneId: string, fileId: string) => void;
  onCloseFile: (paneId: string, fileId: string) => void;
  onCloseOtherFiles: (paneId: string, fileId: string) => void;
  onPinFile?: (fileId: string) => void;
  onReorderFiles: (paneId: string, ids: string[]) => void;
  onFileDirtyChange: (fileId: string, dirty: boolean) => void;
  onFileErrorCountChange: (fileId: string, count: number) => void;
  onRatio: (splitId: string, index: number, ratio: number) => void;
  onFitLayout?: (previous: LayoutNode, next: LayoutNode) => void;
  onCwdChange: (sessionId: string, cwd: string) => void;
  onBranchChange: (sessionId: string) => void;
  onWorktreeChange?: (sessionId: string, tree: Worktree) => Promise<void>;
  /** Keeps the App's shell (header, usage, accounts) in step with its Host conversation. */
  onRemoteSnapshot?: SessionPaneProps["onRemoteSnapshot"];
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
  onUsageLimitResumeAtReset: (sessionId: string, enabled: boolean) => void;
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
  onOpenFile: OpenFileFn;
  onOpenFileTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  filesSearchOpen?: boolean;
  onFilesSearchOpenChange?: (open: boolean) => void;
  onOpenSessionFile?: (path: string, sessionId: string) => void;
  editorNavigation?: EditorNavigationTarget | null;
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string; turnId?: string },
  ) => void;
  onOpenPlan: (sessionId: string, blockId: string) => void;
  onOpenBot?: SessionPaneProps["onOpenBot"];
  onUpdatePlan: (sessionId: string, blockId: string, text: string) => void;
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
  onForkSession?: (source: Session) => void;
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
  onMovePane: (fromId: string, toId: string, edge: PaneEdge) => void;
  /** Return a split terminal pane to the project's terminal dock. */
  onMovePaneToDock?: (paneId: string) => void;
  onTerminalMetaChange?: (fileId: string, patch: TerminalMetaPatch) => void;
  transcriptPool?: TranscriptPool;
};

type Props = Shared & { layout: LayoutNode };

const PANE_BOUNDARY_EPSILON = 0.001;

// The owning chat's heading lives in the full-width top bar.
const emptyHeader = () => null;
const windowNavigationSpace = <WindowNavigationSpace />;

function PaneTreeComponent({
  visible,
  layout,
  sessions,
  editorPanes,
  dirtyFileIds,
  fileErrorCounts,
  focusedId,
  surfaceMode = "split",
  autoArrangeTools = true,
  windowControls,
  sessionHeaderHost,
  reserveWindowNavigationSpace = false,
  addToChatSessionId,
  composerFocused,
  composerFocusToken,
  recents,
  hideProjectPicker,
  workspaceSwitchingSessionId,
  onFocus,
  onClose,
  onSelectFile,
  onCloseFile,
  onCloseOtherFiles,
  onPinFile,
  onReorderFiles,
  onFileDirtyChange,
  onFileErrorCountChange,
  onRatio,
  onFitLayout,
  onCwdChange,
  onBranchChange,
  onWorktreeChange,
  onRemoteSnapshot,
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
  onOpenFileTerminal,
  onFileMoved,
  onFileDeleted,
  filesSearchOpen,
  onFilesSearchOpenChange,
  onOpenSessionFile,
  editorNavigation,
  onOpenDiff,
  onOpenPlan,
  onOpenBot,
  onUpdatePlan,
  onBuildPlan,
  onSecondOpinion,
  onBtwSubmit,
  onBtwRetry,
  onBtwDelete,
  onBtwStop,
  onBtwModelChange,
  onHandoff,
  onForkSession,
  onMovePane,
  onMovePaneToDock,
  onTerminalMetaChange,
  transcriptPool,
}: Props) {
  const parentVisible = useSurfaceVisibility();
  const reduced = useMotionPreference();
  const releaseGridMotion = useRef<(() => void) | undefined>(undefined);
  const treeRef = useRef<HTMLDivElement>(null);
  const gridControls = useAnimationControls();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const draft = useRef<LayoutNode | null>(null);
  const activeDrag = useActiveDragPayloadRef();
  // A card can temporarily fill the chat area; the rest stay mounted.
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const onMovePaneRef = useRef(onMovePane);
  onMovePaneRef.current = onMovePane;
  const onMovePaneToDockRef = useRef(onMovePaneToDock);
  onMovePaneToDockRef.current = onMovePaneToDock;
  // Panes holding only terminals can go back to the terminal dock.
  const dockablePaneIds = useRef(new Set<string>());
  dockablePaneIds.current = new Set(
    editorPanes
      .filter(
        (pane) => pane.files.length > 0 && pane.files.every(isTerminalTab),
      )
      .map((pane) => pane.id),
  );
  const { t } = useTranslation();
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const fileActionsRef = useRef({ onOpenFile, onOpenSessionFile });
  fileActionsRef.current = { onOpenFile, onOpenSessionFile };
  const sessionFileHandlers = useRef(new Map<string, (path: string) => void>());

  useEffect(() => {
    const paneIds = new Set(layoutLeaves(layout).map((leaf) => leaf.id));
    for (const sessionId of sessionFileHandlers.current.keys()) {
      if (
        !paneIds.has(sessionId) ||
        !sessions.some((session) => session.id === sessionId)
      ) {
        sessionFileHandlers.current.delete(sessionId);
      }
    }
  }, [layout, sessions]);

  const openSessionFileFor = (sessionId: string) => {
    const cached = sessionFileHandlers.current.get(sessionId);
    if (cached) return cached;
    const handler = (path: string) => {
      const actions = fileActionsRef.current;
      if (actions.onOpenSessionFile) actions.onOpenSessionFile(path, sessionId);
      else actions.onOpenFile(path);
    };
    sessionFileHandlers.current.set(sessionId, handler);
    return handler;
  };

  useLayoutEffect(() => {
    draft.current = null;
  }, [layout]);

  // Stable per card so a sash drag never re-renders memoized file panes.
  const cardMaximize = useRef(
    new Map<string, { maximized: boolean; node: ReactNode }>(),
  );
  const cardChrome = useRef(
    new Map<
      string,
      { maximize: ReactNode; controls: ReactNode; node: ReactNode }
    >(),
  );
  const cardMaximizeFor = (paneId: string, isMaximized: boolean) => {
    const cached = cardMaximize.current.get(paneId);
    if (cached?.maximized === isMaximized) return cached.node;
    const node = (
      <CardMaximizeButton
        maximized={isMaximized}
        onToggle={() =>
          setMaximizedId((current) => (current === paneId ? null : paneId))
        }
      />
    );
    cardMaximize.current.set(paneId, { maximized: isMaximized, node });
    return node;
  };
  // A card's tab row: its maximize toggle, then the window controls when the
  // card owns the top-right corner.
  const cardTrailingFor = (
    paneId: string,
    card: boolean,
    isMaximized: boolean,
    ownsControls: boolean,
  ): ReactNode => {
    const maximize = card ? cardMaximizeFor(paneId, isMaximized) : null;
    if (!ownsControls) return maximize ?? undefined;
    if (!maximize) return windowControls;
    const cached = cardChrome.current.get(paneId);
    if (cached?.maximize === maximize && cached.controls === windowControls) {
      return cached.node;
    }
    const node = (
      <>
        {maximize}
        {windowControls}
      </>
    );
    cardChrome.current.set(paneId, {
      maximize,
      controls: windowControls,
      node,
    });
    return node;
  };

  const tree = layout;
  const leaves = layoutLeaves(tree);
  const sashes = useMemo(() => layoutSashes(tree), [tree]);
  const inSplit = leaves.length > 1;
  const sessionLeaves = leaves.filter((leaf) =>
    sessions.some((session) => session.id === leaf.id),
  );
  const canCloseSessionPane = sessionLeaves.length > 1;
  // `editorPanes` is rebuilt by the caller every render; keep the previous
  // array while its panes are the same so `toolbarProps` stays stable.
  const ownedPanesRef = useRef<EditorPane[]>([]);
  const ownedPanes = useMemo(() => {
    const paneIds = new Set(layoutLeaves(layout).map((leaf) => leaf.id));
    const next = editorPanes.filter((pane) => paneIds.has(pane.id));
    const previous = ownedPanesRef.current;
    return next.length === previous.length &&
      next.every((pane, index) => pane === previous[index])
      ? previous
      : next;
  }, [editorPanes, layout]);
  ownedPanesRef.current = ownedPanes;
  // Multi-chat split layouts retain their existing pane and sash behavior.
  const ownerSession =
    sessionLeaves.length === 1
      ? sessions.find((session) => session.id === sessionLeaves[0].id)
      : undefined;
  const hasOwnerSession = !!ownerSession;
  const requestedUnified = hasOwnerSession && surfaceMode === "unified";
  // Full view grows the selected card the way Maximize does and only then swaps
  // to its own chrome. Its tracks equal that maximized card's, so leaving
  // restores the cards like Restore does.
  const [shownUnified, setShownUnified] = useState(requestedUnified);
  if (!requestedUnified && shownUnified) setShownUnified(false);
  const unified = requestedUnified && shownUnified;
  const fullViewMotion = requestedUnified && !shownUnified;
  // A lone chat, or full view, owns a full-width top bar (title, tools,
  // window controls). The shell can lift a single chat's header into its title
  // row; otherwise split columns keep their own headers.
  const liftHost = !!sessionHeaderHost && visible && hasOwnerSession;
  const promoteHeader = liftHost && (!unified || !inSplit);
  // Full view keeps the chat's tabs in the pane; its tool toggles and menu
  // stay fixed in the window's top bar.
  const liftTools = liftHost && unified && inSplit;
  const ownerTopBar = hasOwnerSession && (unified || !inSplit || promoteHeader);
  // Split view draws every column as a card on a tinted gutter, each with its
  // own header: chats side by side, and a chat beside its documents.
  const paneCards = inSplit && !unified;
  // Without a window tab strip, the top corners of the layout carry the
  // window chrome: navigation space on the left, window controls on the right.
  const topLeftId = leaves.find(
    (leaf) =>
      leaf.rect.x < PANE_BOUNDARY_EPSILON &&
      leaf.rect.y < PANE_BOUNDARY_EPSILON,
  )?.id;
  const topRightId = leaves.find(
    (leaf) =>
      leaf.rect.y < PANE_BOUNDARY_EPSILON &&
      leaf.rect.x + leaf.rect.w > 1 - PANE_BOUNDARY_EPSILON,
  )?.id;
  const selectedId = leaves.some((leaf) => leaf.id === focusedId)
    ? focusedId
    : (ownerSession?.id ?? leaves[0]?.id);
  const maximized =
    unified || !ownerSession
      ? undefined
      : fullViewMotion
        ? selectedId
        : leaves.some((leaf) => leaf.id === maximizedId)
          ? (maximizedId ?? undefined)
          : undefined;
  const sessionPaneIds = sessionLeaves.map(pane => pane.id).sort().join("\n");
  const fitCallback = useRef(onFitLayout);
  fitCallback.current = onFitLayout;
  const fittedSize = useRef("");
  useLayoutEffect(() => {
    const container = treeRef.current;
    if (!container || !visible || unified) return;
    let measuredWidth = container.clientWidth;
    const minimums = paneMinimumSizes(container);
    const toolMinimum = minimums.tool;
    const chats = new Set(sessionPaneIds.split("\\n"));
    const capPaneWidths = () => {
      if (measuredWidth <= 0) return;
      // A size-query container here makes WebKit reevaluate the entire chat
      // on every pixel. Only tools cap their minimum to the available width;
      // conversations keep their full width while tools cover the excess.
      for (const pane of container.querySelectorAll<HTMLElement>(":scope > [data-pane-id]")) {
        if (chats.has(pane.dataset.paneId!)) continue;
        const minimum = `${Math.min(measuredWidth, toolMinimum)}px`;
        if (pane.style.getPropertyValue("--pane-min-width") !== minimum) {
          pane.style.setProperty("--pane-min-width", minimum);
        }
      }
    };
    const fit = () => {
      // Dock and sibling-panel drags also resize this container. Cache their
      // measurements, but only normalize the React layout after release.
      if (isPaneResizing() || draft.current || activeDrag.current?.type === "workspace-pane") return;
      if (requestedUnified || maximized || !fitCallback.current) return;
      const width = measuredWidth;
      if (width <= 0) return;
      // Sash edits keep the user's ratios; refit for topology or available-width changes.
      const key = `${autoArrangeTools}:${Math.round(width)}:${sessionPaneIds}:${layoutLeaves(layout).map(pane => pane.id).join(",")}:${layoutSashes(layout).map(sash => `${sash.splitId}/${sash.dir}`).join(",")}`;
      if (key === fittedSize.current) return;
      fittedSize.current = key;
      const tools = ownerSession && autoArrangeTools ? fitToolLayout(layout, ownerSession.id, width, minimums.chat, toolMinimum) : layout;
      const next = fitPaneWidths(tools, width, paneMinimumWidths(tools, chats, width, minimums));
      if (next !== layout) fitCallback.current?.(layout, next);
    };
    capPaneWidths();
    fit();
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measuredWidth = entry.contentRect.width;
      capPaneWidths();
      fit();
    });
    observer.observe(container);
    const unsubscribe = onPaneResizeSettled(fit);
    return () => { observer.disconnect(); unsubscribe(); };
  }, [layout, visible, ownerSession?.id, sessionPaneIds, unified, requestedUnified, maximized, autoArrangeTools]);

  // The card that was maximized before full view was requested, if any.
  const fullViewTarget = useRef<string | undefined>(undefined);
  if (!fullViewMotion) fullViewTarget.current = maximized;
  const gridMoving = useRef(false);
  // A maximized card fills the area, so it takes over both window corners.
  const chromeLeftId = maximized ?? topLeftId;
  const chromeRightId = maximized ?? topRightId;
  const surfaceGrid = ownerSession
    ? sessionSurfaceGrid(leaves, unified ? selectedId : maximized)
    : undefined;
  const toolbarProps = useMemo(
    () => ({
      panes: ownedPanes,
      focusedId: selectedId ?? "",
      dirtyFileIds,
      fileErrorCounts,
      onFocus,
      onSelectFile,
      onCloseFile,
      onCloseOtherFiles,
      onPinFile,
      onReorderFiles,
      windowControls: hasOwnerSession ? windowControls : undefined,
      reserveWindowNavigationSpace:
        hasOwnerSession && reserveWindowNavigationSpace,
    }),
    [
      ownedPanes,
      selectedId,
      dirtyFileIds,
      fileErrorCounts,
      onFocus,
      onSelectFile,
      onCloseFile,
      onCloseOtherFiles,
      onPinFile,
      onReorderFiles,
      hasOwnerSession,
      windowControls,
      reserveWindowNavigationSpace,
    ],
  );
  const gridStyle = surfaceGrid
    ? {
        ...surfaceGrid.style,
        // The unified strip selects a surface in place. Animating these tracks
        // exposes both terminals mid-switch and slides/reflows their contents.
        // Split/full-view entry still animates before `unified` becomes true.
        transitionProperty: unified ? "none" : undefined,
      }
    : undefined;
  const resizeConfig = useRef({
    grid: !!surfaceGrid,
    selectedId: unified ? selectedId : maximized,
    unified,
  });
  resizeConfig.current = {
    grid: !!surfaceGrid,
    selectedId: unified ? selectedId : maximized,
    unified,
  };
  const gridColumns = surfaceGrid ? String(surfaceGrid.style.gridTemplateColumns) : undefined;
  const gridRows = surfaceGrid ? String(surfaceGrid.style.gridTemplateRows) : undefined;
  const gridTopology = surfaceGrid ? JSON.stringify([...surfaceGrid.placements]) : undefined;
  const previousGridTopology = useRef(gridTopology);
  useLayoutEffect(() => {
    const topologyChanged = previousGridTopology.current !== gridTopology;
    previousGridTopology.current = gridTopology;
    if (!gridColumns || !gridRows) return;
    const target = { gridTemplateColumns: gridColumns, gridTemplateRows: gridRows };
    if (topologyChanged) {
      // Grid line placements update in this commit. Old tracks would briefly
      // shrink an unchanged chat when a neighbouring split loses a row/column.
      gridControls.stop();
      gridControls.set(target);
      releaseGridMotion.current?.();
      releaseGridMotion.current = undefined;
      gridMoving.current = false;
    } else {
      void gridControls.start({
        ...target,
        transition: reduced || unified || !!draft.current ? immediateTransition : panelTransition,
      });
    }
  }, [gridColumns, gridRows, gridTopology, gridControls, reduced, unified]);
  const paintLayout = (tree: LayoutNode, syncMotion = false) => {
    const container = treeRef.current;
    const { grid, selectedId, unified } = resizeConfig.current;
    if (container) {
      const surface = paintPaneLayout(container, tree, grid, selectedId, unified);
      if (surface && syncMotion) {
        gridControls.stop();
        gridControls.set({
          gridTemplateColumns: String(surface.style.gridTemplateColumns),
          gridTemplateRows: String(surface.style.gridTemplateRows),
        });
        releaseGridMotion.current?.();
        releaseGridMotion.current = undefined;
        gridMoving.current = false;
      }
    }
  };
  // A stream may render React during a drag. Reapply the preview before paint
  // and synchronize Motion's stored styles only on this cold path, so its next
  // render cannot restore the pre-drag tracks. Pointer moves only write DOM.
  useLayoutEffect(() => {
    if (draft.current) paintLayout(draft.current, true);
  });

  useLayoutEffect(() => {
    if (fullViewMotion && (reduced || !inSplit || fullViewTarget.current === selectedId && !gridMoving.current)) setShownUnified(true);
  }, [fullViewMotion, selectedId, inSplit, reduced]);
  useEffect(() => () => releaseGridMotion.current?.(), []);
  const finishGridMotion = () => {
    gridMoving.current = false;
    releaseGridMotion.current?.(); releaseGridMotion.current = undefined;
    if (fullViewMotion) setShownUnified(true);
  };

  // A pane split into an existing layout slides in from the edge it was added
  // on, like the linked work item panel. The neighbours reflow once up front;
  // only the new pane's content moves, so nothing rewraps mid-animation.
  // Panes present when the tree mounts, or swapped in place, just appear.
  const knownLeafIds = useRef<ReadonlySet<string> | null>(null);
  const enteringPanes = useRef(new Map<string, PaneEnterFrom>());
  const [, rerender] = useReducer((tick: number) => tick + 1, 0);
  if (knownLeafIds.current && leaves.length > knownLeafIds.current.size) {
    for (const leaf of leaves) {
      if (knownLeafIds.current.has(leaf.id)) continue;
      enteringPanes.current.set(leaf.id, paneEnterFrom(leaf));
    }
  }
  knownLeafIds.current = new Set(leaves.map((leaf) => leaf.id));

  const dragPayloadFor = (paneId: string) => ({
    type: "workspace-pane", paneId,
    onPlace: (targetId: string, edge: PaneEdge) => onMovePaneRef.current(paneId, targetId, edge),
    onDock: dockablePaneIds.current.has(paneId) && onMovePaneToDockRef.current ? () => onMovePaneToDockRef.current?.(paneId) : undefined,
  });

  // Keyed by the session ids only: a streamed token replaces a `Session`
  // object every frame, and a new header function would defeat the memo on
  // every visible `SessionPane`. The header reads the latest session at call
  // time, which is during that pane's own render.
  const sessionIdsKey = sessions.map((session) => session.id).join("\n");
  const sessionHeaders = useMemo(
    () =>
      new Map(
        (sessionIdsKey ? sessionIdsKey.split("\n") : []).map((sessionId) => [
          sessionId,
          unified
            ? undefined
            : ownerTopBar
              ? emptyHeader
              : (resolvedSession: Session) => {
                  const session =
                    sessionsRef.current.find(
                      (entry) => entry.id === sessionId,
                    ) ?? resolvedSession;
                  return (
                    <SessionSurfaceToolbar
                      {...toolbarProps}
                      session={{
                        ...session,
                        title: resolvedSession.title,
                        harness: resolvedSession.harness,
                      }}
                      showTools={false}
                      windowControls={
                        sessionId === chromeRightId ? windowControls : undefined
                      }
                      reserveWindowNavigationSpace={
                        !!reserveWindowNavigationSpace &&
                        sessionId === chromeLeftId
                      }
                      onClosePane={canCloseSessionPane ? () => onClose(sessionId) : undefined}
                      paneFocused={
                        inSplit && !hasOwnerSession
                          ? focusedId === sessionId
                          : undefined
                      }
                    />
                  );
                },
        ]),
      ),
    [
      sessionIdsKey,
      unified,
      toolbarProps,
      hasOwnerSession,
      ownerTopBar,
      inSplit,
      canCloseSessionPane,
      onClose,
      focusedId,
      chromeLeftId,
      chromeRightId,
      windowControls,
      reserveWindowNavigationSpace,
    ],
  );

  const ownerHeader = ownerTopBar && ownerSession ? (
    <SurfaceVisibilityContext.Provider value={parentVisible && visible}>
      <PaneHeaderDrag payload={dragPayloadFor(ownerSession.id)} label={ownerSession.title} disabled={!inSplit || unified}
        previewElement={() => treeRef.current?.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(ownerSession.id)}"]`) ?? null}>
      <SessionSurfaceToolbar
        {...toolbarProps}
        session={ownerSession}
        showTools={unified}
        tools={!liftTools}
      />
      </PaneHeaderDrag>
    </SurfaceVisibilityContext.Provider>
  ) : null;

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      {promoteHeader ? createPortal(ownerHeader, sessionHeaderHost) : ownerHeader}
      {liftTools && ownerSession
        ? createPortal(
            <SurfaceVisibilityContext.Provider value={parentVisible && visible}>
              <SessionHeaderTools session={ownerSession} />
            </SurfaceVisibilityContext.Provider>,
            sessionHeaderHost,
          )
        : null}
      <motion.div
        initial={false}
        animate={gridControls}
        transition={reduced || unified || !!draft.current ? immediateTransition : panelTransition}
        onAnimationStart={() => { releaseGridMotion.current?.(); releaseGridMotion.current = beginPaneResize(); gridMoving.current = true; }}
        onAnimationComplete={finishGridMotion}
        ref={treeRef}
        data-pane-tree-layout
        data-chat-overlap={ownerSession && !unified ? "" : undefined}
        data-chat-tiles={sessionLeaves.length > 1 ? "" : undefined}
        data-surface-mode={unified ? "unified" : "split"}
        data-pane-cards={paneCards ? "" : undefined}
        className={cn("relative min-h-0 min-w-0 flex-1", surfaceGrid ? "animated-collapse-size grid" : "", paneCards ? "pane-card-gutter" : "")}
        style={gridStyle ? { ...gridStyle, gridTemplateRows: undefined, gridTemplateColumns: undefined } : undefined}
      >
        {leaves.map((leaf) => {
          const editorPane = editorPanes.find((pane) => pane.id === leaf.id);
          // App views beside a chat keep their own full-bleed surface.
          const asCard =
            paneCards &&
            !(
              hasOwnerSession &&
              editorPane?.files.some((file) => file.appView)
            );
          const session = sessions.find((entry) => entry.id === leaf.id);
          const expanded = unified
            ? selectedId === leaf.id
            : !maximized || maximized === leaf.id;
          const paneVisible = visible && expanded;
          const backgroundStyle = paneBackgroundStyle(leaf.rect, unified);
          return (
            <SessionSurfacePane
              key={leaf.id}
              id={leaf.id}
              chat={!!session}
              chatEdge={
                session && hasOwnerSession
                  ? leaf.rect.x < PANE_BOUNDARY_EPSILON ? "left" : "right"
                  : undefined
              }
              grid={!!surfaceGrid}
              expanded={expanded}
              visible={visible}
              dragEnabled={inSplit && !unified}
              dragPayload={dragPayloadFor(leaf.id)}
              dragLabel={session?.title ?? editorPane?.files.find(file => file.id === editorPane.activeFileId)?.path ?? t("Split view")}
              // The new pane focuses its composer or editor while it is still
              // offscreen, and focus scrolls this clip box to reveal it, which
              // fights the slide. Scroll events land before paint, so undoing
              // it here never shows.
              onScroll={(event) => {
                if (!enteringPanes.current.has(leaf.id)) return;
                event.currentTarget.scrollLeft = 0;
                event.currentTarget.scrollTop = 0;
              }}
              style={{
                // Tools may cover a chat; side-by-side chats stay in their slots.
                minWidth: expanded && (session || !unified)
                  ? session
                    ? hasOwnerSession ? "var(--desktop-conversation-min-width)" : undefined
                    : "var(--pane-min-width, var(--desktop-pane-min-width))"
                  : undefined,
                ...(surfaceGrid
                  ? {
                      ...surfaceGrid.placements.get(leaf.id),
                      width: "100%",
                      justifySelf: leaf.rect.x + leaf.rect.w > 1 - PANE_BOUNDARY_EPSILON ? "end" : "start",
                      ...backgroundStyle,
                    }
                  : unified
                    ? {
                        inset: 0,
                        ...backgroundStyle,
                      }
                    : {
                        ...panePositionStyle(leaf.rect),
                        ...backgroundStyle,
                      }),
              }}
            >
              <motion.div
                data-pane-background-geometry
                initial={enteringPanes.current.has(leaf.id) && !reduced ? paneEntrance(enteringPanes.current.get(leaf.id)!) : false}
                animate={{ x: 0, y: 0, opacity: 1 }}
                transition={reduced ? immediateTransition : panelTransition}
                data-pane-enter={enteringPanes.current.get(leaf.id)}
                onAnimationComplete={() => { if (enteringPanes.current.delete(leaf.id)) rerender(); }}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
                style={
                  asCard
                    ? paneCardInset(leaf.rect)
                    : {
                        paddingLeft:
                          !unified && leaf.rect.x > PANE_BOUNDARY_EPSILON
                            ? 16
                            : undefined,
                        paddingTop:
                          !unified && leaf.rect.y > PANE_BOUNDARY_EPSILON
                            ? 16
                            : undefined,
                      }
                }
              >
                <PaneCardFrame
                  card={asCard}
                  focused={focusedId === leaf.id}
                >
                {editorPane ? (
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <FilePane
                      pane={editorPane}
                      tabsLeading={
                        reserveWindowNavigationSpace &&
                        !unified &&
                        chromeLeftId === editorPane.id
                          ? windowNavigationSpace
                          : undefined
                      }
                      visible={paneVisible}
                      focused={paneVisible && focusedId === editorPane.id}
                      showTabs={
                        !unified &&
                        (inSplit ||
                          editorPane.files.length > 1 ||
                          chromeRightId === editorPane.id)
                      }
                      tabsTrailing={cardTrailingFor(
                        editorPane.id,
                        asCard && hasOwnerSession,
                        maximized === editorPane.id,
                        chromeRightId === editorPane.id,
                      )}
                      dirtyFileIds={dirtyFileIds}
                      fileErrorCounts={fileErrorCounts}
                      sessions={sessions}
                      onFocus={onFocus}
                      onSelectFile={onSelectFile}
                      onCloseFile={onCloseFile}
                      onCloseOtherFiles={onCloseOtherFiles}
                      onPinFile={onPinFile}
                      onReorderFiles={onReorderFiles}
                      onDirtyChange={onFileDirtyChange}
                      onErrorCountChange={onFileErrorCountChange}
                      onClosePane={onClose}
                      onOpenTerminal={onOpenFileTerminal}
                      onFileMoved={onFileMoved}
                      onFileDeleted={onFileDeleted}
                      filesSearchOpen={filesSearchOpen}
                      onFilesSearchOpenChange={onFilesSearchOpenChange}
                      onOpenFile={onOpenFile}
                      onUpdatePlan={onUpdatePlan}
                      onBuildPlan={onBuildPlan}
                      editorNavigation={editorNavigation}
                      onTerminalMetaChange={onTerminalMetaChange}
                    />
                  </div>
                ) : session ? (
                  <SessionPane
                    session={session}
                    renderHeader={sessionHeaders.get(session.id)}
                    workspaceSwitchingSessionId={workspaceSwitchingSessionId}
                    reviewUndoLocked={sessions.some(
                      (other) =>
                        other.id !== session.id &&
                        other.busy &&
                        sameProjectPath(
                          sessionExecutionCwd(other),
                          sessionExecutionCwd(session),
                        ),
                    )}
                    visible={paneVisible}
                    focused={paneVisible && focusedId === session.id}
                    addToChatTarget={addToChatSessionId === session.id}
                    inSplit={inSplit && !unified}
                    composerFocused={paneVisible && composerFocused}
                    composerFocusToken={composerFocusToken}
                    recents={recents}
                    hideProjectPicker={hideProjectPicker}
                    onFocus={onFocus}
                    onClose={onClose}
                    onCwdChange={onCwdChange}
                    onBranchChange={onBranchChange}
                    onWorktreeChange={onWorktreeChange}
                    onRemoteSnapshot={onRemoteSnapshot}
                    onWorkspaceModeChange={onWorkspaceModeChange}
                    onWorktreeBaseChange={onWorktreeBaseChange}
                    onManageWorktrees={onManageWorktrees}
                    onModelChange={onModelChange}
                    onModelSettingsChange={onModelSettingsChange}
                    onRuntimeModeChange={onRuntimeModeChange}
                    onSaveDraft={onSaveDraft}
                    onRemoveDraft={onRemoveDraft}
                    onSubmit={onSubmit}
                    onStop={onStop}
                    onCompactContext={onCompactContext}
                    onDeleteQueuedMessage={onDeleteQueuedMessage}
                    onReorderQueuedMessage={onReorderQueuedMessage}
                    onSteerQueuedMessage={onSteerQueuedMessage}
                    onResumeQueue={onResumeQueue}
                    onUsageLimitResume={onUsageLimitResume}
                    onUsageLimitResumeAtReset={onUsageLimitResumeAtReset}
                    onUsageLimitDismiss={onUsageLimitDismiss}
                    onInboxCardDismiss={onInboxCardDismiss}
                    onLinkedWorkItemUpdateCardDismiss={
                      onLinkedWorkItemUpdateCardDismiss
                    }
                    onNoteCardDismiss={onNoteCardDismiss}
                    onHandoffCardDismiss={onHandoffCardDismiss}
                    onOpenLinkedWorkItem={onOpenLinkedWorkItem}
                    onArchiveSession={onArchiveSession}
                    onDeleteSession={onDeleteSession}
                    onApproval={onApproval}
                    onQuestionReply={onQuestionReply}
                    onQuestionInteraction={onQuestionInteraction}
                    onOpenFile={openSessionFileFor(session.id)}
                    onOpenDiff={onOpenDiff}
                    onOpenPlan={onOpenPlan}
                    onOpenBot={onOpenBot}
                    onBuildPlan={onBuildPlan}
                    onSecondOpinion={onSecondOpinion}
                    onHandoff={onHandoff}
                    onForkSession={onForkSession}
                    onBtwSubmit={onBtwSubmit}
                    onBtwRetry={onBtwRetry}
                    onBtwDelete={onBtwDelete}
                    onBtwStop={onBtwStop}
                    onBtwModelChange={onBtwModelChange}
                    transcriptPool={transcriptPool}
                  />
                ) : null}
                </PaneCardFrame>
              </motion.div>
            </SessionSurfacePane>
          );
        })}
        {!unified &&
          sashes.map((sash) => (
            <Sash
              key={`${sash.splitId}:${sash.index}`}
              sash={sash}
              layout={layout}
              sessionPaneIds={sessionPaneIds}
              visible={visible && parentVisible && !maximized}
              containerRef={treeRef}
              onStart={() => {
                gridControls.stop();
                draft.current = layoutRef.current;
                releaseGridMotion.current?.();
                releaseGridMotion.current = undefined;
                gridMoving.current = false;
              }}
              onPreview={(ratio) => {
                draft.current = setSplitRatio(
                  layoutRef.current,
                  sash.splitId,
                  sash.index,
                  ratio,
                );
                paintLayout(draft.current);
              }}
              onCommit={(ratio) => {
                if (draft.current) paintLayout(draft.current, true);
                onRatio(sash.splitId, sash.index, ratio);
              }}
              onCancel={() => {
                draft.current = null;
                paintLayout(layoutRef.current, true);
              }}
            />
          ))}
        {visible && !terminalDockOpen() && <TerminalDockTarget className="absolute inset-x-0 bottom-0 z-40 h-14" />}
      </motion.div>
    </div>
  );
}

export const PaneTree = memo(
  PaneTreeComponent,
  (previous, next) => !previous.visible && !next.visible,
);

type PaneEnterFrom = "left" | "right" | "top" | "bottom" | "fade";

function paneEnterFrom({ rect, axis }: LayoutLeaf): PaneEnterFrom {
  const edge = 0.001;
  if (axis === "x") {
    if (rect.x + rect.w >= 1 - edge) return "right";
    if (rect.x <= edge) return "left";
  } else {
    if (rect.y + rect.h >= 1 - edge) return "bottom";
    if (rect.y <= edge) return "top";
  }
  return "fade";
}

// Desktop themes can set their panel rhythm without changing split ratios or
// the stable tracks used by collapsed editor and terminal panes.
function paneBackgroundStyle(
  rect: LayoutLeaf["rect"],
  unified = false,
): CSSProperties {
  return {
    "--chat-background-left": `${unified ? 0 : (-rect.x / rect.w) * 100}%`,
    "--chat-background-top": `${unified ? 0 : (-rect.y / rect.h) * 100}%`,
    "--chat-background-width": `${unified ? 100 : 100 / rect.w}%`,
    "--chat-background-height": `${unified ? 100 : 100 / rect.h}%`,
  } as CSSProperties;
}

/** Anchor the outer right edge when minimum widths overlap in a narrow window. */
function panePositionStyle(rect: LayoutLeaf["rect"]): CSSProperties {
  const right = rect.x > PANE_BOUNDARY_EPSILON && rect.x + rect.w > 1 - PANE_BOUNDARY_EPSILON;
  return {
    left: right ? "auto" : `${rect.x * 100}%`,
    right: right ? 0 : "auto",
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

function sashStyle(sash: LayoutSash): CSSProperties {
  return { left: `${sash.group.x * 100}%`, top: `${sash.group.y * 100}%`,
    width: `${sash.group.w * 100}%`, height: `${sash.group.h * 100}%` };
}

function writeLayoutStyle(element: HTMLElement, values: CSSProperties | undefined) {
  if (!values) return;
  for (const [property, value] of Object.entries(values)) {
    const name = property.startsWith("--") ? property : property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    const text = value == null ? "" : String(value);
    if (element.style.getPropertyValue(name) !== text) element.style.setProperty(name, text);
  }
}

/** Resize only the layout DOM; editors, diffs, chat and their providers stay mounted. */
function paintPaneLayout(
  container: HTMLElement,
  tree: LayoutNode,
  grid: boolean,
  selectedId?: string,
  unified = false,
) {
  const leaves = layoutLeaves(tree);
  const panes = new Map(leaves.map((leaf) => [leaf.id, leaf]));
  const sashes = new Map(
    layoutSashes(tree).map((sash) => [`${sash.splitId}:${sash.index}`, sash]),
  );
  const surface = grid ? sessionSurfaceGrid(leaves, selectedId) : undefined;
  if (surface) writeLayoutStyle(container, surface.style);
  // Direct children only: embedded surfaces can contain their own splitters.
  for (const element of container.children) {
    if (!(element instanceof HTMLElement)) continue;
    const pane = panes.get(element.dataset.paneId ?? "");
    if (pane) {
      writeLayoutStyle(element, paneBackgroundStyle(pane.rect, unified));
      writeLayoutStyle(
        element,
        surface
          ? surface.placements.get(pane.id)
          : panePositionStyle(pane.rect),
      );
    }
    const sash = sashes.get(element.dataset.paneSashGroup ?? "");
    if (sash) {
      writeLayoutStyle(element, sashStyle(sash));
    }
  }
  return surface;
}

function paneMinimumSizes(element: HTMLElement) {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: number) => parseFloat(styles.getPropertyValue(name)) || fallback;
  return {
    chat: read("--desktop-conversation-min-width", 420),
    compactChat: read("--desktop-conversation-compact-min-width", 240),
    tool: read("--desktop-pane-min-width", 280),
  };
}

function Sash({
  sash,
  layout,
  sessionPaneIds,
  visible: allowed,
  containerRef,
  onStart,
  onPreview,
  onCommit,
  onCancel,
}: {
  sash: LayoutSash;
  layout: LayoutNode;
  sessionPaneIds: string;
  visible: boolean;
  containerRef: { current: HTMLDivElement | null };
  onStart: () => void;
  onPreview: (ratio: number) => void;
  onCommit: (ratio: number) => void;
  onCancel: () => void;
}) {
  const active = useActiveDragPayload();
  const visible = allowed && active?.type !== "workspace-pane";
  const { t } = useTranslation();
  const row = sash.dir === "right";
  const boundary = sash.sizes.slice(0, sash.index + 1).reduce((sum, size) => sum + size, 0);
  const beforeId = `${sash.splitId}:${sash.index}:before`, afterId = `${sash.splitId}:${sash.index}:after`;
  const bounded = (value: number) => splitSizesAtBoundary(sash.sizes, sash.index, value)
    .slice(0, sash.index + 1).reduce((sum, size) => sum + size, 0);
  const modelBounds = { min: bounded(-Infinity), max: bounded(Infinity) };
  const api = useRef<GroupImperativeHandle | null>(null);
  const groupElement = useRef<HTMLDivElement | null>(null);
  const resizing = useRef(false);
  const priorTransition = useRef("");
  const [bounds, setBounds] = useState(modelBounds);
  const pending = useRef(boundary);
  const callbacks = useRef({ onStart, onPreview, onCommit, onCancel });
  callbacks.current = { onStart, onPreview, onCommit, onCancel };
  useLayoutEffect(() => {
    // The enclosing ref attaches after child layout effects on the first mount.
    const parent = containerRef.current ?? groupElement.current?.parentElement;
    if (!parent) return;
    const measure = (width: number) => {
      if (resizing.current) return;
      const chats = new Set(sessionPaneIds.split("\n"));
      const next = paneWidthBounds(layout, sash, width, paneMinimumWidths(layout, chats, width, paneMinimumSizes(parent))) ?? modelBounds;
      setBounds(previous => previous.min === next.min && previous.max === next.max ? previous : next);
    };
    measure(parent.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => { if (entries[0]) measure(entries[0].contentRect.width); });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [layout, sash, sessionPaneIds, containerRef]);
  useLayoutEffect(() => {
    if (!resizing.current) api.current?.setLayout({ [beforeId]: boundary * 100, [afterId]: (1 - boundary) * 100 });
  }, [boundary]);
  return <ResizablePanelGroup data-pane-sash-group={`${sash.splitId}:${sash.index}`} groupRef={api} elementRef={groupElement}
    className="absolute z-10 pointer-events-none" style={sashStyle(sash)}
    orientation={row ? "horizontal" : "vertical"} disabled={!visible}
    onResizeStart={() => {
      resizing.current = true;
      pending.current = boundary;
      const parent = containerRef.current;
      if (parent) { priorTransition.current = parent.style.transitionProperty; parent.style.transitionProperty = "none"; }
      callbacks.current.onStart();
    }}
    onLayoutChange={next => {
      const ratio = next[beforeId] / 100;
      if (!resizing.current || ratio === pending.current) return;
      pending.current = ratio;
      callbacks.current.onPreview(ratio);
    }}
    onLayoutChanged={(next, meta) => {
      if (!meta.isUserInteraction) return;
      callbacks.current.onPreview(next[beforeId] / 100);
      callbacks.current.onCommit(next[beforeId] / 100);
    }}
    onResizeEnd={committed => {
      resizing.current = false;
      if (!committed) callbacks.current.onCancel();
      if (containerRef.current) containerRef.current.style.transitionProperty = priorTransition.current;
    }}>
    <ResizablePanel id={beforeId} defaultSize={`${boundary * 100}%`} minSize={`${bounds.min * 100}%`} maxSize={`${bounds.max * 100}%`} />
    <ResizableHandle data-pane-sash={`${sash.splitId}:${sash.index}`} aria-label={t("Resize pane")} className="pointer-events-auto !w-px aria-[orientation=horizontal]:!h-px aria-[orientation=horizontal]:!w-full" />
    <ResizablePanel id={afterId} minSize={0} />
  </ResizablePanelGroup>;
}

function CardMaximizeButton({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = maximized ? t("Restore") : t("Maximize");
  return (
    <Button variant="ghost" size="content"
      type="button"
      data-card-maximize
      data-tauri-drag-region="false"
      aria-label={label}
      aria-pressed={maximized}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onToggle}
      className={cn("mr-1 grid size-7 shrink-0 self-center place-items-center rounded-md hover:bg-content/3 hover:text-content", maximized ? "bg-content/8 text-content" : "text-content/55")}
    >
      <Maximize2 className="size-3.5" />
    </Button>
  );
}

function paneEntrance(from: PaneEnterFrom): TargetAndTransition {
  return { opacity: 0, x: from === "left" ? -motionDistance.page : from === "right" ? motionDistance.page : 0, y: from === "top" ? -motionDistance.page : from === "bottom" ? motionDistance.page : 0 };
}
