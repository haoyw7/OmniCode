import { PresenceBoundary } from "../../shared/ui/PresenceBoundary";
import { usePreferenceState } from "../../features/settings/model/usePreferenceState";
import { delegateDesktopSession } from "../../features/bots/model/delegateDesktopSession";
import {
  sidebarDragPreview,
} from "./SidebarEntryReorder";
import { AnimatedCollapse } from "../../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../../shared/ui/SurfaceVisibility";
import { useListReorderMotion } from "../../shared/hooks/useListReorderMotion";
import { sessionRecencyAt } from "../../features/sessions/model/sessionActivity";
import {
  useAnimatedReorder,
} from "../../shared/hooks/useAnimatedReorder";
import { mergeOrderedSubset, orderByIds } from "../../shared/lib/reorder";
import { useTranslation } from "../../shared/i18n/useTranslation";
import {
  inWorktreeFocus,
  useWorktreeFocus,
} from "../../features/source-control/model/worktreeFocus";
import {
  Clock,
  Pin,
} from "../../shared/ui/icons";
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { copyText } from "../../platform/tauri/clipboard";
import {
  sessionDisplayTitle,
} from "../../features/sessions/model/session";
import { nextUnseenFinishedSessions } from "../../features/sessions/model/sessionDone";
import {
  orderedSessionActionIds,
  pruneSessionSelection,
  toggleSessionSelection,
} from "../../features/sessions/model/sessionSelection";
import type { PaneEdge } from "../../features/workspace/model/layout";
import {
  compareSessionSummaries,
  filterSessionsByArchive,
  mergeLiveSessionSummaries,
} from "../../features/sessions/data/sessionHistory";
import {
  buildSessionList,
  loadPinnedSessionsCollapsed,
  loadReminderSessionsCollapsed,
  savePinnedSessionsCollapsed,
  saveReminderSessionsCollapsed,
  loadSessionSidebarOrder,
  saveSessionSidebarOrder,
  sessionSidebarOrder,
  subscribeSessionSidebarOrder,
  sessionListNavigationIds,
  type SessionListEntry,
} from "../../features/sessions/model/sessionFolders";
import { LIST_PAGE_SIZE, listWindowSize } from "../../shared/lib/listWindow";
import {
  filterSessionsByHarness,
  filterSessionsByStatus,
  filterSessionsByTime,
  hasActiveSessionFilters,
  type SessionSidebarFilters,
} from "../../features/sessions/model/sessionFilters";
import type { LinkedWorkItem } from "../../features/sessions/model/session";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { isRemoteProjectPath } from "../../features/projects/model/recents";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../features/connections/files/ui/ExplorerMenu";
import { LinkSessionWorkItemDialog } from "../../features/sessions/ui/LinkSessionWorkItemDialog";
import { sessionReminderPresets } from "../../features/sessions/ui/sessionReminderPresets";
import {
  formatReminderTime,
  reminderTime,
} from "../../features/sessions/model/sessionReminders";
import { SessionsEmpty } from "../../features/sessions/ui/SessionsEmpty";
import {
  refreshRemoteProjectSessions,
  remoteRequest,
  remoteSessionFor,
  remoteSessionResolver,
  useRemoteProjectSessions,
} from "../../features/connections/model/connections";
import { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import { prefetchRemoteSession } from "../../features/connections/ui/RemoteSession";
import type { SidebarProps } from "./Sidebar.types";
import { sameProjectPath } from "../../features/projects/model/recents";
import { pathKey } from "../../shared/lib/paths";
import { useNow } from "../../shared/hooks/useNow";
import { SessionGroupPreview, SessionGroupRow, type SessionInsertMotion, SessionListItem } from "./sessions/SessionGroupRows";
import { SessionRenameRow } from "./sessions/SessionRenameRow";
import { SessionCard } from "./sessions/SessionCard";

type ProjectSessionSectionProps = SidebarProps & {
  unreadSessionIds?: ReadonlySet<string>;
  searchQuery: string;
  shortcutId?: string;
  projectLabel?: string;
  flatPins?: boolean;
  searchActive?: boolean;
  pollRemote?: boolean;
  sessionFilters: SessionSidebarFilters;
  complete: boolean;
  activeProject?: boolean;
  dense?: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onRetry?: () => void;
  onClearQuery?: () => void;
};
const REMINDERS_COLOR = "#f59e0b";
const PROJECT_SESSION_SELECTION = "omnicode:project-session-selection";

/** Initial preview and each "Show more" step in a project tree. */
const TREE_PREVIEW_COUNT = 5;

function ProjectSessionSectionComponent({
  cwd,
  sessions,
  busySessionIds,
  approvalSessionIds,
  questionSessionIds,
  activeSessionId,
  openSessions = [],
  status,
  pending,
  onSelectSession: onSelectLocalSession,
  onSelectRemoteSession,
  onRemoteSessionDeleted,
  onSessionNavigationOrder,
  onPrefetchSession: onPrefetchLocalSession,
  onPlaceSessionOnPane: onPlaceLocalSessionOnPane,
  onRenameSession: onRenameLocalSession,
  onArchiveSession: onArchiveLocalSession,
  onArchiveSessions: onArchiveLocalSessions,
  onPinSession: onPinLocalSession,
  onPinSessions: onPinLocalSessions,
  onSetSessionLinkedWorkItem: onSetLocalSessionLinkedWorkItem,
  reminders = [],
  onSetReminders,
  onCancelReminders,
  onDeleteSession: onDeleteLocalSession,
  onDeleteSessions: onDeleteLocalSessions,
  tab,
  onOpenInboxItem,
  unseenFinishedIds: unseenFinishedIdsProp,
  unreadSessionIds,
  linkedSessionUpdateIds = new Set(),
  searchQuery,
  searchActive = false,
  pollRemote = true,
  sessionFilters,
  activeProject = true,
  dense = true,
  shortcutId,
  projectLabel,
  flatPins = false,
  scrollRef,
  onRetry,
}: ProjectSessionSectionProps) {
  const { t: uiT } = useTranslation();
  const sectionVisible = useSurfaceVisibility();
  const remoteProject = isRemoteProjectPath(cwd) || !!remoteProjectFor(cwd);
  const remote = useRemoteProjectSessions(cwd, remoteProject && pollRemote);
  const hostProject = remoteProject ? remoteProjectFor(cwd) : undefined;
  // Pinned and recent rows render one section per conversation. Scope each to
  // its own row up front so hundreds of rows do not each re-filter and re-sort
  // the whole project on every sidebar render.
  const remoteRows = useMemo(
    () =>
      shortcutId
        ? remote.sessions.filter((session) => session.id === shortcutId)
        : remote.sessions,
    [remote.sessions, shortcutId],
  );
  const scopedSessions = useMemo(
    () =>
      shortcutId
        ? sessions.filter((session) => session.id === shortcutId)
        : sessions,
    [sessions, shortcutId],
  );
  const remoteChange = async (
    sessionId: string,
    patch: {
      title?: string;
      archived?: boolean;
      pinned?: boolean;
      linkedWorkItem?: LinkedWorkItem | null;
    },
  ) => {
    if (!remote.machine || !hostProject) {
      window.alert("Connect this project's machine to change its sessions.");
      return;
    }
    try {
      await remoteRequest(remote.machine.id, "sessions.update", {
        projectId: hostProject.projectId,
        sessionId,
        ...patch,
      });
      refreshRemoteProjectSessions();
    } catch (error) {
      window.alert(`Could not update this session.\n\n${String(error)}`);
    }
  };
  const remoteDelete = async (sessionIds: readonly string[]) => {
    if (sessionIds.length === 0) return;
    if (!remote.machine || !hostProject) {
      window.alert("Connect this project's machine to delete its sessions.");
      return;
    }
    if (
      !window.confirm(
        `Delete ${sessionIds.length === 1 ? "this conversation" : `${sessionIds.length} conversations`}? This can’t be undone.`,
      )
    )
      return;
    try {
      for (const sessionId of sessionIds) {
        await remoteRequest(remote.machine.id, "sessions.delete", {
          projectId: hostProject.projectId,
          sessionId,
        });
        onRemoteSessionDeleted?.(sessionId, cwd);
      }
      refreshRemoteProjectSessions();
    } catch (error) {
      window.alert(`Could not delete this session.\n\n${String(error)}`);
      refreshRemoteProjectSessions();
    }
  };
  // Host rows that are already open (or native) are local sessions; the rest
  // open through a local shell bound to their Host session.
  const opensLocally = (sessionId: string) =>
    (hostProject?.local &&
      remote.sessions.find((row) => row.id === sessionId)?.nativeSession) ||
    openSessions.some(
      (row) => row.id === sessionId && sameProjectPath(row.cwd, cwd),
    );
  const onSelectSession = remoteProject
    ? (sessionId: string) =>
        opensLocally(sessionId)
          ? onSelectLocalSession?.(sessionId)
          : onSelectRemoteSession?.(cwd, sessionId)
    : onSelectLocalSession;
  const onPrefetchSession = remoteProject
    ? (sessionId: string) => {
        if (opensLocally(sessionId)) onPrefetchLocalSession?.(sessionId);
        else if (remote.machine)
          prefetchRemoteSession(remote.machine.id, sessionId);
      }
    : onPrefetchLocalSession;
  const onPlaceSessionOnPane =
    remoteProject && onPlaceLocalSessionOnPane
      ? (sessionId: string, targetId: string, edge: PaneEdge) =>
          opensLocally(sessionId)
            ? onPlaceLocalSessionOnPane(sessionId, targetId, edge)
            : onPlaceLocalSessionOnPane(sessionId, targetId, edge, cwd)
      : onPlaceLocalSessionOnPane;
  const onRenameSession = remoteProject
    ? (sessionId: string, title: string) => {
        void remoteChange(sessionId, { title });
      }
    : onRenameLocalSession;
  const onArchiveSession = remoteProject
    ? (sessionId: string, archived: boolean) => {
        void remoteChange(sessionId, { archived });
      }
    : onArchiveLocalSession;
  const onArchiveSessions = remoteProject
    ? (sessionIds: readonly string[], archived: boolean) => {
        void Promise.all(
          sessionIds.map((id) => remoteChange(id, { archived })),
        );
      }
    : onArchiveLocalSessions;
  const onPinSession = remoteProject
    ? (sessionId: string, pinned: boolean) => {
        void remoteChange(sessionId, { pinned });
      }
    : onPinLocalSession;
  const onPinSessions = remoteProject
    ? (sessionIds: readonly string[], pinned: boolean) => {
        void Promise.all(sessionIds.map((id) => remoteChange(id, { pinned })));
      }
    : onPinLocalSessions;
  const onDeleteSession = remoteProject
    ? (sessionId: string) => {
        void remoteDelete([sessionId]);
      }
    : onDeleteLocalSession;
  const onDeleteSessions = remoteProject
    ? (sessionIds: readonly string[]) => {
        void remoteDelete(sessionIds);
      }
    : onDeleteLocalSessions;
  const onSetSessionLinkedWorkItem = remoteProject
    ? (sessionId: string, item: LinkedWorkItem | undefined) => {
        void remoteChange(sessionId, { linkedWorkItem: item ?? null });
      }
    : onSetLocalSessionLinkedWorkItem;
  const activeRemoteId = activeSessionId
    ? (remoteSessionFor(activeSessionId) ??
      (remoteRows.some(
        (session) => session.id === activeSessionId && session.nativeSession,
      )
        ? activeSessionId
        : undefined))
    : undefined;
  const activeListedSessionId = remoteProject
    ? activeRemoteId
    : activeSessionId;
  const listedBusySessionIds = remoteProject
    ? new Set(
        remoteRows
          .filter(
            (session) => session.status === "running" && !session.needsInput,
          )
          .map((session) => session.id),
      )
    : busySessionIds;
  const listedApprovalSessionIds = remoteProject
    ? new Set(
        remoteRows
          .filter((session) => session.needsInput)
          .map((session) => session.id),
      )
    : approvalSessionIds;
  // Older Hosts report only needsInput; keep that wait generic rather than
  // mislabeling a question as an approval.
  const listedQuestionSessionIds = remoteProject
    ? new Set(
        remoteRows
          .filter(
            (session) =>
              session.needsInput &&
              (!session.pendingInputKey ||
                /(?:^|[:,])question:/.test(session.pendingInputKey)),
          )
          .map((session) => session.id),
      )
    : questionSessionIds;
  const projectSessions: SessionSummary[] = useMemo(
    () =>
      remoteProject
        ? remoteRows.map((session) => ({
            id: session.id,
            cwd,
            harness: session.harness,
            model: session.model ?? "",
            runtimeMode: session.runtimeMode ?? "supervised",
            providerSessionId: session.providerSessionId ?? undefined,
            title: session.title,
            createdAt: session.createdAt ?? session.updatedAt,
            updatedAt: session.updatedAt,
            activityAt: sessionRecencyAt(session),
            archived: session.archived,
            pinned: session.pinned,
            remoteControl: session.remoteControl,
            remoteControlDevice: session.remoteControlDevice,
            linkedWorkItem: session.linkedWorkItem,
            draft: session.draft,
            repo: session.repo,
            branch: session.branch,
            executionCwd: session.executionCwd,
            linkedWorktree: session.linkedWorktree,
            nativeSession: session.nativeSession,
          }))
        : scopedSessions,
    [remoteProject, remoteRows, scopedSessions, cwd],
  );
  const now = useNow(30_000, tab === "sessions");
  const sectionRef = useRef<HTMLDivElement>(null);
  const localScrollRef = useRef<HTMLDivElement>(null);
  const sessionsScrollRef = scrollRef ?? localScrollRef;
  // A single-row shortcut has nothing to order, so it skips the shared store.
  const [savedSessionOrder, setSavedSessionOrder] = useState(() => ({
    cwd,
    ids: shortcutId ? [] : loadSessionSidebarOrder(cwd),
  }));
  const manualSessionOrder =
    savedSessionOrder.cwd === cwd
      ? savedSessionOrder.ids
      : shortcutId
        ? []
        : loadSessionSidebarOrder(cwd);
  useEffect(() => {
    if (shortcutId) return;
    const load = () =>
      setSavedSessionOrder({ cwd, ids: loadSessionSidebarOrder(cwd) });
    load();
    return subscribeSessionSidebarOrder(cwd, load);
  }, [cwd, shortcutId]);
  const [sessionMenu, setSessionMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const [linkingSession, setLinkingSession] = useState<SessionSummary | null>(
    null,
  );
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const contextSelectionRef = useRef(false);
  const selectionAnchorRef = useRef<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const [pinnedSessionsCollapsed, setPinnedSessionsCollapsed] = usePreferenceState(() =>
    loadPinnedSessionsCollapsed(cwd),
  );
  const [reminderSessionsCollapsed, setReminderSessionsCollapsed] = usePreferenceState(
    () => loadReminderSessionsCollapsed(cwd),
  );
  const [sessionListLimit, setSessionListLimit] = useState(LIST_PAGE_SIZE);
  const [treeSessionLimit, setTreeSessionLimit] = useState(TREE_PREVIEW_COUNT);
  const treeSessionWindow = useRef({ key: "", count: 0 });
  const loadMoreRef = useRef<HTMLLIElement>(null);
  const busyIdsRef = useRef(busySessionIds);
  const focusedSessionIdRef = useRef(activeSessionId);
  const unseenFinishedLocalRef = useRef<Set<string>>(new Set());
  if (
    busyIdsRef.current !== busySessionIds ||
    focusedSessionIdRef.current !== activeSessionId
  ) {
    unseenFinishedLocalRef.current = nextUnseenFinishedSessions({
      previousBusyIds: busyIdsRef.current,
      busyIds: busySessionIds,
      previousUnseenIds: unseenFinishedLocalRef.current,
      focusedSessionId: activeSessionId,
    });
    busyIdsRef.current = busySessionIds;
    focusedSessionIdRef.current = activeSessionId;
  }
  const unseenFinishedIds =
    unseenFinishedIdsProp ?? unseenFinishedLocalRef.current;
  // Revisits render straight from cache, so this is only ever true the first
  // time a project is opened.
  const pendingFirstLoad = remoteProject
    ? remote.pending && projectSessions.length === 0
    : pending && status !== "error" && sessions.length === 0;
  const worktreeFocus = useWorktreeFocus(cwd);
  const focusedWorktree = remoteProject ? undefined : worktreeFocus;
  const projectOpenSessions = openSessions.filter((session) =>
    sameProjectPath(session.cwd, cwd),
  );
  const hostSessionFor = remoteProject ? remoteSessionResolver() : undefined;
  const listedOpenSessions = (
    hostSessionFor
      ? projectOpenSessions.map((session) => {
          const hostId = hostSessionFor(session.id);
          return hostId ? { ...session, id: hostId } : session;
        })
      : projectOpenSessions
  ).filter((session) => !shortcutId || session.id === shortcutId);
  const listedSessions = mergeLiveSessionSummaries(
    projectSessions,
    listedOpenSessions,
  ).filter(
    (session) =>
      !session.orchestrationLeadId &&
      !session.workflowParentId &&
      (!flatPins || !!shortcutId || !session.pinned) &&
      (shortcutId || searchActive || inWorktreeFocus(session, focusedWorktree)),
  );
  const filteredSessions = [
    ...filterSessionsByStatus(
      filterSessionsByTime(
        filterSessionsByHarness(
          filterSessionsByArchive(listedSessions, sessionFilters.showArchived),
          sessionFilters.hiddenHarnesses,
        ),
        sessionFilters.time,
        now,
      ),
      sessionFilters.status,
      listedBusySessionIds,
      listedApprovalSessionIds,
      unseenFinishedIds,
    ).filter(
      (session) =>
        !searchQuery.trim() ||
        sessionDisplayTitle(session.title, session.harness)
          .toLocaleLowerCase()
          .includes(searchQuery.trim().toLocaleLowerCase()),
    ),
  ].filter((session) => !shortcutId || session.id === shortcutId).sort(compareSessionSummaries);
  const visibleSessions = orderByIds(
    filteredSessions,
    sessionSidebarOrder(
      filteredSessions.map((session) => session.id),
      manualSessionOrder,
    ),
  );
  const filtersActive = hasActiveSessionFilters(sessionFilters);
  const searchNarrowed = searchActive || Boolean(searchQuery.trim());
  // Summaries for the whole project stay in `sessions` so filters still work.
  // Every group has its own five-row preview; search keeps its larger window.
  const reminderIds = new Set(reminders.map((reminder) => reminder.sessionId));
  const reminderGroup = {
    sessionIds: [...reminders]
      .sort((a, b) => a.dueAt - b.dueAt)
      .map((reminder) => reminder.sessionId),
    collapsed: reminderSessionsCollapsed,
  };
  const allUngrouped = visibleSessions.filter(
    (session) => !reminderIds.has(session.id),
  );
  const ungroupedVisible = flatPins
    ? allUngrouped
    : allUngrouped.filter((session) => !session.pinned);
  const activeUngroupedIndex = ungroupedVisible.findIndex(
    (session) => session.id === activeListedSessionId,
  );
  // Reveal five more chats per click, keeping other projects in view.
  const treePreview = !searchNarrowed;
  const previewUngroupedCount = listWindowSize(
    ungroupedVisible.length,
    TREE_PREVIEW_COUNT,
    -1,
    TREE_PREVIEW_COUNT,
  );
  const shownUngroupedCount = treePreview
    ? listWindowSize(
        ungroupedVisible.length,
        treeSessionLimit,
        -1,
        TREE_PREVIEW_COUNT,
      )
    : listWindowSize(
        ungroupedVisible.length,
        sessionListLimit,
        activeUngroupedIndex,
      );
  const shownUngrouped = ungroupedVisible.slice(0, shownUngroupedCount);
  const shownUngroupedIds = new Set(
    shownUngrouped.map((session) => session.id),
  );
  const sessionListKey = `${cwd}\0${searchActive}\0${sessionFilters.showArchived}\0${sessionFilters.time}\0${sessionFilters.hiddenHarnesses.join(",")}\0${sessionFilters.status.working}\0${sessionFilters.status.needsApproval}\0${sessionFilters.status.done}\0${searchQuery}`;
  if (treeSessionWindow.current.key !== sessionListKey)
    treeSessionWindow.current = { key: sessionListKey, count: 0 };
  // Keep revealed rows available for closing motion and prepare the next five
  // collapsed rows so their shared disclosure animates when they open.
  treeSessionWindow.current.count = treePreview
    ? Math.min(
        ungroupedVisible.length,
        Math.max(
          treeSessionWindow.current.count,
          shownUngroupedCount + TREE_PREVIEW_COUNT,
        ),
      )
    : 0;
  const mountedUngrouped = treePreview
    ? ungroupedVisible.slice(0, treeSessionWindow.current.count)
    : shownUngrouped;
  const fullSessionListEntries = buildSessionList(
    visibleSessions,
    [],
    allUngrouped,
    flatPins ? false : pinnedSessionsCollapsed,
    reminderGroup,
    flatPins,
  );
  const groupedSessionListEntries = buildSessionList(
    visibleSessions,
    [],
    flatPins
      ? mountedUngrouped
      : [
          ...allUngrouped.filter((session) => session.pinned),
          ...mountedUngrouped,
        ],
    pinnedSessionsCollapsed,
    reminderGroup,
    flatPins,
  );
  const sessionListEntries: SessionListEntry[] = groupedSessionListEntries;
  const sortableSessions = useAnimatedReorder(
    shortcutId || tab !== "sessions" || !sectionVisible
      ? []
      : sessionListEntries.flatMap((entry) =>
          entry.kind === "session" && shownUngroupedIds.has(entry.session.id)
            ? [entry.session.id]
            : [],
        ),
    (ids) => {
      const allIds = sessionSidebarOrder(
        [...listedSessions]
          .sort(compareSessionSummaries)
          .map((session) => session.id),
        manualSessionOrder,
      ).map((id) => ({ id }));
      const next = mergeOrderedSubset(
        allIds,
        ids.map((id) => ({ id })),
      ).map(({ id }) => id);
      saveSessionSidebarOrder(cwd, next);
      setSavedSessionOrder({ cwd, ids: next });
    },
    "y",
    undefined,
    { floatingPreview: sidebarDragPreview },
  );
  const sessionNavigationIds = sessionListNavigationIds(
    fullSessionListEntries,
    searchNarrowed,
  );
  const sessionNavigationKey = sessionNavigationIds.join("\0");
  // Activity re-sorts the list; rows slide to their new places instead of jumping.
  const sessionRowOrder = sessionListEntries.flatMap((entry) =>
    entry.kind === "session"
      ? [entry.session.id]
      : entry.kind === "folder"
        ? []
        : entry.sessions.map((session) => session.id),
  );
  // The drag already animated this move; do not replay it after committing.
  // Rows revealed by "Show more" open with their own disclosure.
  useListReorderMotion(
    sectionRef,
    sessionRowOrder,
    "data-session-row",
    !sortableSessions.draggingId,
    shownUngroupedCount,
  );
  useEffect(() => {
    if (activeProject && !shortcutId)
      onSessionNavigationOrder?.(sessionNavigationIds);
  }, [activeProject, shortcutId, onSessionNavigationOrder, sessionNavigationKey]);
  useEffect(() => {
    if (tab !== "sessions") {
      selectionAnchorRef.current = null;
      setSelectedSessionIds(new Set());
      return;
    }
    const available = new Set(sessionNavigationIds);
    if (
      selectionAnchorRef.current &&
      !available.has(selectionAnchorRef.current)
    ) {
      selectionAnchorRef.current = null;
    }
    setSelectedSessionIds((current) =>
      pruneSessionSelection(current, available),
    );
  }, [cwd, tab, sessionNavigationKey]);
  const hiddenSessions = shownUngroupedCount < ungroupedVisible.length;
  const hasMoreSessions = !treePreview && hiddenSessions;
  const treePreviewExpanded = shownUngroupedCount > previewUngroupedCount;
  const narrowedByUser = searchNarrowed || filtersActive;
  useEffect(() => {
    // Retained project/group content starts with five rows on its next opening.
    // Keep the mounted window intact so closing rows can finish their motion.
    setSessionListLimit(LIST_PAGE_SIZE);
    setTreeSessionLimit(TREE_PREVIEW_COUNT);
    // The shared project tree owns its scroll position.
  }, [sessionListKey, sectionVisible]);

  useEffect(() => {
    if (tab !== "sessions" || !hasMoreSessions) return;
    const sentinel = loadMoreRef.current;
    const root = sessionsScrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setSessionListLimit((current) => current + LIST_PAGE_SIZE);
      },
      { root, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [tab, hasMoreSessions, shownUngroupedCount]);

  useEffect(() => {
    setPinnedSessionsCollapsed(loadPinnedSessionsCollapsed(cwd));
    setReminderSessionsCollapsed(loadReminderSessionsCollapsed(cwd));
  }, [cwd]);

  useEffect(() => {
    if (!sessionMenu) return;
    const onScroll = () => {
      closeSessionMenu();
    };
    const scrollParent = sessionsScrollRef.current ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [sessionMenu]);

  useEffect(() => {
    if (selectedSessionIds.size === 0) return;
    const clear = () => {
      selectionAnchorRef.current = null;
      contextSelectionRef.current = false;
      setSelectedSessionIds(new Set());
      setSessionMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        !activeProject &&
        !(
          event.target instanceof Node &&
          sectionRef.current?.contains(event.target)
        )
      )
        return;
      clear();
    };
    // A pointer landing off the cards drops the selection; a menu acting on
    // it stays open, and the cards handle their own clicks.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const el = target instanceof Element ? target : null;
      if (el?.closest("[data-popover-side]")) return;
      if (
        el &&
        sectionRef.current?.contains(el) &&
        el.closest("[data-session-card]")
      )
        return;
      clear();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selectedSessionIds.size, activeProject]);

  useEffect(() => {
    const onOtherProjectSelection = (event: Event) => {
      if ((event as CustomEvent<string>).detail === pathKey(cwd)) return;
      selectionAnchorRef.current = null;
      contextSelectionRef.current = false;
      setSelectedSessionIds((current) => (current.size ? new Set() : current));
      setSessionMenu(null);
    };
    window.addEventListener(PROJECT_SESSION_SELECTION, onOtherProjectSelection);
    return () =>
      window.removeEventListener(
        PROJECT_SESSION_SELECTION,
        onOtherProjectSelection,
      );
  }, [cwd]);

  const announceProjectSelection = () =>
    window.dispatchEvent(
      new CustomEvent(PROJECT_SESSION_SELECTION, { detail: pathKey(cwd) }),
    );

  const menuSessionIds = sessionMenu
    ? orderedSessionActionIds(
        sessionMenu.sessionId,
        selectedSessionIds,
        sessionNavigationIds,
      )
    : [];
  const menuSessions = menuSessionIds.flatMap((sessionId) => {
    const session = listedSessions.find((entry) => entry.id === sessionId);
    return session ? [session] : [];
  });
  const multipleMenuSessions = menuSessionIds.length > 1;
  const menuReminderTimes = [
    ...new Set(
      reminders
        .filter((reminder) => menuSessionIds.includes(reminder.sessionId))
        .map((reminder) => reminder.dueAt),
    ),
  ];
  const allMenuSessionsPinned =
    menuSessions.length > 0 && menuSessions.every((session) => session.pinned);
  const allMenuSessionsArchived =
    menuSessions.length > 0 &&
    menuSessions.every((session) => session.archived);
  const sessionMenuItems: ExplorerMenuItem[] = [
    ...(!multipleMenuSessions && remoteProjectFor(cwd) ? [{
      kind: "item" as const,
      id: "delegate-assistant",
      label: uiT("Hand over to assistant"),
    }] : []),
    ...(onCancelReminders && menuReminderTimes.length > 0
      ? [
          {
            kind: "item" as const,
            id: "reminder:cancel",
            label: uiT("Cancel reminder"),
            description:
              menuReminderTimes.length === 1
                ? formatReminderTime(menuReminderTimes[0])
                : uiT("Multiple reminder times"),
          },
          { kind: "sep" as const },
        ]
      : []),
    ...(onPinSession || onPinSessions
      ? [
          {
            kind: "item" as const,
            id: "pin",
            label: allMenuSessionsPinned ? uiT("Unpin") : uiT("Pin"),
          },
        ]
      : []),
    ...(!multipleMenuSessions && onRenameSession
      ? [
          {
            kind: "item" as const,
            id: "rename",
            label: uiT("Rename"),
            shortcut: "F2",
          },
        ]
      : []),
    ...(!multipleMenuSessions
      ? [
          {
            kind: "item" as const,
            id: "copy-session-id",
            label: uiT("Copy session ID"),
            submenu: [
              {
                kind: "item" as const,
                id: "copy-harness-session-id",
                label: uiT("Harness session ID"),
                disabled: !menuSessions[0]?.providerSessionId,
              },
              {
                kind: "item" as const,
                id: "copy-omnicode-session-id",
                label: uiT("OmniCode session ID"),
              },
            ],
          },
        ]
      : []),
    ...(!multipleMenuSessions && onSetSessionLinkedWorkItem
      ? [
          {
            kind: "item" as const,
            id: "link-work-item",
            label: menuSessions[0]?.linkedWorkItem
              ? uiT("Edit GitHub issue or PR link…")
              : uiT("Link GitHub issue or PR…"),
          },
        ]
      : []),
    {
      kind: "item",
      id: "reminder",
      label: uiT("Remind me"),
      disabled: !onSetReminders,
      submenu: sessionReminderPresets(),
    },
    ...(onArchiveSession ||
    onArchiveSessions ||
    onDeleteSession ||
    onDeleteSessions
      ? [
          { kind: "sep" as const },
          ...(onArchiveSession || onArchiveSessions
            ? [
                {
                  kind: "item" as const,
                  id: "archive",
                  label: allMenuSessionsArchived
                    ? uiT("Unarchive")
                    : uiT("Archive"),
                },
              ]
            : []),
          ...(onDeleteSession || onDeleteSessions
            ? [
                {
                  kind: "item" as const,
                  id: "delete",
                  label: uiT("Delete"),
                  shortcut: "⌫",
                  danger: true,
                },
              ]
            : []),
        ]
      : []),
  ];

  const openSessionMenu = (sessionId: string, x: number, y: number) => {
    announceProjectSelection();
    contextSelectionRef.current = !selectedSessionIds.has(sessionId);
    if (contextSelectionRef.current) {
      setSelectedSessionIds(new Set([sessionId]));
    }
    setSessionMenu({ x, y, sessionId });
  };
  const onSessionContextMenu = (
    sessionId: string,
    e: ReactMouseEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    openSessionMenu(sessionId, e.clientX, e.clientY);
  };

  const closeSessionMenu = () => {
    setSessionMenu(null);
    if (!contextSelectionRef.current) return;
    contextSelectionRef.current = false;
    selectionAnchorRef.current = null;
    setSelectedSessionIds(new Set());
  };

  const onSessionMenuPick = (id: string) => {
    if (!sessionMenu) return;
    const sessionId = sessionMenu.sessionId;
    const sessionIds = menuSessionIds;
    const providerSessionId = menuSessions[0]?.providerSessionId;
    const archived = allMenuSessionsArchived;
    const pinned = allMenuSessionsPinned;
    closeSessionMenu();
    if (id === "delegate-assistant") {
      void delegateDesktopSession(cwd, sessionId);
      return;
    }
    if (id === "reminder:cancel") {
      onCancelReminders?.(sessionIds);
      return;
    }
    if (id.startsWith("reminder:")) {
      const dueAt = reminderTime(id);
      if (dueAt != null) {
        setReminderSessionsCollapsed(false);
        saveReminderSessionsCollapsed(cwd, false);
        onSetReminders?.(sessionIds, dueAt);
      }
      return;
    }
    if (id === "pin") {
      if (sessionIds.length > 1 && onPinSessions) {
        onPinSessions(sessionIds, !pinned);
      } else {
        for (const id of sessionIds) onPinSession?.(id, !pinned);
      }
      return;
    }
    if (id === "rename") {
      setRenamingSessionId(sessionId);
      return;
    }
    if (id === "copy-harness-session-id" || id === "copy-omnicode-session-id") {
      const value =
        id === "copy-harness-session-id" ? providerSessionId : sessionId;
      if (value) {
        void copyText(value).catch((error) => {
          console.error("Failed to copy session ID:", error);
        });
      }
      return;
    }
    if (id === "link-work-item") {
      setLinkingSession(menuSessions[0] ?? null);
      return;
    }
    if (id === "archive") {
      if (sessionIds.length > 1 && onArchiveSessions) {
        onArchiveSessions(sessionIds, !archived);
      } else {
        for (const id of sessionIds) onArchiveSession?.(id, !archived);
      }
      return;
    }
    if (id === "delete") {
      if (sessionIds.length > 1 && onDeleteSessions) {
        onDeleteSessions(sessionIds);
      } else {
        for (const id of sessionIds) onDeleteSession?.(id);
      }
    }
  };

  const onSessionCardSelect = (
    sessionId: string,
    event: {
      shiftKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey?: boolean;
    },
  ) => {
    announceProjectSelection();
    contextSelectionRef.current = false;
    setSessionMenu(null);
    if (event.shiftKey) {
      const visibleIds = sessionListNavigationIds(
        sessionListEntries,
        searchNarrowed,
      );
      if (
        selectionAnchorRef.current &&
        !visibleIds.includes(selectionAnchorRef.current)
      ) {
        selectionAnchorRef.current = null;
      }
      const anchor =
        selectionAnchorRef.current ?? activeListedSessionId ?? sessionId;
      const start = visibleIds.indexOf(anchor);
      const end = visibleIds.indexOf(sessionId);
      const range =
        start < 0 || end < 0
          ? [sessionId]
          : visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
      selectionAnchorRef.current = start < 0 ? sessionId : anchor;
      setSelectedSessionIds(
        (current) =>
          new Set(
            event.ctrlKey || event.metaKey ? [...current, ...range] : range,
          ),
      );
      return;
    }
    selectionAnchorRef.current = sessionId;
    if (event.ctrlKey || event.metaKey) {
      const next = toggleSessionSelection(selectedSessionIds, sessionId);
      if (next.size === 0) selectionAnchorRef.current = null;
      setSelectedSessionIds(next);
      return;
    }
    setSelectedSessionIds(new Set());
    // Alt-click opens the chat in a new column beside the focused one.
    if (event.altKey && !remoteProject) {
      onSelectLocalSession(sessionId, undefined, { newColumn: true });
      return;
    }
    onSelectSession(sessionId);
  };

  // Cards are memoized. Their handlers go through one stable set that calls
  // the latest version, so a sidebar render no longer re-renders every card.
  const cardHandlers = useRef({
    onSessionCardSelect,
    onOpenInboxItem,
    onPrefetchSession,
    onPlaceSessionOnPane,
    onSessionContextMenu,
    openSessionMenu,
    onArchiveSession,
    onPinSession,
    onPinSessions,
    setRenamingSessionId,
    onDeleteSession,
  });
  cardHandlers.current = {
    onSessionCardSelect,
    onOpenInboxItem,
    onPrefetchSession,
    onPlaceSessionOnPane,
    onSessionContextMenu,
    openSessionMenu,
    onArchiveSession,
    onPinSession,
    onPinSessions,
    setRenamingSessionId,
    onDeleteSession,
  };
  const cardActions = useMemo(
    () => ({
      select: (
        sessionId: string,
        event: {
          shiftKey: boolean;
          ctrlKey: boolean;
          metaKey: boolean;
          altKey?: boolean;
        },
      ) => cardHandlers.current.onSessionCardSelect(sessionId, event),
      openWorkItem: (item: LinkedWorkItem, sessionId: string) =>
        cardHandlers.current.onOpenInboxItem?.(item, sessionId),
      prefetch: (sessionId: string) =>
        cardHandlers.current.onPrefetchSession?.(sessionId),
      placeOnPane: (sessionId: string, targetId: string, edge: PaneEdge) =>
        cardHandlers.current.onPlaceSessionOnPane?.(sessionId, targetId, edge),
      contextMenu: (sessionId: string, e: ReactMouseEvent<HTMLDivElement>) =>
        cardHandlers.current.onSessionContextMenu(sessionId, e),
      openMenu: (sessionId: string, x: number, y: number) =>
        cardHandlers.current.openSessionMenu(sessionId, x, y),
      archive: (sessionId: string, archived: boolean) =>
        cardHandlers.current.onArchiveSession?.(sessionId, archived),
      pin: (sessionId: string) => {
        if (cardHandlers.current.onPinSession)
          cardHandlers.current.onPinSession(sessionId, true);
        else cardHandlers.current.onPinSessions?.([sessionId], true);
      },
      rename: (sessionId: string) =>
        cardHandlers.current.setRenamingSessionId(sessionId),
      delete: (sessionId: string) =>
        cardHandlers.current.onDeleteSession?.(sessionId),
    }),
    [],
  );

  const sessionInsertMotion = useRef<SessionInsertMotion>({
    cwd: "",
    seen: new Set(),
  });
  // Runs after the rows' mount effects: a project's first paint never animates,
  // and rows that mount later (sidebar opened, group expanded) are not new.
  useLayoutEffect(() => {
    const motion = sessionInsertMotion.current;
    motion.cwd = cwd;
    for (const session of listedSessions) motion.seen.add(session.id);
  });

  const renderSessionCard = (session: SessionSummary, compact = false) =>
    renamingSessionId === session.id && onRenameSession ? (
      <SessionRenameRow
        session={session}
        projectLabel={projectLabel}
        isActive={session.id === activeListedSessionId}
        needsApproval={listedApprovalSessionIds.has(session.id)}
        dense={dense}
        compact={compact}
        onCommit={(title) => {
          onRenameSession(session.id, title);
          setRenamingSessionId(null);
        }}
        onCancel={() => setRenamingSessionId(null)}
      />
    ) : (
      <SessionCard
        session={session}
        projectLabel={projectLabel}
        isActive={session.id === activeListedSessionId}
        isSelected={selectedSessionIds.has(session.id)}
        busy={listedBusySessionIds.has(session.id)}
        done={unseenFinishedIds.has(session.id)}
        unread={!!unreadSessionIds?.has(session.id) || unseenFinishedIds.has(session.id)}
        linkedUpdate={linkedSessionUpdateIds.has(session.id)}
        waitingFor={
          listedApprovalSessionIds.has(session.id)
            ? listedQuestionSessionIds?.has(session.id) || session.orchestration
              ? "input"
              : "approval"
            : undefined
        }
        compact={compact}
        dense={dense}
        shortcut={!!shortcutId}
        plainTree={flatPins}
        now={now}
        onSelect={cardActions.select}
        onOpenWorkItem={
          onOpenInboxItem && !remoteProject
            ? cardActions.openWorkItem
            : undefined
        }
        onPrefetch={onPrefetchSession ? cardActions.prefetch : undefined}
        onPlaceOnPane={
          onPlaceSessionOnPane ? cardActions.placeOnPane : undefined
        }
        onContextMenu={cardActions.contextMenu}
        onOpenMenu={cardActions.openMenu}
        onArchive={onArchiveSession ? cardActions.archive : undefined}
        onPin={!session.pinned && (onPinSession || onPinSessions) ? cardActions.pin : undefined}
        onRename={onRenameSession ? cardActions.rename : undefined}
        onDelete={onDeleteSession ? cardActions.delete : undefined}
      />
    );

  return (
    <div ref={sectionRef} data-project-session-section={pathKey(cwd)}>
      {!shortcutId && (status === "error" || (remoteProject && remote.error)) &&
      projectSessions.length > 0 ? (
        <p role="status" className="px-3 py-1 text-[11px] text-foreground-subtle">
          {uiT("Couldn’t load sessions")}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="ml-2 text-accent"
            >
              {uiT("Retry")}
            </button>
          ) : null}
        </p>
      ) : null}
      {!shortcutId && remoteProject && remote.offline && projectSessions.length > 0 ? (
        <p role="status" className="px-3 py-1 text-[11px] text-foreground-subtle">
          {uiT("Offline — showing cached sessions")}
        </p>
      ) : null}
      {shortcutId ? (
        <div data-pinned-session-shortcut={shortcutId}>
          {visibleSessions.map((session) => (
            <Fragment key={session.id}>{renderSessionCard(session)}</Fragment>
          ))}
        </div>
      ) : !cwd || cwd === "~" ? (
        <p className="px-3 py-2 text-ui-sm text-foreground-subtle">
          {uiT("No project folder")}
        </p>
      ) : (
        <div>
          {/*
              A project's first load stays deliberately blank. The listing is
              served from a covering index and resolves within a frame or two,
              so a placeholder only ever flashed — reading as a glitch rather
              than as progress. This is checked before the empty state so that
              cannot claim "No sessions yet" before the rows have landed.
            */}
          {pendingFirstLoad ? (
            <p role="status" className="px-3 py-1 text-ui-sm text-foreground-subtle">
              {uiT("Loading sessions…")}
            </p>
          ) : (status === "error" || (remoteProject && remote.error)) &&
            projectSessions.length === 0 ? (
            <p className="px-3 py-2 text-ui-sm text-foreground-subtle">
              {uiT("Couldn’t load sessions")}
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="ml-2 text-accent"
                >
                  {uiT("Retry")}
                </button>
              ) : null}
            </p>
          ) : visibleSessions.length === 0 ? (
            // A narrowed-down result is a transient answer to what the user
            // just typed, so it stays a quiet line of text. Only the genuine
            // "this project has nothing in it" case earns the illustration.
            narrowedByUser ? (
              <p className="px-3 py-2 text-ui-sm text-foreground-subtle">
                {searchNarrowed
                  ? uiT("No matching sessions")
                  : uiT("No sessions match these filters")}
              </p>
            ) : remoteProject && remote.offline ? (
              <p className="px-3 py-2 text-ui-sm text-content/45">
                {uiT(
                  "This project’s machine isn’t connected on this computer.",
                )}
              </p>
            ) : (
              <SessionsEmpty
                message={uiT("Sessions you start will show up here")}
              />
            )
          ) : (
            <ul
              data-session-list
              className={`flex flex-col ${dense ? "w-full gap-px px-0 py-px" : "gap-px px-1 pb-1"}`}
            >
              {sessionListEntries.map((entry, index) => {
                if (entry.kind === "pinned" || entry.kind === "reminders") {
                  const isReminders = entry.kind === "reminders";
                  const expanded = searchNarrowed || !entry.collapsed;
                  const beforeUngrouped =
                    sessionListEntries[index + 1]?.kind === "session";
                  return (
                    <li
                      key={`${entry.kind}-sessions`}
                      data-pinned-sessions={isReminders ? undefined : ""}
                      data-reminder-sessions={isReminders ? "" : undefined}
                      className={`relative ${
                        !dense && (expanded || beforeUngrouped) ? "mb-1.5" : ""
                      }`}
                    >
                      <div className="overflow-hidden rounded-lg bg-content/5">
                        <SessionGroupRow
                          dense={dense}
                          label={isReminders ? uiT("Reminders") : uiT("Pinned")}
                          accent={isReminders ? REMINDERS_COLOR : undefined}
                          sessions={entry.sessions}
                          expanded={expanded}
                          busy={entry.sessions.some((session) =>
                            listedBusySessionIds.has(session.id),
                          )}
                          done={entry.sessions.some((session) =>
                            unseenFinishedIds.has(session.id),
                          )}
                          needsApproval={entry.sessions.some((session) =>
                            listedApprovalSessionIds.has(session.id),
                          )}
                          groupIcon={
                            isReminders ? (
                              <Clock className="size-3.5" />
                            ) : (
                              <Pin
                                className="size-3.5 text-content"
                              />
                            )
                          }
                          onToggle={() => {
                            if (searchNarrowed) return;
                            const collapsed = !entry.collapsed;
                            if (isReminders) {
                              setReminderSessionsCollapsed(collapsed);
                              saveReminderSessionsCollapsed(cwd, collapsed);
                              return;
                            }
                            setPinnedSessionsCollapsed(collapsed);
                            savePinnedSessionsCollapsed(cwd, collapsed);
                          }}
                        />
                        <AnimatedCollapse expanded={expanded} keepMounted>
                          <ul
                            className={`flex flex-col ${dense ? "w-full gap-px px-0 pt-px" : "gap-px p-1"}`}
                          >
                            <SessionGroupPreview
                              sessions={entry.sessions}
                              resetKey={sessionListKey}
                              searchActive={searchNarrowed}
                              cwd={cwd}
                              motion={sessionInsertMotion}
                              renderCard={(session) => renderSessionCard(session, true)}
                            />
                          </ul>
                        </AnimatedCollapse>
                      </div>
                    </li>
                  );
                }
                if (entry.kind === "folder") return null;
                return (
                  <SessionListItem
                    key={entry.session.id}
                    session={entry.session}
                    cwd={cwd}
                    motion={sessionInsertMotion}
                    sortable={sortableSessions}
                    expanded={
                      treePreview
                        ? shownUngroupedIds.has(entry.session.id)
                        : undefined
                    }
                  >
                    {renderSessionCard(entry.session)}
                  </SessionListItem>
                );
              })}
              {hasMoreSessions ? (
                <li ref={loadMoreRef} aria-hidden className="h-px list-none" />
              ) : null}
              {treePreview && (hiddenSessions || treePreviewExpanded) ? (
                <li className="list-none">
                  <button
                    type="button"
                    data-session-list-toggle
                    data-tauri-drag-region="false"
                    aria-expanded={treePreviewExpanded}
                    onClick={() =>
                      setTreeSessionLimit(
                        hiddenSessions
                          ? shownUngroupedCount + TREE_PREVIEW_COUNT
                          : TREE_PREVIEW_COUNT,
                      )
                    }
                    className="flex h-8 w-full items-center rounded-lg pl-8 pr-2 text-left text-ui-caption text-content/45 hover:bg-surface-hover hover:text-content"
                  >
                    {hiddenSessions ? uiT("Show more") : uiT("Show less")}
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      )}{" "}
      <PresenceBoundary propagate>{sessionMenu ? (
        <ExplorerMenu
          x={sessionMenu.x}
          y={sessionMenu.y}
          items={sessionMenuItems}
          ariaLabel={
            multipleMenuSessions
              ? uiT("{value0} selected session actions", {
                  value0: String(menuSessionIds.length),
                })
              : uiT("Session actions")
          }
          onPick={onSessionMenuPick}
          onClose={closeSessionMenu}
        />
      ) : null}</PresenceBoundary>
      <PresenceBoundary>{linkingSession ? (
        <LinkSessionWorkItemDialog
          initial={linkingSession.linkedWorkItem}
          sessionTitle={sessionDisplayTitle(
            linkingSession.title,
            linkingSession.harness,
          )}
          onSave={(item) => {
            onSetSessionLinkedWorkItem?.(linkingSession.id, item);
            setLinkingSession(null);
          }}
          onClose={() => setLinkingSession(null)}
        />
      ) : null}</PresenceBoundary>
    </div>
  );
}

export const ProjectSessionSection = memo(ProjectSessionSectionComponent);
