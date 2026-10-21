import { supportsProjectTerminal } from "../../features/terminal/model/terminalAvailability";
import { useQuickOpenMode } from "../../features/search/model/useQuickOpenMode";
import { parseQuickOpenQuery } from "../../features/search/model/quickOpen";
import { forkSession } from "../../features/sessions/model/forkSession";
import { useStore } from "zustand";
import { createWorkspaceUiStore } from "../model/workspaceUiStore";
import { resolveBotOrigin } from "../../features/bots/model/botOrigin";
import { selectBotThread } from "../../features/bots/model/botSelection";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { prefetchProjectFiles } from "../../features/connections/files/model/fileIndex";
import { loadRemoteSession } from "../../features/connections/model/connections";
import type { CiRepairRequest } from "../../features/inbox/model/ciRepair";
import {
  rebaseCiRepairs,
  trackCiRepair,
} from "../../features/inbox/model/ciRepairTracking";
import { orchestrator } from "../../features/orchestration/model/orchestration";
import { hostOrchestrationClient } from "../../features/orchestration/model/orchestrationClient";
import {
  attachOrchestrationWorkers,
  consolidateOrchestrationTabs,
  prepareOrchestrationWorkerDetails,
} from "../../features/orchestration/model/orchestrationWorkspace";
import { type OrchestrationWorkerDetail } from "../../features/orchestration/ui/OrchestrationActions";
import {
  findProjectTerminal,
  type DockSide,
  type ProjectTerminalDock as ProjectTerminal,
} from "../../features/projects/model/projectTerminal";
import {
  HANDOFF_TITLE,
  appendReadyHandoff,
  buildDeterministicHandoff,
  buildHandoffComposerCard,
  completeHandoff,
  isPreparingHandoff,
  sessionChildHarnesses,
  sessionThroughTurn,
} from "../../features/sessions/model/handoff";
import { generateConfiguredSessionTitle } from "../../features/sessions/model/titleModelClient";
import { type SessionDeleteChoice } from "../../features/sessions/ui/DeleteSessionDialog";
import { loadSharedAgentDefaults } from "../../features/settings/model/agentPreferences";
import {
  loadSessionSidebarOpen,
  saveSessionSidebarOpen,
  type SidebarTabId,
} from "../../features/settings/model/appearance";
import {
  loadProjectSidebarTab,
  saveProjectSidebarTab,
} from "../../features/settings/model/projectSidebarTab";
import {
  UI_SCALE_DEFAULT,
  applyUiScale,
  loadUiScale,
  saveUiScale,
  zoomInUiScale,
  zoomOutUiScale,
} from "../../features/settings/model/uiScale";
import { usePreferenceState } from "../../features/settings/model/usePreferenceState";
import { useProjectBranches } from "../../features/source-control/hooks/useProjectBranches";
import {
  useWorktreeFocus,
  worktreeFocus,
  type WorktreeFocus,
} from "../../features/source-control/model/worktreeFocus";
import { newTerminalCwd } from "../../features/terminal/model/terminalTab";
import {
  focusedFileTab,
  isAppViewOnlyTab,
  isolateTerminalPanes,
  leafIds,
  sessionToolPanes,
  sessionsWithToolPanes,
  newAgentTab,
  newTab,
  openEditorTab,
  replaceLeafId,
  splitPane,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { insertTabBesideActive } from "../../features/workspace/model/tabGroups";
import {
  applyHarnessEvent,
  applyHarnessEvents,
  bindHarnessSession,
  canCompactHarnessContext,
  cancelHarnessTurn,
  compactHarnessContext,
  forgetHarnessSession,
  isLiveHarness,
  keepHarnessQuestionOpen,
  latestTurnNeedsHarnessLogin,
  probeHarnessAvailability,
  refreshHarnessCatalogs,
  registerBuiltinHarnesses,
  respondHarnessApproval,
  respondHarnessQuestion,
  startHarnessBridge,
  stopHarnessSession,
  stopStreaming,
  type ApprovalDecision,
  type UserQuestionReply,
} from "../../integrations/harness";
import { supportsHarnessLogin } from "../../integrations/harness/core/authSupport";
import { isHarnessAvailable } from "../../integrations/harness/core/availability";
import { readHarnessSessionTitle } from "../../integrations/harness/core/registry";
import { SessionTitleCoordinator } from "../../integrations/harness/core/titleCoordinator";
import { notifyGitChanged } from "../../platform/tauri/fs";
import { IS_LINUX, IS_MAC, IS_WIN } from "../../platform/tauri/platform";
import { translate } from "../../shared/i18n/language";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../shared/lib/queryClient";
import { withToast } from "../../shared/ui/primitives/Sonner";
import { HELP_URLS, type CommandHandlers } from "../commands/registry";
import { useCommandDispatcher } from "../commands/useCommandDispatcher";
import { useEmptySessionCleanup } from "../hooks/useEmptySessionCleanup";
import { useIdleSessionDetach } from "../hooks/useIdleSessionDetach";
import { useWorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import { useWorkspaceSessionData } from "../hooks/useWorkspaceSessionData";
import { contentTabTarget } from "../model/appViewNavigation";
import {
  desktopModeForCwd,
  desktopModeTarget,
  loadDesktopLocations,
  loadDesktopMode,
  saveDesktopMode,
  type DesktopMode,
} from "../model/desktopMode";
import {
  isDisposableEmptySession,
  pendingNewSessionDraft,
  tabHasSessionResources,
} from "../model/emptySessionCleanup";
import { HarnessEventQueue } from "../model/harnessFlush";
import { releaseNotesForVersion } from "../model/releaseNotes";
import { nudgeWorkspace } from "../model/sessionEditTracking";
import {
  providerSignInRequestKey,
  sameSettings,
} from "../model/sessionTransforms";
import { useTraySessions } from "../model/traySessions";
import { readAppVersion, runUpdateFlow } from "../model/updater";
import {
  openSessionIds,
  sameWorktreeTabStats,
  tabProjectName,
} from "../model/workspaceSelectors";
import { useWorkspaceChrome } from "../shell/useWorkspaceChrome";
import { createWorkspacePageRenderer } from "../ui/workspacePageRenderer";
import { usePreloadWorkspaceSurfaces } from "../ui/workspaceSurfaces";
import { useAgentAppBridge } from "./useAgentAppBridge";
import { useBtwConversations } from "./useBtwConversations";
import { useOrchestrationBridge } from "./useOrchestrationBridge";
import { useProjectNavigation } from "./useProjectNavigation";
import { useProjectTerminalActions } from "./useProjectTerminalActions";
import { useSessionComposerActions } from "./useSessionComposerActions";
import { useSessionHistoryActions } from "./useSessionHistoryActions";
import { useSessionLaunches } from "./useSessionLaunches";
import { useSessionSubmission } from "./useSessionSubmission";
import { useSessionTurnActions } from "./useSessionTurnActions";
import { useSessionWorktreeActions } from "./useSessionWorktreeActions";
import { useWorkspaceAppViews } from "./useWorkspaceAppViews";
import { useWorkspaceFiles } from "./useWorkspaceFiles";
import { useWorkspacePaneActions } from "./useWorkspacePaneActions";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import { useWorkspaceTabClosing } from "./useWorkspaceTabClosing";
import type {
  AppProps,
  LinkedWorkItemPanelState,
  Submit,
} from "./workspaceTypes";

import { notifyDirsChanged } from "../../features/connections/files/model/fileTree";
import { nudgeWatchedFiles } from "../../features/connections/files/model/fileWatch";
import {
  finishSessionTurn,
  notifyReviewChanged,
} from "../../features/sessions/model/checkpoint";
import { createEditedResendCoordinator } from "../../features/sessions/model/editLastTurn";
import {
  defaultSessionChoice,
  mergeModelSettings,
  resolveModel,
} from "../../features/sessions/model/models";

import {
  rebaseProjectData,
  removeProjectData,
} from "../../features/projects/model/projectData";
import {
  forgetProjectLocation,
  rememberProjectLocation,
  synchronizeProjectLocation,
} from "../../features/projects/model/projectLocation";
import {
  archiveProject,
  forgetProject,
  isRemoteProjectPath,
  lastProjectPath,
  loadRecents,
  looksLikeProject,
  normalizeProjectPath,
  projectRailItems,
  rememberImportedProject,
  rememberProject,
  replaceProjectPath,
  sameProjectPath,
} from "../../features/projects/model/recents";
import {
  conversationProviderAccountId,
  selectedProviderAccountId,
  supportsProviderAccounts,
  type ProviderAccountProvider,
} from "../../features/providers/model/providerAccounts";
import { applyAddToChatRequest } from "../../features/sessions/model/addChatToWorkspace";
import {
  ADD_TO_CHAT_EVENT,
  type AddToChatRequest,
} from "../../features/sessions/model/quoteDraft";
import {
  HARNESS_TITLE,
  formatSessionTitle,
  isReusableDraftSession,
  newDefaultSession,
  newSession,
  sessionDisplayTitle,
  sessionNeedsInput,
  sessionExecutionCwd,
  type Block,
  type HarnessId,
  type LinkedWorkItem,
  type ModelTarget,
  type Session,
} from "../../features/sessions/model/session";
import { anchorSessionId } from "../../features/workspace/model/sessionColumns";
import {
  filterTabsForProject,
  findOpenSessionTab,
  focusedWorkspaceTabCwd,
  workspaceTabCwd,
  workspaceTabWorktree,
} from "../../features/workspace/model/workspaceTabGroups";
import { type SessionHeaderActions } from "../../features/workspace/ui/SessionHeaderActions";
import { pathKey, projectName } from "../../shared/lib/paths";
import { newWorkspaceSession } from "../model/newWorkspaceSession";

import {
  ADD_NOTE_TO_CHAT_EVENT,
  type NoteComposerCard,
} from "../../features/notes";
import { useInputNotifications } from "../../features/notifications/hooks/useInputNotifications";
import { useSessionReminders } from "../../features/notifications/hooks/useSessionReminders";
import { pendingApprovalNotices } from "../../features/notifications/model/approvalToast";
import { syncDockBadge } from "../../features/notifications/model/dockBadge";
import {
  loadNotificationsEnabled,
  probeNotificationPermission,
  setWindowFocused,
} from "../../features/notifications/model/notifications";
import {
  deleteSession,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  shouldPersistSession,
  upsertSession,
} from "../../features/sessions/data/sessionStore";
import { useUnseenFinishedSessions } from "../../features/sessions/hooks/useUnseenFinishedSessions";
import {
  SECOND_OPINION_TITLE,
  buildSecondOpinionRequest,
  harnessForTurn,
  turnEditedFiles,
  turnUserRequest,
} from "../../features/sessions/model/secondOpinion";
import { nativeSkillContextForSession } from "../../features/sessions/model/sessionSkills";
import { TranscriptPool } from "../../features/sessions/ui/TranscriptPool";
import { warmNativeSkills } from "../../features/skills/model/skills";
import {
  adjacentItemId,
  deferUnhandledEscape,
  focusedBusyAgentSessionId,
  shouldStopFocusedTurnOnEscape,
} from "../../features/workspace/model/tabKeys";

import {
  openFindInActiveEditor,
  openReplaceInActiveEditor,
} from "../../features/connections/files/editor/editorSearch";
import {
  REMOTE_HISTORY_UPDATED,
  cachedRemoteSessionSummary,
  knownRemoteMachine,
  remoteMachineFor,
  remoteRequest,
  rememberRemoteSession,
  remoteSessionFor,
  remoteTabCwd,
} from "../../features/connections/model/connections";
import type { HostSession } from "../../features/connections/model/protocol";
import {
  remotePath,
  remoteProjectFor,
  sharedHostMachineId,
  remoteSessionGitCwd,
  sessionUsesHost,
} from "../../features/connections/model/remoteProjects";
import { remoteSessionActions } from "../../features/connections/model/remoteSessionActions";
import { remoteSessionState } from "../../features/connections/model/remoteSessionState";
import { preloadRemoteSession } from "../../features/connections/ui/RemoteSession";
import {
  azureDevOpsWorkItemDetails,
  peekAzureDevOpsWorkItemDetails,
} from "../../features/inbox/model/azureDevOps";
import {
  githubWorkItemThread,
  inboxComposerCard,
  type InboxItem,
} from "../../features/inbox/model/githubTasks";
import {
  gitlabWorkItemDetails,
  peekGitlabWorkItemDetails,
} from "../../features/inbox/model/gitlab";
import { inboxAskKey } from "../../features/inbox/model/inboxAsk";
import { inboxTrackerDescription } from "../../features/inbox/model/inboxContext";
import { markLinkedSessionUpdateSeen } from "../../features/inbox/model/linkedSessionSeen";
import type { LinkedSessionUpdate } from "../../features/inbox/model/linkedSessionUpdates";
import {
  completeLinkedWorkItemUpdateCard,
  failLinkedWorkItemUpdateCard,
  pendingLinkedWorkItemUpdateCard,
  type LinkedWorkItemUpdateCard,
} from "../../features/inbox/model/linkedWorkItemActivity";
import type { InboxSessionPortal } from "../../features/inbox/ui/InboxDiscussionPanel";
import { linkedWorkItemFromInboxItem } from "../../features/sessions/model/sessionWorkItem";
import {
  loadAutosave,
  loadCloseToTray,
  loadLiveAgentsEnabled,
  loadMenuBarVisible,
  loadNotesEnabled,
  saveAutosave,
  saveMenuBarVisible,
  subscribeLiveAgentsEnabled,
  subscribeMenuBarVisible,
  subscribeNotesEnabled,
} from "../../features/settings/model/settings";

import {
  CONTINUE_PROMPT,
  canAutoContinue,
  inFlightRefs,
  inFlightSnapshotKey,
  shouldWriteInFlightSnapshot,
} from "../../features/sessions/model/inFlight";
import {
  collectWorkspaceSnapshot,
  workspaceSnapshotKey,
} from "../../features/workspace/model/workspaceSnapshot";
import {
  bindResumedSessions,
  closeBusyWindow,
  closeCurrentWindow,
  confirmReload,
  hasInFlightSessions,
  hideCurrentWindow,
  isAppQuitting,
  persistLiveTranscripts,
  persistQuitState,
  reapWindowRuntime,
  setQuitWorkspace,
} from "../model/appLifecycle";
import { useWorkflowRequests } from "./useWorkflowRequests";
import { useWorkspaceSummaries } from "./useWorkspaceSummaries";

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

// Register capabilities before composer hooks choose their discovery strategy.
registerBuiltinHarnesses();

/**
 * Coordinates workspace state and domain controllers. Domain hooks own their
 * effects and actions; AppView consumes the assembled view model.
 */
export function useWorkspaceController({
  windowTransfer = null,
  resumed = null,
  installedUpdate = null,
  history: bootHistory = [],
  historyCwd: bootHistoryCwd = null,
}: AppProps) {
  const { t: translateUi } = useTranslation();
  const [uiStore] = useState(createWorkspaceUiStore);
  const {
    navigationExpanded, setNavigationExpanded, filesSearchOpen, setFilesSearchOpen,
    searchFocusToken, setSearchFocusToken, paletteOpen, setPaletteOpen,
    paletteQuery, setPaletteQuery, paletteToken, setPaletteToken,
  } = useStore(uiStore);
  const projectRemoval = useMutation({ mutationFn: (path: string) => withToast(() => removeProjectData(path),
    { loading: translateUi("Saving…"), success: false }) }, queryClient);
  const [desktopStartup] = useState(() => {
    const mode = loadDesktopMode();
    return {
      mode,
      cwd: mode === "chat"
        ? loadDesktopLocations().chat?.cwd ?? "~"
        : lastProjectPath() ?? "~",
    };
  });
  const [projectCwd, setProjectCwd] = useState(
    () =>
      windowTransfer?.projectCwd ??
      resumed?.projectCwd ??
      desktopStartup.cwd,
  );
  const [recents, setRecents] = useState(() =>
    resumed?.projectCwd && looksLikeProject(resumed.projectCwd)
      ? rememberProject(resumed.projectCwd)
      : loadRecents(),
  );
  const [seed] = useState(() => {
    const cwd = desktopStartup.cwd;
    const session = newDefaultSession(cwd);
    const tab = newTab(session.id);
    return { session, tab };
  });
  const [sessions, setSessions] = useState<Session[]>(
    () => windowTransfer?.sessions ?? resumed?.sessions ?? [seed.session],
  );
  const [sessionDeleteDialog, setSessionDeleteDialog] = useState<{
    title: string;
    unusedWorktree: string;
    resolve: (choice: SessionDeleteChoice) => void;
  }>();
  const removingWorktreePaths = useRef(new Set<string>());
  const deleteConfirmationPending = useRef(false);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(
    () => windowTransfer?.tabs ?? resumed?.tabs ?? [seed.tab],
  );
  const [projectTerminals, setProjectTerminals] = useState<ProjectTerminal[]>(
    () => windowTransfer?.projectTerminals ?? resumed?.projectTerminals ?? [],
  );
  /** Dock side a brand-new project's terminal starts with, persisted in the workspace snapshot. */
  const [lastDockSide, setLastDockSide] = useState<DockSide | null>(
    () => resumed?.lastDockSide ?? null,
  );
  const lastDockSideRef = useRef(lastDockSide);
  lastDockSideRef.current = lastDockSide;
  const [projectTerminalFocused, setProjectTerminalFocused] = useState(false);
  const [activeTabId, setActiveTabIdState] = useState(
    () => windowTransfer?.activeTabId ?? resumed?.activeTabId ?? seed.tab.id,
  );
  const [composerFocused, setComposerFocused] = useState(() => {
    if (windowTransfer) return true;
    if (!resumed) return false;
    const tab =
      resumed.tabs.find((entry) => entry.id === resumed.activeTabId) ??
      resumed.tabs[0];
    return (
      !!tab && resumed.sessions.some((session) => session.id === tab.focusedId)
    );
  });
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  /** Tab id -> project name, kept in sync with the rendered title tabs. */
  const tabProjectsRef = useRef(new Map<string, string>());
  const projectOfTab = useCallback(
    (id: string) => tabProjectsRef.current.get(id),
    [],
  );
  const [sessionSidebarOpen, setSessionSidebarOpen] = usePreferenceState(
    loadSessionSidebarOpen,
  );
  const onToggleNavigation = useCallback(
    () => setNavigationExpanded((expanded) => !expanded),
    [],
  );
  const tabCloseScope = "project" as const;
  const currentProjectDock = findProjectTerminal(projectTerminals, projectCwd);
  const dockVisible = !!currentProjectDock?.open;
  const [linkedWorkItemPanels, setLinkedWorkItemPanels] = useState<
    ReadonlyMap<string, LinkedWorkItemPanelState>
  >(() => new Map());
  const linkedWorkItemPanelRequest = useRef(0);
  const closeLinkedWorkItemPanel = useCallback((sessionId: string) => {
    linkedWorkItemPanelRequest.current += 1;
    setLinkedWorkItemPanels((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
  }, []);
  const [inboxAskPortal, setInboxAskPortal] =
    useState<InboxSessionPortal | null>(null);
  const openingInboxSessions = useRef(new Map<string, Promise<string>>());
  const [inspectedWorkerId, setInspectedWorkerId] = useState<string | null>(
    null,
  );
  // Set while the lead's tab is still opening; the agent tab lands on the
  // commit that brings it in.
  const [workerDetailRequest, setWorkerDetailRequest] = useState<{
    leadId: string;
    workers: OrchestrationWorkerDetail[];
  } | null>(null);
  const nativeOrchestrationRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const hostOrchestrationRuns = useSyncExternalStore(
    hostOrchestrationClient.subscribe,
    hostOrchestrationClient.snapshot,
    hostOrchestrationClient.snapshot,
  );
  const orchestrationRuns = useMemo(
    () => [...nativeOrchestrationRuns, ...hostOrchestrationRuns],
    [nativeOrchestrationRuns, hostOrchestrationRuns],
  );
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const liveAgentsEnabled = useSyncExternalStore(
    subscribeLiveAgentsEnabled,
    loadLiveAgentsEnabled,
    () => true,
  );
  const menuBarPinned =
    useSyncExternalStore(subscribeMenuBarVisible, loadMenuBarVisible) &&
    !IS_MAC;
  const [updateNotice, setUpdateNotice] = useState(installedUpdate);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);
  const [providerSignInRequest, setProviderSignInRequest] = useState<{
    key: string;
    sessionId: string;
    harness: HarnessId;
  } | null>(null);
  const seenProviderSignInRequestsRef = useRef<Set<string> | null>(null);
  const seenProviderSignInRequests =
    seenProviderSignInRequestsRef.current ??
    (seenProviderSignInRequestsRef.current = new Set(
      sessions.flatMap((session) => {
        if (
          !supportsHarnessLogin(session.harness) ||
          !latestTurnNeedsHarnessLogin(session.blocks)
        ) {
          return [];
        }
        return [providerSignInRequestKey(session)];
      }),
    ));
  const {
    appPage,
    showWorkspace,
    closeAppPage,
    appDialog,
    closeAppDialog,
    appPageHostRef,
    activeAppView,
    appViewFocusedRef,
    workspaceVisible,
    inboxVisible,
    tabVisitNav,
    onVisitBack,
    onVisitForward,
    previousTabs,
    openAppView,
    onOpenSearch,
    onSearchEverywhere,
    onLeaveSearch,
    searchViewFocusToken,
    searchQueryRequest,
    onOpenInbox,
    onOpenNotes,
    onLeaveNotes,
    onOpenAutomations,
    onLeaveAutomations,
    onOpenWorkflows,
    openSettings,
    onOpenSettings,
    onCloseSettings,
    onSelectSettingsSection,
    onOpenNotificationSettings,
    onOpenInboxIntegrations,
    settingsSection,
    settingsAnchor,
    notificationProjectPath,
    notificationSettingsRequest,
    remoteProjectDialogOpen,
    setRemoteProjectDialogOpen,
    newEnvironmentDialogOpen,
    setNewEnvironmentDialogOpen,
    assistantMachineId,
    onOpenAssistant,
  } = useWorkspaceAppViews({
    tabs,
    activeTabId,
    notesEnabled,
    initialPage:
      !resumed &&
      !windowTransfer &&
      !lastProjectPath() &&
      desktopStartup.mode === "code"
        ? "projects"
        : null,
    context: () => ({
      tabs: tabsRef.current,
      sessions: sessionsRef.current,
      activeTabId: activeTabIdRef.current,
      projectCwd: projectCwdRef.current,
    }),
    cancelNavigation: () => workspaceNavigation.cancel(),
    ensureContentTab: (cwd) => ensureContentTab(cwd),
    activateTab: (id, paneId) => activateTab(id, paneId),
    onSelectFileSurface: (paneId, fileId) => onSelectFileSurface(paneId, fileId),
    setTabs,
    setPaletteOpen,
    setProjectTerminalFocused,
    setComposerFocused,
  });

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const {
    data: sessionData,
    history,
    storedLinkedSessions,
    loadedProjects,
    failedProjectPaths,
  } = useWorkspaceSessionData({
    sessionsRef,
    setSessions,
    history: bootHistory,
    historyCwd: bootHistoryCwd,
    restoredSessions: windowTransfer?.sessions ?? resumed?.sessions,
    isSwitching: (id) => workspaceNavigation.isMoving(id),
    onImported: (cwd) => setRecents(rememberImportedProject(cwd)),
  });
  const { persist: persistSession, refreshHistory } = sessionData;
  const [, refreshRemoteTabTitles] = useState(0);
  useEffect(() => {
    const updated = () => refreshRemoteTabTitles((value) => value + 1);
    window.addEventListener(REMOTE_HISTORY_UPDATED, updated);
    return () => window.removeEventListener(REMOTE_HISTORY_UPDATED, updated);
  }, []);

  const titleCoordinator = useRef<SessionTitleCoordinator | null>(null);
  if (!titleCoordinator.current)
    titleCoordinator.current = new SessionTitleCoordinator({
      get: (id) => sessionsRef.current.find((session) => session.id === id),
      update: (id, change) => {
        const previous = sessionsRef.current;
        const next = previous.map((session) =>
          session.id === id ? change(session) : session,
        );
        if (!next.some((session, index) => session !== previous[index])) return;
        sessionsRef.current = next;
        setSessions((current) =>
          current.map((session) =>
            session.id === id ? change(session) : session,
          ),
        );
      },
      read: readHarnessSessionTitle,
      generate: (session, message) =>
        generateConfiguredSessionTitle(session.cwd, message),
    });
  useEffect(() => () => titleCoordinator.current?.close(), []);
  const titleBindings = useRef(new Map<string, string>());
  useEffect(() => {
    const present = new Set(sessions.map((session) => session.id));
    for (const id of titleBindings.current.keys())
      if (!present.has(id)) {
        titleBindings.current.delete(id);
        titleCoordinator.current!.cancel(id);
      }
    for (const session of sessions) {
      if (!session.providerSessionId || sessionUsesHost(session)) continue;
      const binding = `${session.harness}:${session.providerAccountId ?? "default"}:${session.providerSessionId}`;
      if (titleBindings.current.get(session.id) === binding) continue;
      titleBindings.current.set(session.id, binding);
      void titleCoordinator.current!.read(session.id);
    }
  }, [sessions]);

  const linkedSessionUpdatesRef = useRef<
    ReadonlyMap<string, LinkedSessionUpdate>
  >(new Map());
  const linkedWorkItemActivityFetches = useRef(new Map<string, number>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const projectTerminalsRef = useRef(projectTerminals);
  projectTerminalsRef.current = projectTerminals;
  const projectTerminalFocusedRef = useRef(projectTerminalFocused);
  projectTerminalFocusedRef.current = projectTerminalFocused;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const historyForCleanupRef = useRef(history);
  historyForCleanupRef.current = history;
  const files = useWorkspaceFiles({
    tabs,
    initialDirtyFileIds: windowTransfer?.dirtyFileIds,
    context: () => ({
      tabs: tabsRef.current,
      sessions: sessionsRef.current,
      activeTabId: activeTabIdRef.current,
      projectCwd: projectCwdRef.current,
      sidebarCwd: sidebarCwdRef.current,
      gitCwd: gitCwdRef.current,
    }),
    ensureContentTab: (cwd) => ensureContentTab(cwd),
    activateTab: (id, paneId) => activateTab(id, paneId),
    showWorkspace: () => showWorkspace(),
    setTabs,
    setComposerFocused,
    setProjectTerminalFocused,
  });
  const {
    dirtyFiles,
    fileErrorCounts,
    editorNavigations,
    openFilePaths,
    onOpenDiff,
    onOpenAllChanges,
    onReorderFiles,
    onFileMoved,
    onFileDeleted,
    onShowFileExplorer,
    onOpenFile,
    onOpenSessionFile,
    onOpenPlan,
    onPinFile,
    onFileDirtyChange,
    onFileErrorCountChange,
    onSelectFileSurface,
  } = files;
  const canDiscardEmptySession = useCallback((id: string) => {
    const session = sessionsRef.current.find((entry) => entry.id === id);
    return (
      !!session &&
      isDisposableEmptySession(session) &&
      !remoteSessionFor(id) &&
      !historyForCleanupRef.current.some((entry) => entry.id === id) &&
      !tabsRef.current.some((tab) =>
        leafIds(tab.layout).includes(id) &&
        (tabHasSessionResources(tab) || files.hasPendingResources(tab.id)),
      )
    );
  }, []);

  const projectWorktree = useWorktreeFocus(projectCwd);
  const workspaceNavigation = useWorkspaceNavigation({
    project: projectCwd,
    activeTabId,
    tabs,
    sessions,
    getSnapshot: () => ({
      project: projectCwdRef.current,
      activeTabId: activeTabIdRef.current,
      tabs: tabsRef.current,
      sessions: sessionsRef.current,
    }),
    restoreDefaultWorkspaces: true,
    restoredProjectReturn: resumed?.projectReturnMemory,
    moveSession: (id, tree, isCurrent) =>
      onWorktreeChange(id, tree, false, isCurrent),
    activateTab: (id, paneId) => {
      if (tabsRef.current.some((tab) => tab.id === id)) {
        applyTabActivation(id, paneId);
      } else {
        // A newly created tab has not rendered into tabsRef yet.
        showWorkspace();
        setActiveTabIdState(id);
        setComposerFocused(true);
      }
    },
    setActiveTabId: (id) => {
      showWorkspace();
      setActiveTabIdState(id);
    },
    createTab: (project, focus) => createWorkspaceTab(project, focus),
    canReuseBlank: canDiscardEmptySession,
  });
  const {
    activateTab,
    setActiveTabId,
    tabWorkspace,
    keepWorkspaceTab,
    readProjectReturnMemory,
  } = workspaceNavigation;
  const tabWorktreeOf = useCallback(
    (tab: WorkspaceTab) => tabWorkspace(tab, sessionsRef.current),
    [tabWorkspace],
  );

  const projectCwdRef = useRef(projectCwd);
  projectCwdRef.current = projectCwd;
  const foregroundSurfaceRef = useRef<{
    workspaceVisible: boolean;
    inboxSessionId?: string;
  }>({ workspaceVisible: true });
  foregroundSurfaceRef.current = {
    workspaceVisible,
    inboxSessionId: inboxVisible ? inboxAskPortal?.sessionId : undefined,
  };
  const sessionNavigationIdsRef = useRef<readonly string[]>([]);
  const sessionNavigationProjectRef = useRef<string | null>(null);
  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;
  const whatsNewVersionRef = useRef(whatsNewVersion);
  whatsNewVersionRef.current = whatsNewVersion;

  usePreloadWorkspaceSurfaces(notesEnabled);

  const turnGen = useRef(new Map<string, number>());
  const editedResends = useRef(createEditedResendCoordinator()).current;
  const inFlightSyncKey = useRef<string | null>(null);
  const sawInFlight = useRef(false);
  const workspaceSyncKey = useRef<string | null>(null);
  const workspaceSaveTimer = useRef<number | undefined>(undefined);
  const [transcriptPool] = useState(() => new TranscriptPool());
  // Visible output advances per frame; hidden streams keep their own cadence.
  const [harnessEvents] = useState(
    () =>
      new HarnessEventQueue(
        (sessionId) => {
          const tab = tabsRef.current.find(
            (entry) => entry.id === activeTabIdRef.current,
          );
          // Inbox owns its session surfaces outside the workspace tab tree.
          return (
            foregroundSurfaceRef.current.inboxSessionId === sessionId ||
            (foregroundSurfaceRef.current.workspaceVisible &&
              !!tab &&
              (leafIds(tab.layout).includes(sessionId) ||
                tab.editorPanes.some((pane) =>
                  pane.files.some(
                    (file) =>
                      file.id === pane.activeFileId &&
                      (file.agent?.sessionId === sessionId ||
                        file.subagent?.parentSessionId === sessionId),
                  ),
                )))
          );
        },
        (batches) => {
          const prev = sessionsRef.current;
          const next = prev.map((session) => {
            const events = batches.get(session.id);
            return events ? applyHarnessEvents(session, events) : session;
          });
          if (!next.some((session, index) => session !== prev[index])) return;
          sessionsRef.current = next;
          syncDockBadge(next);
          setSessions(next);
        },
      ),
  );
  const skipForgetSessionIds = useRef(new Set<string>());
  const projectLocationSyncs = useRef(
    new Map<string, ReturnType<typeof synchronizeProjectLocation>>(),
  );
  const submitAfterProjectSyncRef = useRef<Submit>(() => false);

  useEffect(() => {
    for (const project of recents) {
      void rememberProjectLocation(project.path).catch(() => undefined);
    }
  }, [recents]);

  const flushHarnessEvents = harnessEvents.flush;
  const flushForegroundHarnessEvents = harnessEvents.flushForeground;

  const stopSessionForRemoval = useCallback(
    async (sessionId: string): Promise<Session | undefined> => {
      titleCoordinator.current!.cancel(sessionId);
      await orchestrator.stopForSession(sessionId);
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!open?.busy) return open;

      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      await Promise.all(
        sessionChildHarnesses(open).map(async (harness) => {
          await cancelHarnessTurn(harness, sessionId).catch(() => undefined);
          await stopHarnessSession(harness, sessionId);
        }),
      );
      await finishSessionTurn(sessionId, sessionExecutionCwd(open));
      flushHarnessEvents();
      return sessionsRef.current.find((session) => session.id === sessionId);
    },
    [flushHarnessEvents],
  );

  const enqueueHarnessEvent = harnessEvents.enqueue;

  useEffect(() => {
    if (resumed?.sessions.length) bindResumedSessions(resumed.sessions);
    const stopBridge = startHarnessBridge();
    const reap = () => {
      if (isAppQuitting()) return;
      void persistQuitState(
        sessionsRef.current,
        tabsRef.current,
        activeTabIdRef.current,
        projectCwdRef.current,
        readProjectReturnMemory(),
        "unload",
        projectTerminalsRef.current,
        lastDockSideRef.current ?? undefined,
      ).finally(() => {
        void reapWindowRuntime(
          sessionsRef.current,
          tabsRef.current,
          projectTerminalsRef.current,
        );
      });
    };
    window.addEventListener("pagehide", reap);
    window.addEventListener("beforeunload", reap);
    return () => {
      window.removeEventListener("pagehide", reap);
      window.removeEventListener("beforeunload", reap);
      stopBridge();
      harnessEvents.cancelScheduled();
    };
  }, [resumed, readProjectReturnMemory, harnessEvents]);

  useEffect(() => {
    // The next new session's harness also loads at boot, so its picker is
    // ready; only once the probe confirms that CLI is installed.
    void probeHarnessAvailability().then(() => {
      const next = defaultSessionChoice(sidebarCwdRef.current).harness;
      if (isLiveHarness(next) && isHarnessAvailable(next)) {
        void refreshHarnessCatalogs([next]);
      }
    });
    // Only the harnesses already in this window. Probing every installed CLI
    // at boot left unused agents (especially Pi) running in the background.
    const harnesses = [
      ...new Set(sessionsRef.current.map((session) => session.harness)),
    ];
    void refreshHarnessCatalogs(harnesses).then(() => {
      setSessions((prev) =>
        prev.map((session) => {
          if (!isLiveHarness(session.harness)) return session;
          const resolved = resolveModel(session.harness, session.model);
          const modelSettings = mergeModelSettings(
            resolved,
            session.modelSettings,
          );
          if (
            resolved.id === session.model &&
            sameSettings(modelSettings, session.modelSettings)
          ) {
            return session;
          }
          return { ...session, model: resolved.id, modelSettings };
        }),
      );
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const active =
    sessions.find((session) => session.id === activeTab?.focusedId) ??
    sessions.find(
      (session) => activeTab && leafIds(activeTab.layout).includes(session.id),
    );
  const activeTabSessionIds = activeTab ? leafIds(activeTab.layout) : [];
  const activeLinkedWorkItemPanel = activeTab
    ? (linkedWorkItemPanels.get(activeTab.focusedId) ??
      [...linkedWorkItemPanels.values()]
        .reverse()
        .find((panel) => activeTabSessionIds.includes(panel.sessionId)) ??
      null)
    : null;

  // Panels are tab-local UI. Keep mounted panels alive while their tab is in
  // the workspace so switching away preserves the fetched issue and its UI
  // state, then discard them when their session leaves every open tab.
  useEffect(() => {
    const openSessionIds = new Set(tabs.flatMap((tab) => leafIds(tab.layout)));
    setLinkedWorkItemPanels((current) => {
      if ([...current.keys()].every((id) => openSessionIds.has(id))) {
        return current;
      }
      return new Map([...current].filter(([id]) => openSessionIds.has(id)));
    });
  }, [tabs]);

  const sessionDefaults = active ?? sessions[0];
  const [sharedAgentDefaults] = usePreferenceState(loadSharedAgentDefaults);
  const newSessionRuntimeMode = sharedAgentDefaults.runtimeMode ?? sessionDefaults?.runtimeMode;

  useEffect(() => {
    const openSessionForAddToChat = (event: Event) => {
      const detail = (event as CustomEvent<AddToChatRequest>).detail;
      if (!detail?.text) return;

      const result = applyAddToChatRequest({
        sessions: sessionsRef.current,
        tabs: tabsRef.current,
        activeTabId: activeTabIdRef.current,
        projectCwd: projectCwdRef.current,
        fallbackCwd: sessionDefaults?.cwd,
        defaultRuntimeMode: newSessionRuntimeMode,
        text: detail.text,
        mode: detail.mode,
      });
      if (!result) return;

      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
    };

    window.addEventListener(ADD_TO_CHAT_EVENT, openSessionForAddToChat);
    return () =>
      window.removeEventListener(ADD_TO_CHAT_EVENT, openSessionForAddToChat);
  }, [sessionDefaults?.cwd, newSessionRuntimeMode]);

  const activeSkillContext = active
    ? nativeSkillContextForSession(active)
    : null;
  const activeSkillCwd = activeSkillContext?.cwd;

  useEffect(() => {
    if (!activeSkillContext || !activeSkillCwd) return;
    warmNativeSkills(activeSkillContext);
  }, [activeSkillCwd, active?.id, active?.harness]);

  const activeFile = activeTab ? focusedFileTab(activeTab) : undefined;
  const sidebarCwd =
    (activeFile?.appView
      ? undefined
      : (activeFile?.projectCwd ?? activeFile?.cwd)) ??
    active?.cwd ??
    (activeTab ? workspaceTabCwd(activeTab, sessions) : undefined) ??
    projectCwd;
  const [desktopMode, setDesktopMode] = useState<DesktopMode>(desktopStartup.mode);
  const desktopLocationsRef = useRef(loadDesktopLocations());
  const desktopModeRequestRef = useRef(0);
  useLayoutEffect(() => {
    if (!workspaceVisible || activeAppView || !activeTab) return;
    const mode = desktopModeForCwd(sidebarCwd);
    setDesktopMode(mode);
    desktopLocationsRef.current = {
      ...desktopLocationsRef.current,
      [mode]: { tabId: activeTab.id, paneId: activeTab.focusedId, sessionId: active?.id, cwd: sidebarCwd },
    };
    saveDesktopMode(mode, desktopLocationsRef.current);
  }, [workspaceVisible, activeAppView, activeTab?.id, activeTab?.focusedId, active?.id, sidebarCwd]);
  useLayoutEffect(() => {
    document.documentElement.dataset.desktopMode = desktopMode;
  }, [desktopMode]);
  const sidebarCwdRef = useRef(sidebarCwd);
  sidebarCwdRef.current = sidebarCwd;
  const [sidebarTabSelection, setSidebarTabSelection] = useState<{
    project: string;
    tab: SidebarTabId;
  }>(() => ({
    project: pathKey(sidebarCwd),
    tab: loadProjectSidebarTab(sidebarCwd),
  }));
  const sidebarTab =
    sidebarTabSelection.project === pathKey(sidebarCwd)
      ? sidebarTabSelection.tab
      : loadProjectSidebarTab(sidebarCwd);
  const showFileExplorerRef = useRef<(cwd: string) => void>(() => {});
  const showChangesRef = useRef<(cwd: string) => void>(() => {});
  const setSidebarTab = useCallback((tab: SidebarTabId, project?: string) => {
    const cwd = project ?? sidebarCwdRef.current;
    if (tab === "files") {
      showFileExplorerRef.current(cwd);
      return;
    }
    // Changes open as a review with source control beside it, not a panel.
    if (tab === "changes") {
      showChangesRef.current(cwd);
      return;
    }
    saveProjectSidebarTab(cwd, tab);
    setSidebarTabSelection({
      project: pathKey(cwd),
      tab,
    });
  }, []);
  const sidebarCwdKey =
    sidebarCwd && sidebarCwd !== "~" ? pathKey(sidebarCwd) : null;
  const historyFailed =
    sidebarCwdKey != null && failedProjectPaths.has(sidebarCwdKey);
  // True from the very first frame that shows a project we have never listed,
  // so the sidebar can stay blank instead of flashing "No sessions yet".
  const historyPending =
    sidebarCwdKey != null &&
    !loadedProjects.has(sidebarCwdKey) &&
    !historyFailed;
  const gitCwd =
    (activeFile?.appView ? undefined : activeFile?.cwd) ??
    (active
      ? sessionExecutionCwd(active)
      : ((activeTab ? workspaceTabWorktree(activeTab, sessions) : undefined) ??
        projectWorktree?.path ??
        sidebarCwd));
  const terminalCwd = newTerminalCwd({
    activeFile: activeFile?.appView ? undefined : activeFile,
    session: active,
    fallback: gitCwd,
  });
  const gitCwdBranches = useProjectBranches(
    gitCwd,
    Boolean(gitCwd) && gitCwd !== "~" && !isRemoteProjectPath(sidebarCwd),
  );
  const explorerRootLabel =
    active?.linkedWorktree && sameProjectPath(gitCwd, sessionExecutionCwd(active))
      ? active.branch || gitCwdBranches?.current || undefined
      : undefined;
  const remoteFilesProject = remoteProjectFor(sidebarCwd);
  // The host checkout the remote tab is aimed at — the attached session's
  // work path or a worktree picked before the first message.
  const remoteTabCheckout = remoteFilesProject
    ? remoteTabCwd(sidebarCwd, active?.id)
    : undefined;
  const filesCwd = remoteFilesProject && !remoteFilesProject.local
    ? isRemoteProjectPath(gitCwd)
      ? gitCwd
      : remotePath(
          remoteFilesProject.environmentId,
          remoteTabCheckout ??
            (gitCwd && gitCwd !== sidebarCwd ? gitCwd : remoteFilesProject.cwd),
        )
    : gitCwd;
  // Git follows the session's own work path (a linked worktree included),
  // never the terminal-following files cwd: a remote session working in a
  // separate worktree diffed the main checkout and showed "No file changes".
  const gitRootCwd = remoteFilesProject
    ? remoteSessionGitCwd(
        remoteFilesProject,
        gitCwd,
        sidebarCwd,
        remoteTabCheckout,
      )
    : gitCwd;
  const gitCwdRef = useRef(gitRootCwd);
  gitCwdRef.current = gitRootCwd;
  const sourceControlBranches = useProjectBranches(
    gitRootCwd,
    Boolean(gitRootCwd) && gitRootCwd !== "~",
  );
  // Unborn and detached repositories also have a current branch or HEAD.
  // A missing current value means the checkout is pending or is not a repo.
  const sourceControlAvailable = Boolean(sourceControlBranches?.current);
  const projectBranches = useProjectBranches(
    sidebarCwd,
    Boolean(sidebarCwd) && sidebarCwd !== "~",
  );

  const nextBusySessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (session.busy) {
        ids.add(session.id);
        if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
      }
    }
    return ids;
  }, [sessions]);
  const busySessionIdsRef = useRef(nextBusySessionIds);
  if (!setsEqual(busySessionIdsRef.current, nextBusySessionIds)) {
    busySessionIdsRef.current = nextBusySessionIds;
  }
  const busySessionIds = busySessionIdsRef.current;

  /** Probe the active session's harness for its live model catalog whenever
   * the active harness changes. Catalogs load lazily (probing spawns a CLI
   * process) and the boot refresh runs before restored sessions land, so a
   * fresh session would otherwise show only the built-in fallback model
   * until the picker happened to be opened. Idempotent: refreshHarnessCatalogs
   * dedupes via hasLiveCatalog and its inflight map. */
  const activeHarness = active?.harness;
  useEffect(() => {
    if (!activeHarness || !isLiveHarness(activeHarness)) return;
    void refreshHarnessCatalogs([activeHarness]);
  }, [activeHarness]);

  const activeProviderSignInRequest = useMemo(() => {
    if (
      !active ||
      !supportsHarnessLogin(active.harness) ||
      !latestTurnNeedsHarnessLogin(active.blocks)
    ) {
      return null;
    }
    return {
      key: providerSignInRequestKey(active),
      sessionId: active.id,
      harness: active.harness,
    };
  }, [active]);
  useEffect(() => {
    if (!activeProviderSignInRequest) return;
    if (seenProviderSignInRequests.has(activeProviderSignInRequest.key)) {
      return;
    }
    seenProviderSignInRequests.add(activeProviderSignInRequest.key);
    setProviderSignInRequest(activeProviderSignInRequest);
  }, [activeProviderSignInRequest, seenProviderSignInRequests]);
  useEffect(() => {
    if (
      providerSignInRequest &&
      active?.id !== providerSignInRequest.sessionId
    ) {
      setProviderSignInRequest(null);
    }
  }, [active?.id, providerSignInRequest]);

  const [nextApprovalSessionIds, nextQuestionSessionIds] = useMemo(() => {
    const approvals = new Set<string>();
    const questions = new Set<string>();
    for (const session of sessions) {
      if (sessionNeedsInput(session)) {
        approvals.add(session.id);
        if (session.orchestrationLeadId) approvals.add(session.orchestrationLeadId);
        if (session.pendingQuestion) questions.add(session.id);
      }
    }
    return [approvals, questions];
  }, [sessions]);
  const approvalSessionIdsRef = useRef(nextApprovalSessionIds);
  if (!setsEqual(approvalSessionIdsRef.current, nextApprovalSessionIds)) {
    approvalSessionIdsRef.current = nextApprovalSessionIds;
  }
  const approvalSessionIds = approvalSessionIdsRef.current;
  const questionSessionIdsRef = useRef(nextQuestionSessionIds);
  if (!setsEqual(questionSessionIdsRef.current, nextQuestionSessionIds)) {
    questionSessionIdsRef.current = nextQuestionSessionIds;
  }
  const questionSessionIds = questionSessionIdsRef.current;

  const activeSessionId = inboxVisible
    ? composerFocused
      ? inboxAskPortal?.sessionId
      : undefined
    : activeAppView
      ? undefined
      : active?.id;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  useInputNotifications(sessions, activeSessionId);

  // Cache the OS decision so a turn ending later can skip a denied banner.
  useEffect(() => {
    if (loadNotificationsEnabled()) void probeNotificationPermission();
  }, []);
  const unseenFinishedIds = useUnseenFinishedSessions(
    sessions,
    busySessionIds,
    activeSessionId,
  );

  const approvalToasts = useMemo(
    () => pendingApprovalNotices(sessions),
    [sessions],
  );
  const [reminderNoticesHeight, setReminderNoticesHeight] = useState(0);
  const [harnessUpdateHeight, setHarnessUpdateHeight] = useState(0);

  useEffect(() => {
    syncDockBadge(sessions);
  }, [sessions]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        setWindowFocused(focused);
        if (focused) {
          flushForegroundHarnessEvents();
          syncDockBadge(sessionsRef.current);
          if (
            document.activeElement === document.body &&
            !projectTerminalFocusedRef.current &&
            !appViewFocusedRef.current
          ) {
            setComposerFocused(true);
            setComposerFocusToken((token) => token + 1);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [flushForegroundHarnessEvents]);

  useEffect(() => {
    const onVisible = () => {
      // Flush on hiding too: WebKit can suspend a pending animation frame,
      // leaving the last output stranded until another event or activation.
      flushHarnessEvents();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [flushHarnessEvents]);

  useLayoutEffect(() => {
    // Catch up only the newly visible panes before paint. Other streams keep
    // their background timer instead of adding work to this tab switch.
    flushForegroundHarnessEvents();
  }, [
    activeTabId,
    inboxVisible,
    inboxAskPortal?.sessionId,
    activeAppView,
    flushForegroundHarnessEvents,
  ]);

  // The tray lists the shared Host's conversations; the one this window
  // shows counts as read.
  const trayLabels = useMemo(
    () => ({
      open: translateUi("Open OmniCode"),
      unread: translateUi("Unread"),
      pinned: translateUi("Pinned"),
      recent: translateUi("Recent"),
      more: translateUi("More"),
      newSession: translateUi("New conversation"),
      quit: translateUi("Quit OmniCode and Host"),
    }),
    [translateUi],
  );
  useTraySessions(
    IS_WIN || IS_LINUX,
    trayLabels,
    activeSessionId ? remoteSessionFor(activeSessionId) : undefined,
  );

  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    const releaseQuit = setQuitWorkspace(
      () => sessionsRef.current,
      () => tabsRef.current,
      () => activeTabIdRef.current,
      () => projectCwdRef.current,
      () => projectTerminalsRef.current,
      readProjectReturnMemory,
      flushHarnessEvents,
      () => lastDockSideRef.current,
      keepWorkspaceTab,
    );
    void getCurrentWindow()
      .onCloseRequested((event) => {
        // Listening here makes close our job. Letting the default path run
        // calls JS `window.destroy`, which Tauri denies without a permission.
        event.preventDefault();
        const toTray = loadCloseToTray();
        if (hasInFlightSessions(sessionsRef.current)) {
          flushHarnessEvents();
          if (!toTray && !IS_MAC) {
            void closeBusyWindow();
            return;
          }
          // Not `persistQuitState`: that marks the live turns interrupted.
          void persistLiveTranscripts(sessionsRef.current);
          void hideCurrentWindow();
          return;
        }
        void persistQuitState(
          sessionsRef.current,
          tabsRef.current,
          activeTabIdRef.current,
          projectCwdRef.current,
          readProjectReturnMemory(),
          "unload",
          projectTerminalsRef.current,
          lastDockSideRef.current ?? undefined,
          keepWorkspaceTab,
        ).finally(() => {
          void (toTray ? hideCurrentWindow() : closeCurrentWindow());
        });
      })
      .then((fn) => {
        unlistenClose = fn;
      });
    return () => {
      releaseQuit();
      unlistenClose?.();
    };
  }, [flushHarnessEvents, keepWorkspaceTab, readProjectReturnMemory]);

  useEffect(() => {
    void refreshHistory(sidebarCwd);
  }, [sidebarCwd, refreshHistory]);

  useEffect(() => {
    if (!inboxVisible) return;
    return sessionData.refreshLinked();
  }, [inboxVisible, sessionData]);

  useEffect(() => {
    prefetchProjectFiles(gitCwd);
  }, [gitCwd]);

  useEffect(() => {
    sessionData.observe(sessions, openSessionIds(tabsRef.current));
  }, [sessions, sessionData]);

  useEffect(() => {
    const refs = inFlightRefs(sessions, tabs);
    if (refs.length > 0) sawInFlight.current = true;
    const key = inFlightSnapshotKey(refs);
    if (
      !shouldWriteInFlightSnapshot(
        key,
        refs,
        inFlightSyncKey.current,
        sawInFlight.current,
      )
    ) {
      return;
    }
    inFlightSyncKey.current = key;
    void replaceInFlightSessions(refs).catch(() => undefined);
  }, [sessions, tabs]);

  useEffect(() => {
    if (windowTransfer) return;
    const snapshot = collectWorkspaceSnapshot(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      readProjectReturnMemory({
        project: projectCwd,
        tabs,
        sessions,
        activeTabId,
      }),
      projectTerminals,
      lastDockSide ?? undefined,
      keepWorkspaceTab,
    );
    const key = workspaceSnapshotKey(snapshot);
    if (workspaceSyncKey.current === key) return;
    workspaceSyncKey.current = key;
    // The key is recorded as soon as a save is scheduled, so an unrelated
    // re-render (every streamed frame) must not cancel it. Only a newer
    // snapshot replaces the pending one.
    window.clearTimeout(workspaceSaveTimer.current);
    workspaceSaveTimer.current = window.setTimeout(() => {
      workspaceSaveTimer.current = undefined;
      void saveWorkspaceSnapshot(snapshot).catch(() => undefined);
    }, 250);
  }, [
    tabs,
    sessions,
    activeTabId,
    projectCwd,
    projectTerminals,
    lastDockSide,
    windowTransfer,
    keepWorkspaceTab,
    readProjectReturnMemory,
    projectWorktree?.path,
    workspaceNavigation.revision,
  ]);

  useEffect(() => {
    // A restored workspace or explicit Chat launch already owns its location.
    if (lastProjectPath() || resumed || windowTransfer || desktopStartup.mode === "chat") return;
    void queryClient.fetchQuery({ queryKey: ["app", "defaultCwd"], queryFn: () => invoke<string>("default_cwd"), staleTime: Infinity })
      .then((cwd) => {
        if (!looksLikeProject(cwd)) return;
        setProjectCwd(cwd);
        setRecents((prev) => (prev.length > 0 ? prev : rememberProject(cwd)));
        setSessions((prev) =>
          prev.map((s) => (s.cwd === "~" ? { ...s, cwd } : s)),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        const isolated = isolateTerminalPanes(tab);
        if (isolated !== tab) changed = true;
        return isolated;
      });
      return changed ? next : prev;
    });
  }, [tabs]);

  // Tabs are views. Hidden idle sessions drop their child. A visible session
  // keeps its child for a few minutes after a turn so follow-ups stay instant,
  // then parks it and resumes on the next prompt.
  useIdleSessionDetach({
    sessions,
    sessionsRef,
    tabs,
    tabsRef,
    orchestrationRuns,
    liveAgentsEnabled,
    unseenFinishedIds,
    sessionData,
    skipForgetSessionIds,
    setSessions,
  });

  const applyTabActivation = useCallback(
    (id: string, paneId?: string) => {
      showWorkspace();
      const tab = tabsRef.current.find((entry) => entry.id === id);
      const nextFocusedId =
        tab &&
        paneId &&
        (leafIds(tab.layout).includes(paneId) ||
          tab.editorPanes.some((entry) => entry.id === paneId) ||
          (tab.terminalPanes ?? []).some((entry) => entry.id === paneId))
          ? paneId
          : tab?.focusedId;

      setActiveTabIdState(id);
      if (tab && nextFocusedId && nextFocusedId !== tab.focusedId) {
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? { ...entry, focusedId: nextFocusedId, diffFocused: false }
              : entry,
          ),
        );
      }

      if (tab) {
        const focusedTab = nextFocusedId
          ? { ...tab, focusedId: nextFocusedId }
          : tab;
        const cwd = focusedWorkspaceTabCwd(focusedTab, sessionsRef.current);
        if (cwd && looksLikeProject(cwd)) {
          const normalized = normalizeProjectPath(cwd);
          if (!sameProjectPath(normalized, projectCwdRef.current)) {
            setProjectCwd(normalized);
            setRecents(rememberProject(normalized));
          }
        }
      }
      setComposerFocused(
        !!nextFocusedId &&
          sessionsRef.current.some((session) => session.id === nextFocusedId),
      );
    },
    [],
  );

  const discardEmptySessionReferences = useCallback(
    (ids: ReadonlySet<string>) => {
      for (const id of ids) sessionData.forget(id);
      workspaceNavigation.forgetSessions(ids);
    },
    [sessionData, workspaceNavigation.forgetSessions],
  );

  useEmptySessionCleanup({
    tabs,
    sessions,
    activeTabId,
    enabled: workspaceVisible && !activeAppView,
    canDiscard: canDiscardEmptySession,
    setTabs,
    onDiscard: discardEmptySessionReferences,
  });

  /** `cwd` scopes group inheritance: a tab from another project starts alone. */
  const insertBeside = useCallback(
    (
      prev: WorkspaceTab[],
      tab: WorkspaceTab,
      anchorId: string | undefined,
      cwd?: string,
    ) =>
      insertTabBesideActive(prev, tab, anchorId, (id) =>
        id === tab.id ? (cwd ? projectName(cwd) : undefined) : projectOfTab(id),
      ),
    [projectOfTab],
  );

  const insertBesideActive = useCallback(
    (prev: WorkspaceTab[], tab: WorkspaceTab, cwd?: string) =>
      insertBeside(prev, tab, activeTabIdRef.current, cwd),
    [insertBeside],
  );

  const appendTab = useCallback(
    (tab: WorkspaceTab, cwd?: string) => {
      setTabs((prev) => insertBesideActive(prev, tab, cwd));
    },
    [insertBesideActive],
  );

  const onSelectProviderAccount = useCallback(
    (
      sessionId: string,
      provider: ProviderAccountProvider,
      accountId: string,
    ) => {
      const target = sessionsRef.current.find((item) => item.id === sessionId);
      if (!target || target.harness !== provider) return;
      if (conversationProviderAccountId(target) === accountId) return;

      // The Host moves its conversation to the account in place.
      if (
        sessionUsesHost(target) &&
        remoteSessionActions(sessionId)?.switchAccount(accountId)
      )
        return;

      if (target.blocks.length === 0 && !target.busy) {
        setSessions((current) =>
          current.map((session) =>
            session.id === target.id
              ? { ...session, providerAccountId: accountId }
              : session,
          ),
        );
        return;
      }

      // Provider thread ids are account-owned. Without the Host to move the
      // native records, the next turn starts a thread on the new account and
      // continues this conversation from a recap.
      if (target.busy || target.pendingSwitch || isPreparingHandoff(target))
        return;
      const history = {
        ...target,
        blocks: target.blocks.filter((block) => !block.draft),
      };
      const handedOff = history.blocks.some((block) => block.role === "user")
        ? appendReadyHandoff(
            history,
            target.harness,
            target.harness,
            buildDeterministicHandoff(history),
          )
        : history;
      void forgetHarnessSession(target.harness, target.id);
      setSessions((current) =>
        current.map((session) =>
          session.id === target.id
            ? {
                ...session,
                blocks: [
                  ...handedOff.blocks,
                  ...session.blocks.filter((block) => block.draft),
                ],
                providerAccountId: accountId,
                providerSessionId: undefined,
                nativeSession: undefined,
                usageLimit: undefined,
                context: undefined,
              }
            : session,
        ),
      );
    },
    [],
  );

  const onOpenWhatsNew = useCallback((version: string) => {
    const document = releaseNotesForVersion(version);
    if (!document) {
      void message(
        "Release notes for this version are not available in this build.",
        { title: "OmniCode" },
      );
      return;
    }
    setWhatsNewVersion(document.source.version);
  }, []);

  const createWorkspaceTab = useCallback(
    (cwd: string, focus?: WorktreeFocus) => {
      const session = {
        ...newDefaultSession(cwd, newSessionRuntimeMode),
        ...(focus
          ? { executionCwd: focus.path, branch: focus.branch ?? undefined }
          : {}),
      };
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      return tab.id;
    },
    [appendTab, newSessionRuntimeMode],
  );

  const onNewInProject = useCallback(
    (cwd: string, options?: { reuseDraft?: boolean }) => {
      workspaceNavigation.cancel();
      const focus = worktreeFocus(cwd);
      const desiredExecutionCwd =
        focus?.path ?? cwd;
      const inPlace = (session: Session) =>
        sameProjectPath(session.cwd, cwd) &&
        sameProjectPath(sessionExecutionCwd(session), desiredExecutionCwd);
      // Composer launchers may opt into reusing an untouched draft to receive
      // their initial text. Explicit new-session actions return to an unsent
      // new conversation elsewhere instead of hiding it behind another one.
      const activeTab = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      const reusable = options?.reuseDraft
        ? sessionsRef.current.find(
            (session) => inPlace(session) && isReusableDraftSession(session),
          )
        : pendingNewSessionDraft(
            sessionsRef.current,
            tabsRef.current,
            (session) => inPlace(session) && !remoteSessionFor(session.id),
            activeTab?.focusedId,
          )?.session;
      if (reusable) {
        const hostTab = tabsRef.current.find((entry) =>
          leafIds(entry.layout).includes(reusable.id),
        );
        if (hostTab) {
          if (looksLikeProject(cwd)) {
            setProjectCwd(normalizeProjectPath(cwd));
            setRecents(rememberProject(cwd));
          }
          setSidebarTab("sessions", cwd);
          activateTab(hostTab.id, reusable.id);
          setComposerFocused(true);
          return reusable.id;
        }
      }
      const session = newWorkspaceSession(cwd, newSessionRuntimeMode);
      const tab = newTab(session.id);
      setSessions((previous) => [...previous, session]);
      appendTab(tab, cwd);
      if (looksLikeProject(cwd)) {
        setProjectCwd(normalizeProjectPath(cwd));
        setRecents(rememberProject(cwd));
      }
      setSidebarTab("sessions", cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
      return session.id;
    },
    [
      activateTab,
      appendTab,
      newSessionRuntimeMode,
      setSidebarTab,
      workspaceNavigation.cancel,
    ],
  );

  const onNew = useCallback(
    () => onNewInProject(sidebarCwd),
    [onNewInProject, sidebarCwd],
  );
  // The chat folder is created when the first message is sent.
  const onNewChat = useCallback(() => {
    onNewInProject("~");
    setProjectCwd("~");
  }, [onNewInProject]);

  const ensureContentTab = useCallback(
    (cwd: string) => {
      const target = contentTabTarget(
        tabsRef.current,
        sessionsRef.current,
        activeTabIdRef.current,
        cwd,
        previousTabs(),
      );
      if (target) {
        activateTab(target.id);
        return target;
      }
      let id = "";
      flushSync(() => {
        id = createWorkspaceTab(cwd);
      });
      activateTab(id);
      return tabsRef.current.find((tab) => tab.id === id)!;
    },
    [activateTab, createWorkspaceTab, previousTabs],
  );

  const onSelectRemoteSession = useCallback(
    (project: string, remoteSessionId: string) => {
      workspaceNavigation.cancel();
      setSidebarTab("sessions", project);
      if (looksLikeProject(project))
        setProjectCwd(normalizeProjectPath(project));
      const existing = tabsRef.current
        .map((tab) => ({
          tab,
          shellId: leafIds(tab.layout).find(
            (shellId) =>
              remoteSessionFor(shellId) === remoteSessionId &&
              sessionsRef.current.some(
                (session) =>
                  session.id === shellId &&
                  sameProjectPath(session.cwd, project),
              ),
          ),
        }))
        .find(({ shellId }) => shellId);
      if (existing) {
        activateTab(
          existing.tab.id,
          leafIds(existing.tab.layout).filter((id) =>
            sessionsRef.current.some((session) => session.id === id),
          ).length > 1
            ? existing.shellId
            : undefined,
        );
        return;
      }
      // Read the transcript while the new tab renders; its pane picks up this
      // request instead of starting its own after mounting.
      const remoteProject = remoteProjectFor(project);
      const machine =
        remoteProject && knownRemoteMachine(remoteProject.environmentId);
      if (machine)
        void preloadRemoteSession(machine.id, remoteSessionId).catch(
          () => undefined,
        );
      // Reserve a dedicated tab immediately. An apparently blank remote tab
      // may hold composer text or a create/upload that the host has not accepted.
      // Until the transcript arrives, the listed conversation names its own
      // agent instead of the new-conversation default.
      const listed = cachedRemoteSessionSummary(project, remoteSessionId);
      const shell = newDefaultSession(project, newSessionRuntimeMode);
      const session: Session = listed
        ? {
            ...shell,
            harness: listed.harness,
            ...(listed.model ? { model: listed.model } : {}),
            title: listed.title,
          }
        : shell;
      const tab = newTab(session.id);
      rememberRemoteSession(session.id, remoteSessionId, remoteProject);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, project);
      setActiveTabId(tab.id);
    },
    [
      activateTab,
      appendTab,
      newSessionRuntimeMode,
      setSidebarTab,
      workspaceNavigation.cancel,
    ],
  );

  const onStartInboxItem = useCallback(
    async (item: InboxItem, body?: string) => {
      const start = (description?: string) => {
        const cwd =
          item.projectPath || active?.cwd || sessionDefaults?.cwd || projectCwd;
        setSidebarTab("sessions", cwd);
        const ref =
          item.provider === "linear" || item.provider === "jira"
            ? item.identifier?.trim() || `#${item.number}`
            : `#${item.number}`;
        const linkedWorkItem = linkedWorkItemFromInboxItem(item);
        const session = {
          ...newDefaultSession(cwd, newSessionRuntimeMode),
          title: `${ref} ${item.title}`,
          inboxCard: inboxComposerCard(item, description),
          ...(linkedWorkItem ? { linkedWorkItem } : {}),
        };
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, cwd);
        setActiveTabId(tab.id);
        setComposerFocused(true);
      };

      start(await inboxTrackerDescription(item, body));
    },
    [
      active?.cwd,
      appendTab,
      sessionDefaults?.cwd,
      newSessionRuntimeMode,
      projectCwd,
    ],
  );

  const onAddNoteToChat = useCallback(
    (card: NoteComposerCard) => {
      if (!card.id) return;
      const cwd =
        (card.sourceCwd && looksLikeProject(card.sourceCwd)
          ? card.sourceCwd
          : undefined) ||
        active?.cwd ||
        sessionDefaults?.cwd ||
        projectCwd;
      setSidebarTab("sessions", cwd);
      const title = card.title.trim();
      const session = {
        ...newDefaultSession(cwd, newSessionRuntimeMode),
        ...(title ? { title } : {}),
        noteCard: card,
      };
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
    },
    [
      active?.cwd,
      appendTab,
      sessionDefaults?.cwd,
      newSessionRuntimeMode,
      projectCwd,
    ],
  );

  useEffect(() => {
    const onAdd = (event: Event) => {
      const card = (event as CustomEvent<NoteComposerCard>).detail;
      if (!card?.id) return;
      onAddNoteToChat(card);
    };
    window.addEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
  }, [onAddNoteToChat]);

  const onInboxCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.inboxCard
          ? { ...session, inboxCard: undefined }
          : session,
      ),
    );
  }, []);

  const setLinkedWorkItemUpdateCard = useCallback(
    (
      sessionId: string,
      update: (
        card: LinkedWorkItemUpdateCard | undefined,
      ) => LinkedWorkItemUpdateCard | undefined,
    ) => {
      const previous = sessionsRef.current;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const card = update(session.linkedWorkItemUpdateCard);
        return card === session.linkedWorkItemUpdateCard
          ? session
          : { ...session, linkedWorkItemUpdateCard: card };
      });
      if (!next.some((session, index) => session !== previous[index])) return;
      sessionsRef.current = next;
      setSessions(next);
    },
    [],
  );

  const onLinkedWorkItemUpdateCardDismiss = useCallback(
    (sessionId: string) => {
      setLinkedWorkItemUpdateCard(sessionId, () => undefined);
    },
    [setLinkedWorkItemUpdateCard],
  );

  const onNoteCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.noteCard
          ? { ...session, noteCard: undefined }
          : session,
      ),
    );
  }, []);

  const onHandoffCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.handoffCard
          ? { ...session, handoffCard: undefined }
          : session,
      ),
    );
  }, []);

  const {
    onSplit,
    onSplitSession,
    onFocusPane,
    onFocusDir,
    focusProjectTerminal,
    onMovePane,
    onMoveDockToPane,
    onMovePaneToDock,
    onToggleSessionTerminal,
    onPlaceSessionOnPane,
    onFitPaneLayout,
    onRatio,
  } = useWorkspacePaneActions({
    sessionsRef,
    tabsRef,
    activeTabIdRef,
    projectCwdRef,
    projectTerminalsRef,
    lastDockSideRef,
    setSessions,
    setTabs,
    setProjectTerminals,
    setProjectTerminalFocused,
    setComposerFocused,
    setActiveTabId,
    activeTab,
    activeTabId,
    projectCwd,
    sessionDefaults,
    newSessionRuntimeMode,
    inboxSessionId: inboxAskPortal?.sessionId,
    cancelNavigation: workspaceNavigation.cancel,
    ensureOpenSession: (id) => ensureOpenSession(id),
    canDiscardEmptySession,
    sessionData,
    tabCloseScope,
  });

  const {
    onNewTerminal,
    onToggleProjectTerminal,
    onNewTerminalTab,
    onCloseOtherProjectTerminals,
    onCloseProjectTerminal,
    onHideProjectTerminal,
    onOpenTerminal,
    onProjectTerminalSide,
    onProjectTerminalSize,
    onReorderProjectTerminals,
    onSelectProjectTerminal,
    onTerminalMetaChange,
  } = useProjectTerminalActions({
    projectCwdRef,
    setProjectTerminals,
    lastDockSideRef,
    focusProjectTerminal,
    terminalCwd,
    activeTab,
    sidebarCwd,
    appendTab,
    setActiveTabId,
    setComposerFocused,
    sessionsRef,
    sessionData,
    setSessions,
    setTabs,
    projectCwd,
    projectTerminalsRef,
    setProjectTerminalFocused,
    setLastDockSide,
  });

  const {
    onClosePane,
    onCloseTitleTab,
    onCloseOtherTabs,
    onCloseAllTabs,
    onCloseFile,
    onCloseOtherFiles,
    onRemoteSessionDeleted,
  } = useWorkspaceTabClosing({
    tabsRef,
    sessionsRef,
    tabCloseScope,
    tabWorktreeOf,
    fileState: files,
    persistSession,
    setTabs,
    activeTabIdRef,
    activateTab,
    refreshHistory,
    sidebarCwd,
    projectCwd,
    setSessions,
    setComposerFocused,
    activeTabId,
    notesEnabled,
    appPage,
    closeAppPage,
    tabs,
    tabWorkspace,
    projectCwdRef,
    activeTab,
  });

  /** Open tabs per workspace in the sidebar's project, keyed by worktree
   * path, so the switcher can show what each worktree still has open. */
  const nextWorktreeTabStats = useMemo(() => {
    const stats = new Map<string, { tabs: number; busy: boolean }>();
    if (!sidebarCwd || sidebarCwd === "~" || isRemoteProjectPath(sidebarCwd))
      return stats;
    for (const tab of filterTabsForProject(tabs, sessions, sidebarCwd)) {
      if (isAppViewOnlyTab(tab)) continue;
      const workspace = tabWorkspace(tab, sessions) ?? sidebarCwd;
      const key = pathKey(workspace);
      const entry = stats.get(key) ?? { tabs: 0, busy: false };
      entry.tabs += 1;
      entry.busy ||= leafIds(tab.layout).some(
        (id) => sessions.find((session) => session.id === id)?.busy,
      );
      stats.set(key, entry);
    }
    return stats;
  }, [tabs, sessions, sidebarCwd, tabWorkspace, workspaceNavigation.revision]);
  // Rebuilt on every streamed frame; the sidebar only cares when counts move.
  const worktreeTabStatsRef = useRef(nextWorktreeTabStats);
  if (
    !sameWorktreeTabStats(worktreeTabStatsRef.current, nextWorktreeTabStats)
  ) {
    worktreeTabStatsRef.current = nextWorktreeTabStats;
  }
  const worktreeTabStats = worktreeTabStatsRef.current;
  const nextDeckProjectTabs = useMemo(() => {
    // A projectless session belongs to no project, so it stands on its own
    // rather than trailing the last project's tabs.
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (
      active &&
      !isAppViewOnlyTab(active) &&
      !workspaceTabCwd(active, sessions)
    )
      return [active, ...tabs.filter(isAppViewOnlyTab)];
    // Each worktree keeps its own tabs; the others stay open, just hidden.
    const worktree = projectWorktree?.path ?? projectCwd;
    return filterTabsForProject(tabs, sessions, projectCwd).filter((tab) => {
      if (tab.id === activeTabId) return true;
      const workspace = tabWorkspace(tab, sessions);
      return !workspace || sameProjectPath(workspace, worktree);
    });
  }, [
    activeTabId,
    tabs,
    sessions,
    projectCwd,
    projectWorktree?.path,
    tabWorkspace,
    workspaceNavigation.revision,
  ]);
  // Rebuilt on every streamed frame; tab navigation callbacks key off it.
  const deckProjectTabsRef = useRef(nextDeckProjectTabs);
  if (!sameItems(deckProjectTabsRef.current, nextDeckProjectTabs)) {
    deckProjectTabsRef.current = nextDeckProjectTabs;
  }
  const deckProjectTabs = deckProjectTabsRef.current;

  const onNext = useCallback(() => {
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0)
      activateTab(deckProjectTabs[(index + 1) % deckProjectTabs.length].id);
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onPrev = useCallback(() => {
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0) {
      activateTab(
        deckProjectTabs[
          (index - 1 + deckProjectTabs.length) % deckProjectTabs.length
        ].id,
      );
    }
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onActivate = useCallback(
    (slot: number) => {
      const tab =
        slot < 0
          ? deckProjectTabs[deckProjectTabs.length - 1]
          : deckProjectTabs[slot];
      if (tab) activateTab(tab.id);
    },
    [activateTab, deckProjectTabs],
  );

  const onToggleChanges = useCallback(() => {
    setSidebarTab("changes");
  }, []);

  const focusOpenSession = useCallback(
    (sessionId: string) => {
      const tab = findOpenSessionTab(
        tabsRef.current,
        sessionsRef.current,
        sessionId,
      );
      if (!tab) return false;
      sessionData.evict(sessionId);
      const multipleChats =
        leafIds(tab.layout).filter((id) =>
          sessionsRef.current.some((session) => session.id === id),
        ).length > 1;
      activateTab(tab.id, multipleChats ? sessionId : undefined);
      return true;
    },
    [activateTab, sessionData],
  );

  const replaceBlankPaneWithSession = useCallback((session: Session) => {
    const tab =
      tabsRef.current.find((entry) => entry.id === activeTabIdRef.current) ??
      tabsRef.current[0];
    if (!tab) return false;

    // A blank conversation can already own open documents or an unsent draft.
    // Replacing it would transfer those surfaces to a different conversation.
    if (tabHasSessionResources(tab)) return false;

    const paneId = canDiscardEmptySession(tab.focusedId)
      ? tab.focusedId
      : leafIds(tab.layout).find((id) =>
          canDiscardEmptySession(id),
        );
    if (!paneId || paneId === session.id) return false;

    sessionData.resetPersistence(paneId);
    {
      const blank = sessionsRef.current.find((entry) => entry.id === paneId);
      if (blank) void forgetHarnessSession(blank.harness, paneId);
    }
    setSessions((prev) => {
      const next = prev.filter((entry) => entry.id !== paneId);
      return next.some((entry) => entry.id === session.id)
        ? next
        : [...next, session];
    });
    setTabs((prev) =>
      prev.map((entry) =>
        entry.id === tab.id
          ? {
              ...entry,
              layout: replaceLeafId(entry.layout, paneId, session.id),
              focusedId: session.id,
            }
          : entry,
      ),
    );
    setActiveTabId(tab.id);
    setComposerFocused(true);
    return true;
  }, [sessionData]);

  const ensureOpenSession = useCallback(
    async (sessionId: string): Promise<Session | null> => {
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (open) return open;

      const cancelOpening = sessionData.beginOpening(sessionId);
      const restored = await sessionData.load(sessionId);
      if (!restored || sessionData.isRemoving(sessionId)) {
        cancelOpening();
        void refreshHistory(sidebarCwd);
        return null;
      }
      sessionData.evict(sessionId);
      const appeared = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (appeared) return appeared;
      if (
        !sessionUsesHost(restored) &&
        !restored.worktreeRemoved &&
        restored.providerSessionId &&
        isLiveHarness(restored.harness)
      ) {
        bindHarnessSession(
          restored.harness,
          restored.id,
          restored.providerSessionId,
          sessionExecutionCwd(restored),
          restored.providerAccountId,
          restored.blocks,
          restored.nativeSession,
        );
      }
      sessionData.acknowledge(restored);
      if (!sessionsRef.current.some((session) => session.id === restored.id)) {
        const next = [...sessionsRef.current, restored];
        sessionsRef.current = next;
        setSessions(next);
      }
      return restored;
    },
    [sessionData, refreshHistory, sidebarCwd],
  );

  const onPrefetchHistorySession = sessionData.prefetch;

  const revealLinkedSessionUpdate = useCallback(
    (sessionId: string, update: LinkedSessionUpdate) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      if (!session?.linkedWorkItem) return;
      if (
        session.linkedWorkItemUpdateCard?.updatedAt === update.updatedAt &&
        session.linkedWorkItemUpdateCard.status !== "error"
      ) {
        return;
      }
      if (
        linkedWorkItemActivityFetches.current.get(sessionId) ===
        update.updatedAt
      ) {
        return;
      }
      const pending = pendingLinkedWorkItemUpdateCard(update);
      linkedWorkItemActivityFetches.current.set(sessionId, update.updatedAt);
      // A stale/error card should not remain visible while fresh details load.
      // The session itself is already open; this request stays fully detached
      // from the navigation path.
      setLinkedWorkItemUpdateCard(sessionId, (current) =>
        current?.updatedAt === update.updatedAt && current.status === "ready"
          ? current
          : undefined,
      );

      void githubWorkItemThread(
        session.cwd,
        session.linkedWorkItem.repo,
        session.linkedWorkItem.kind,
        session.linkedWorkItem.number,
        { force: true },
      ).then(
        (thread) => {
          if (
            linkedWorkItemActivityFetches.current.get(sessionId) !==
            pending.updatedAt
          ) {
            return;
          }
          linkedWorkItemActivityFetches.current.delete(sessionId);
          if (
            linkedSessionUpdatesRef.current.get(sessionId)?.updatedAt !==
            pending.updatedAt
          ) {
            return;
          }
          setLinkedWorkItemUpdateCard(sessionId, () =>
            completeLinkedWorkItemUpdateCard(pending, thread),
          );
        },
        () => {
          if (
            linkedWorkItemActivityFetches.current.get(sessionId) !==
            pending.updatedAt
          ) {
            return;
          }
          linkedWorkItemActivityFetches.current.delete(sessionId);
          if (
            linkedSessionUpdatesRef.current.get(sessionId)?.updatedAt !==
            pending.updatedAt
          ) {
            return;
          }
          setLinkedWorkItemUpdateCard(sessionId, () =>
            failLinkedWorkItemUpdateCard(pending),
          );
        },
      );
    },
    [setLinkedWorkItemUpdateCard],
  );

  const onAskInboxItem = useCallback(
    (item: InboxItem): Promise<string> => {
      const key = inboxAskKey(item);
      const pending = openingInboxSessions.current.get(key);
      if (pending) return pending;
      const opening = (async () => {
        let session = sessionsRef.current.find(
          (entry) => entry.inboxAsk?.key === key,
        );
        if (!session) {
          const candidate = item.projectPath || sidebarCwd;
          const cwd =
            candidate && candidate !== "~"
              ? candidate
              : await queryClient.fetchQuery({ queryKey: ["app", "defaultCwd"], queryFn: () => invoke<string>("default_cwd"), staleTime: Infinity });
          const description =
            item.provider === "linear" || item.provider === "jira"
              ? await inboxTrackerDescription(item)
              : item.provider === "gitlab" &&
                  (item.kind === "issue" || item.kind === "pr")
                ? (
                    peekGitlabWorkItemDetails(
                      item.repo,
                      item.kind,
                      item.number,
                    ) ??
                    (await gitlabWorkItemDetails(
                      item.repo,
                      item.kind,
                      item.number,
                    ))
                  ).body
                : item.provider === "azuredevops" &&
                    (item.kind === "issue" || item.kind === "pr")
                  ? (
                      peekAzureDevOpsWorkItemDetails(
                        item.repo,
                        item.kind,
                        item.number,
                      ) ??
                      (await azureDevOpsWorkItemDetails(
                        item.repo,
                        item.kind,
                        item.number,
                      ))
                    ).body
                  : undefined;
          session = {
            ...newDefaultSession(cwd),
            title: `Ask · ${item.title}`,
            inboxAsk: {
              key,
              title: item.title,
              url: item.url,
              provider: item.provider,
              description,
            },
          };
          sessionsRef.current = [...sessionsRef.current, session];
          setSessions(sessionsRef.current);
        }
        return session.id;
      })();
      openingInboxSessions.current.set(key, opening);
      void opening.then(
        () => openingInboxSessions.current.delete(key),
        () => openingInboxSessions.current.delete(key),
      );
      return opening;
    },
    [sidebarCwd],
  );

  const onRestartInboxAsk = useCallback(
    async (item: InboxItem): Promise<string> => {
      const id = await onAskInboxItem(item);
      const current = sessionsRef.current.find((session) => session.id === id)!;
      sessionData.beginRemoval(id);
      try {
        await stopSessionForRemoval(id);
        const stopped =
          sessionsRef.current.find((session) => session.id === id) ?? current;
        await Promise.all(
          sessionChildHarnesses(stopped).map((harness) =>
            forgetHarnessSession(harness, id),
          ),
        );
        const imagePaths = stopped.blocks.flatMap((block) =>
          block.role === "image" && block.image ? [block.image.path] : [],
        );
        await deleteSession(id, imagePaths);
        sessionData.forget(id);
        const fresh = {
          ...newSession(
            stopped.harness,
            stopped.cwd,
            stopped.model,
            stopped.runtimeMode,
            stopped.modelSettings,
          ),
          title: stopped.title,
          inboxAsk: stopped.inboxAsk,
        };
        const next = sessionsRef.current.map((session) =>
          session.id === id ? fresh : session,
        );
        sessionsRef.current = next;
        setSessions(next);
        setInboxAskPortal((portal) =>
          portal?.sessionId === id
            ? { ...portal, sessionId: fresh.id }
            : portal,
        );
        return fresh.id;
      } finally {
        sessionData.endRemoval(id);
      }
    },
    [onAskInboxItem, stopSessionForRemoval, sessionData],
  );

  useEffect(() => {
    if (!inboxAskPortal || !inboxVisible) return;
    setComposerFocused(true);
  }, [inboxAskPortal, inboxVisible]);

  const onSelectHistorySession = useCallback(
    async (
      sessionId: string,
      project?: string,
      opts?: { newColumn?: boolean; shouldNavigate?: () => boolean },
    ) => {
      if (opts?.shouldNavigate && !opts.shouldNavigate()) return;
      workspaceNavigation.cancel();
      let session = await ensureOpenSession(sessionId);
      if (opts?.shouldNavigate && !opts.shouldNavigate()) return;
      if (project && session && !sameProjectPath(session.cwd, project)) return;
      if (project) setSidebarTab("sessions", project);
      if (!session || session.inboxAsk) return;
      showWorkspace();
      const parentId =
        session.orchestrationLeadId ??
        orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        session = await ensureOpenSession(parentId);
        if (!session || (opts?.shouldNavigate && !opts.shouldNavigate())) return;
      }
      if (looksLikeProject(session.cwd))
        setProjectCwd(normalizeProjectPath(session.cwd));
      const linkedUpdate = linkedSessionUpdatesRef.current.get(session.id);
      if (focusOpenSession(session.id)) {
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      if (replaceBlankPaneWithSession(session)) {
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      const workspace = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      const anchor = workspace && anchorSessionId(workspace);
      if (opts?.newColumn && workspace && anchor) {
        const opened = session.id;
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === workspace.id
              ? {
                  ...entry,
                  layout: splitPane(entry.layout, anchor, "right", opened),
                  focusedId: opened,
                  diffFocused: false,
                }
              : entry,
          ),
        );
        setComposerFocused(true);
        if (linkedUpdate) revealLinkedSessionUpdate(opened, linkedUpdate);
        return;
      }
      const tab = newTab(session.id);
      appendTab(tab, session.cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
      if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
    },
    [
      appendTab,
      ensureOpenSession,
      focusOpenSession,
      replaceBlankPaneWithSession,
      revealLinkedSessionUpdate,
      setSidebarTab,
    ],
  );

  const openReminderSession = useCallback(
    async (sessionId: string) => {
      const session = await ensureOpenSession(sessionId);
      if (!session)
        throw new Error("This conversation is no longer available.");
      setPaletteOpen(false);
      setSidebarTab("sessions", session.cwd);
      setProjectCwd(session.cwd);
      setRecents(rememberProject(session.cwd));
      await onSelectHistorySession(sessionId);
    },
    [ensureOpenSession, onSelectHistorySession],
  );

  const ensureReminderSessionsSaved = useCallback(
    async (ids: readonly string[]) => {
      for (const id of ids) {
        const session = sessionsRef.current.find(
          (session) => session.id === id,
        );
        if (session && !(await upsertSession(session))) {
          throw new Error(
            "Send a message in this conversation before setting a reminder.",
          );
        }
      }
    },
    [],
  );

  const sessionReminders = useSessionReminders(
    openReminderSession,
    ensureReminderSessionsSaved,
    sessions
      .filter((session) => !session.inboxAsk)
      .map((session) => session.id),
  );

  const dismissNoticesForContinuedSession = useCallback(
    (sessionId: string) => {
      void sessionReminders.dismissDue(sessionId);
      const updatedAt = sessionsRef.current.find(
        (session) => session.id === sessionId,
      )?.linkedWorkItemUpdateCard?.updatedAt;
      if (updatedAt == null) return;
      markLinkedSessionUpdateSeen(sessionId, updatedAt);
      setLinkedWorkItemUpdateCard(sessionId, (card) =>
        card?.updatedAt === updatedAt ? undefined : card,
      );
    },
    [sessionReminders.dismissDue, setLinkedWorkItemUpdateCard],
  );

  const {
    checkOpenWorktreeFiles,
    onArchiveFocusedSession,
    onArchiveHistorySession,
    onDeleteHistorySession,
    onRenameHistorySession,
    onRemoveWorktree,
    onCheckWorktreeRemoval,
    onDeleteWorktreeSessions,
    onArchiveHistorySessions,
    onDeleteHistorySessions,
    onPinHistorySession,
    onPinHistorySessions,
    onSetHistorySessionLinkedWorkItem,
  } = useSessionHistoryActions({
    sessionsRef,
    sidebarCwd,
    titleCoordinator,
    sessionData,
    setSessions,
    tabsRef,
    projectTerminalsRef,
    removingWorktreePaths,
    navigation: workspaceNavigation,
    stopSessionForRemoval,
    projectCwdRef,
    setProjectCwd,
    setRecents,
    deleteConfirmationPending,
    setSessionDeleteDialog,
    tabCloseScope,
    activeTabIdRef,
    fileState: files,
    setTabs,
    activateTab,
    setComposerFocused,
    projectTerminalFocusedRef,
    appViewFocusedRef,
    paletteOpenRef,
    whatsNewVersionRef,
    setLinkedWorkItemPanels,
  });

  const {
    onBranchChange,
    onWorkspaceModeChange,
    onWorktreeBaseChange,
    onWorktreeChange,
    onComposerWorktreeChange,
  } = useSessionWorktreeActions({
    navigation: workspaceNavigation,
    sessionData,
    sessionsRef,
    setSessions,
    removingWorktreePaths,
    appendTab,
    setComposerFocused,
  });
  const {
    onCwdChange,
    onSelectWorkspace,
    onSelectProject,
    pickProject,
    projectSwitchPending,
  } = useProjectNavigation({
    navigation: workspaceNavigation,
    sessionsRef,
    tabsRef,
    activeTabIdRef,
    sidebarCwdRef,
    setSessions,
    setTabs,
    setProjectCwd,
    setRecents,
    setComposerFocused,
    canDiscardEmptySession,
    appendTab,
    insertBeside,
    projectOfTab,
  });

  const onRemoveProject = useCallback(
    (path: string, options: { purgeData: boolean }) => {
      const normalized = normalizeProjectPath(path);
      sessionData.removeProject(normalized);
      const wasCurrent = sameProjectPath(projectCwdRef.current, normalized);
      const remaining = options.purgeData
        ? forgetProject(normalized)
        : archiveProject(normalized);
      if (options.purgeData) {
        forgetProjectLocation(normalized);
        setSidebarTabSelection((current) =>
          sameProjectPath(current.project, normalized)
            ? { project: "~", tab: loadProjectSidebarTab("~") }
            : current,
        );
      }
      setRecents(remaining);

      const tabs = tabsRef.current;
      const sessions = sessionsRef.current;
      const projectTabs = filterTabsForProject(
        tabs,
        sessions,
        normalized,
      ).filter((tab) => !isAppViewOnlyTab(tab));
      const projectTabIds = new Set(projectTabs.map((tab) => tab.id));
      const projectSessions = sessions.filter((session) =>
        sameProjectPath(session.cwd, normalized),
      );
      const projectSessionIds = new Set(
        projectSessions.map((session) => session.id),
      );

      if (options.purgeData) {
        sessionData.invalidateAllLoads();
        for (const session of projectSessions) {
          sessionData.cancelSave(session.id);
          if (session.busy) {
            turnGen.current.set(
              session.id,
              (turnGen.current.get(session.id) ?? 0) + 1,
            );
            for (const id of sessionChildHarnesses(session)) {
              void cancelHarnessTurn(id, session.id);
            }
          }
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
          sessionData.resetPersistence(session.id);
        }
        projectRemoval.mutate(normalized);
      } else {
        for (const session of projectSessions) {
          if (session.busy) continue;
          if (shouldPersistSession(session)) {
            sessionData.retain(session);
          }
          persistSession(session);
          sessionData.cancelSave(session.id);
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
        }
      }

      let nextTabs = tabs.filter((tab) => !projectTabIds.has(tab.id));
      let nextSessions = sessions.filter((session) => {
        if (!projectSessionIds.has(session.id)) return true;
        return !options.purgeData && session.busy;
      });
      let nextActiveTabId = activeTabIdRef.current;

      if (nextTabs.length === 0) {
        const fallback = nextSessions[0];
        const session = newDefaultSession("~", fallback?.runtimeMode);
        const tab = newTab(session.id);
        nextSessions = [...nextSessions, session];
        nextTabs = [tab];
        nextActiveTabId = tab.id;
      } else if (projectTabIds.has(nextActiveTabId)) {
        nextActiveTabId = nextTabs[0]?.id ?? nextActiveTabId;
      }

      sessionsRef.current = nextSessions;
      tabsRef.current = nextTabs;
      activeTabIdRef.current = nextActiveTabId;
      setSessions(nextSessions);
      setTabs(nextTabs);
      if (nextActiveTabId !== activeTabId) {
        setActiveTabId(nextActiveTabId);
      }
      files.forgetDirtyFiles(projectTabs.flatMap((tab) => [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ]).map((file) => file.id));
      setProjectTerminals((prev) =>
        prev.filter((dock) => !sameProjectPath(dock.projectPath, normalized)),
      );

      if (wasCurrent) {
        const next = remaining.find((item) => looksLikeProject(item.path));
        if (next) {
          onSelectProject(next.path);
          setProjectCwd(next.path);
        } else {
          setProjectCwd("~");
          setComposerFocused(true);
        }
      }
    },
    [activeTabId, sessionData, onSelectProject, persistSession],
  );

  const onRestoreProject = useCallback(
    (path: string) => {
      setRecents(rememberProject(path));
      onSelectProject(path);
    },
    [onSelectProject],
  );

  const applyProjectLocationChange = useCallback(
    async (from: string, to: string) => {
      await sessionData.rebaseProject(from, to);
      rebaseCiRepairs(from, to);

      const nextSessions = sessionsRef.current.map((session) =>
        sameProjectPath(session.cwd, from) ? { ...session, cwd: to } : session,
      );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      if (sameProjectPath(projectCwdRef.current, from)) {
        projectCwdRef.current = to;
        setProjectCwd(to);
      }
      const nextDocks = projectTerminalsRef.current.map((dock) =>
        sameProjectPath(dock.projectPath, from)
          ? { ...dock, projectPath: to }
          : dock,
      );
      projectTerminalsRef.current = nextDocks;
      setProjectTerminals(nextDocks);
      rebaseProjectData(from, to);
      setSidebarTabSelection((current) =>
        sameProjectPath(current.project, from)
          ? { ...current, project: pathKey(to) }
          : current,
      );
      setRecents(replaceProjectPath(from, to));
      onFileMoved(from, to);
      notifyDirsChanged();
    },
    [onFileMoved, sessionData],
  );

  showFileExplorerRef.current = onShowFileExplorer;
  showChangesRef.current = (cwd) => onOpenAllChanges("unstaged", cwd);
  useEffect(() => {
    if (sidebarTab !== "files") return;
    onShowFileExplorer(sidebarCwd);
    setSidebarTab("sessions");
  }, [sidebarTab, sidebarCwd, onShowFileExplorer, setSidebarTab]);
  const {
    onSaveDraft,
    onModelChange,
    onModelSettingsChange,
    onRuntimeModeChange,
    onRemoveDraft,
  } = useSessionComposerActions({
    sessionsRef,
    setSessions,
    sessionData,
  });

  const { submitSession, onSubmit } = useSessionSubmission({
    sessionsRef,
    editedResends,
    flushHarnessEvents,
    enqueueHarnessEvent,
    sessionData,
    navigation: workspaceNavigation,
    removingWorktreePaths,
    setSessions,
    setProjectCwd,
    submitAfterProjectSyncRef,
    dismissNoticesForContinuedSession,
    projectLocationSyncs,
    applyProjectLocationChange,
    turnGen,
    titleCoordinator,
    activeSessionIdRef,
  });

  const { launchQuickSession, onInboxAppeared, launchAutomation } =
    useSessionLaunches({
      sessionsRef,
      setSessions,
      appendTab,
      setActiveTabId,
      setComposerFocused,
      focusOpenSession,
      setSidebarTab,
      submitSession,
      tabsRef,
      setTabs,
      setProjectCwd,
      setRecents,
      onSaveDraft,
    });

  const {
    onDeleteQueuedMessage,
    onReorderQueuedMessage,
    onSteerQueuedMessage,
    onResumeQueue,
    onUsageLimitResume,
    onUsageLimitResumeAtReset,
    onUsageLimitDismiss,
    onBuildPlan,
    onUpdatePlan,
  } = useSessionTurnActions({
    setSessions,
    sessionsRef,
    onSubmit,
    sessions,
    enqueueHarnessEvent,
    flushHarnessEvents,
  });

  const openSessionBeside = useCallback(
    (
      sourceId: string,
      session: Session,
      cwd: string,
      focusComposer = false,
    ) => {
      const nextSessions = [...sessionsRef.current, session];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);

      const tab = tabsRef.current.find((entry) =>
        leafIds(entry.layout).includes(sourceId),
      );
      if (tab) {
        const nextTabs = tabsRef.current.map((entry) =>
          entry.id === tab.id
            ? {
                ...entry,
                layout: splitPane(entry.layout, sourceId, "right", session.id),
                focusedId: session.id,
                diffFocused: false,
              }
            : entry,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        if (tab.id !== activeTabIdRef.current) setActiveTabId(tab.id);
      } else {
        const nextTab = newTab(session.id);
        appendTab(nextTab, cwd);
        setActiveTabId(nextTab.id);
      }

      setProjectTerminalFocused(false);
      setComposerFocused(focusComposer);
    },
    [appendTab],
  );

  const onForkSession = useCallback((source: Session) => {
    if (source.worktreeRemoved) return;
    openSessionBeside(source.id, forkSession(source), source.cwd, true);
  }, [openSessionBeside]);

  const onSecondOpinion = useCallback(
    (sourceId: string, target: ModelTarget, turn: Block[]) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sourceId,
      );
      if (!source || source.worktreeRemoved) return;
      const { harness, model, modelSettings } = target;
      const cwd = sessionExecutionCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const request = buildSecondOpinionRequest({
        from,
        to: harness,
        turn,
        cwd,
      });
      const session = {
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        executionCwd: source.executionCwd,
        branch: source.branch,
        modelSettings: mergeModelSettings(
          resolveModel(harness, model),
          modelSettings,
        ),
        title: formatSessionTitle(harness, SECOND_OPINION_TITLE),
        titleState: {
          source: "manual" as const,
          epoch: 0,
          purpose: "initial" as const,
          fallbackAttempted: false,
        },
      };
      openSessionBeside(sourceId, session, source.cwd);
      onSubmit(session.id, request.prompt, [], request.options);
    },
    [onSubmit, openSessionBeside],
  );

  const { onBtwSubmit, onBtwRetry, onBtwDelete, onBtwStop, onBtwModelChange } =
    useBtwConversations({
      sessions,
      sessionsRef,
      setSessions,
      persistSession,
    });

  const onHandoff = useCallback(
    (sourceId: string, target: ModelTarget, turn: Block[]) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sourceId,
      );
      if (!source || source.worktreeRemoved) return;
      const { harness, model, modelSettings } = target;
      const cwd = sessionExecutionCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const sliced = sessionThroughTurn(source, turn);
      const userRequest = turnUserRequest(turn);
      const files = turnEditedFiles(sliced.blocks, cwd);
      const display = sessionDisplayTitle(source.title, source.harness);
      const session = {
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        executionCwd: source.executionCwd,
        branch: source.branch,
        modelSettings: mergeModelSettings(
          resolveModel(harness, model),
          modelSettings,
        ),
        title: formatSessionTitle(
          harness,
          display === "New session" ? HANDOFF_TITLE : display,
        ),
        titleState: {
          source: "manual" as const,
          epoch: 0,
          purpose: "initial" as const,
          fallbackAttempted: false,
        },
        handoffCard: buildHandoffComposerCard({
          from,
          to: harness,
          brief: buildDeterministicHandoff(sliced),
          userRequest,
          files,
        }),
      };
      openSessionBeside(sourceId, session, source.cwd, true);
    },
    [openSessionBeside],
  );

  const autoContinueKey = sessions
    .filter(
      (session) => canAutoContinue(session) && isLiveHarness(session.harness),
    )
    .map((session) => session.id)
    .join("\n");

  useEffect(() => {
    if (!autoContinueKey) return;
    const ids = autoContinueKey.split("\n");
    // Delay past React StrictMode's dev remount so Continue is not claimed
    // against a discarded tree (sessionStorage also survives Vite reloads).
    const timer = window.setTimeout(() => {
      for (const id of ids) {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (
          !session ||
          !canAutoContinue(session) ||
          !isLiveHarness(session.harness)
        ) {
          continue;
        }
        onSubmit(id, CONTINUE_PROMPT);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoContinueKey, onSubmit]);

  const onCompactContext = useCallback(
    (sessionId: string) => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (current && sessionUsesHost(current))
        return remoteSessionActions(sessionId)?.compact() ?? false;
      if (!current || current.busy || current.worktreeRemoved) return false;
      if (!canCompactHarnessContext(current.harness)) {
        const unsupported = sessionsRef.current.map((session) =>
          session.id === sessionId
            ? applyHarnessEvent(session, {
                type: "status",
                text: `${HARNESS_TITLE[current.harness]} does not support manual context compaction.`,
              })
            : session,
        );
        sessionsRef.current = unsupported;
        syncDockBadge(unsupported);
        setSessions(unsupported);
        return true;
      }

      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const workCwd = sessionExecutionCwd(current);
      const started = sessionsRef.current.map((session) =>
        session.id === sessionId
          ? applyHarnessEvent(
              { ...session, busy: true },
              { type: "status", text: "Compacting context…" },
            )
          : session,
      );
      sessionsRef.current = started;
      syncDockBadge(started);
      setSessions(started);

      void (async () => {
        try {
          await compactHarnessContext({
            harness: current.harness,
            nativeSession: current.nativeSession,
            sessionId,
            cwd: workCwd,
            model: current.model,
            modelSettings: current.modelSettings,
            providerAccountId: supportsProviderAccounts(current.harness)
              ? (conversationProviderAccountId(current) ??
                selectedProviderAccountId(current.harness, current.cwd))
              : undefined,
            runtimeMode: current.runtimeMode,
            onEvent: (event) => {
              if (turnGen.current.get(sessionId) !== gen) return;
              enqueueHarnessEvent(sessionId, event);
            },
          });
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "Compacted context",
          });
        } catch (error: unknown) {
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "session.error",
            message:
              error instanceof Error
                ? error.message
                : `${current.harness} could not compact this context`,
          });
        } finally {
          if (turnGen.current.get(sessionId) !== gen) return;
          flushHarnessEvents();
          const finished = sessionsRef.current.map((session) =>
            session.id === sessionId ? { ...session, busy: false } : session,
          );
          sessionsRef.current = finished;
          syncDockBadge(finished);
          setSessions(finished);
        }
      })();
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents],
  );

  const onStop = useCallback(
    (sessionId: string, managed = false) => {
      titleCoordinator.current!.cancel(sessionId);
      const remote = sessionsRef.current.find((s) => s.id === sessionId);
      if (remote && sessionUsesHost(remote)) {
        remoteSessionActions(sessionId)?.stop();
        return;
      }
      if (!managed) {
        const stopping = orchestrator.stopForSession(sessionId);
        if (stopping) {
          void stopping.catch(console.error);
          return;
        }
      }
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      const cancelling = Promise.all(
        (session ? sessionChildHarnesses(session) : []).map((id) =>
          cancelHarnessTurn(id, sessionId),
        ),
      );
      // Record the turn's final workspace once its providers have stopped.
      if (session) {
        void finishSessionTurn(sessionId, sessionExecutionCwd(session), {
          after: cancelling.catch(() => undefined),
        }).catch(() => undefined);
      }
      void cancelling.catch(() => undefined);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const stopped = stopStreaming(s);
          const completed = isPreparingHandoff(stopped)
            ? completeHandoff(stopped, buildDeterministicHandoff(stopped))
            : stopped;
          const ready = { ...completed, worktreePreparing: undefined };
          return ready.queuedMessages?.length
            ? { ...ready, queueStatus: "paused" }
            : ready;
        }),
      );
      if (session) {
        notifyReviewChanged(sessionId);
        nudgeWorkspace(sessionExecutionCwd(session));
        notifyGitChanged();
        nudgeWatchedFiles();
        window.setTimeout(() => nudgeWatchedFiles(), 150);
      } else {
        notifyReviewChanged(sessionId);
      }
    },
    [flushHarnessEvents],
  );

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const inTerminal = Boolean(target?.closest(".omnicode-terminal"));
      const activeTabId = activeTabIdRef.current;
      const sessionId = focusedBusyAgentSessionId(
        activeTabId,
        tabsRef.current,
        sessionsRef.current,
        projectTerminalFocusedRef.current,
      );
      if (
        !sessionId ||
        !shouldStopFocusedTurnOnEscape(event, {
          inTerminal,
          focusedSessionBusy: true,
        })
      ) {
        return;
      }

      // Other surfaces (drag/reorder included) can claim Escape later in the
      // same keydown dispatch. Defer the destructive stop until every handler
      // has had a chance to preventDefault, then verify focus did not move.
      deferUnhandledEscape(event, () => {
        const stillFocusedSessionId = focusedBusyAgentSessionId(
          activeTabIdRef.current,
          tabsRef.current,
          sessionsRef.current,
          projectTerminalFocusedRef.current,
        );
        if (
          activeTabIdRef.current !== activeTabId ||
          stillFocusedSessionId !== sessionId
        ) {
          return;
        }
        onStop(sessionId);
      });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onStop]);

  const onApproval = useCallback(
    (sessionId: string, requestId: number, decision: ApprovalDecision) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      if (sessionUsesHost(session)) {
        remoteSessionActions(sessionId)?.approve(requestId, decision);
        return;
      }
      respondHarnessApproval(session.harness, sessionId, requestId, decision);
    },
    [],
  );

  const onQuestionReply = useCallback(
    (sessionId: string, requestId: number, reply: UserQuestionReply) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      if (sessionUsesHost(session)) {
        remoteSessionActions(sessionId)?.answer(requestId, reply);
        return;
      }
      respondHarnessQuestion(session.harness, sessionId, requestId, reply);
    },
    [],
  );

  const onQuestionInteraction = useCallback(
    (sessionId: string, requestId: number) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session && sessionUsesHost(session)) {
        remoteSessionActions(sessionId)?.keepQuestionOpen?.(requestId);
        return;
      }
      if (session && !session.worktreeRemoved)
        keepHarnessQuestionOpen(session.harness, sessionId, requestId);
    },
    [],
  );

  const onOpenApprovalSession = useCallback(
    (sessionId: string) => {
      const parentId =
        sessionsRef.current.find((session) => session.id === sessionId)
          ?.orchestrationLeadId ?? orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        if (!focusOpenSession(parentId)) void onSelectHistorySession(parentId);
      } else if (!focusOpenSession(sessionId)) {
        void onSelectHistorySession(sessionId);
      }
    },
    [focusOpenSession, onSelectHistorySession],
  );

  useEffect(() => {
    setSessions((prev) => attachOrchestrationWorkers(prev, orchestrationRuns));
  }, [orchestrationRuns]);

  useEffect(() => {
    const next = consolidateOrchestrationTabs(
      tabs,
      activeTabId,
      orchestrationRuns,
    );
    if (next.tabs !== tabs) setTabs(next.tabs);
    if (next.activeTabId !== activeTabId) setActiveTabId(next.activeTabId);
  }, [tabs, activeTabId, orchestrationRuns]);

  useOrchestrationBridge({
    sessionData,
    sessionsRef,
    setSessions,
    onStop,
    checkOpenWorktreeFiles,
    submitSession,
    flushHarnessEvents,
  });

  useEffect(() => {
    orchestrator.sync();
  }, [sessions]);

  useAgentAppBridge({
    launchQuickSession,
    submitSession,
    onSaveDraft,
    ensureOpenSession,
    sessionsRef,
  });

  const queueWorkerPanes = useCallback(
    (workers: OrchestrationWorkerDetail[]) => {
      // Finished workers are not open; load stored transcripts before the
      // tabs appear so the pane does not flash the empty state.
      void (async () => {
        const loaded = await Promise.all(
          workers
            .filter((worker) => worker.host)
            .map(async (worker) => {
              const source = worker.host!;
              const snapshot = await loadRemoteSession(
                source.machineId,
                source.sessionId,
              );
              if (
                snapshot.projectId !== source.project.projectId ||
                snapshot.session.orchestrationLeadId !== source.leadId
              )
                throw new Error(
                  "This worker does not belong to the selected orchestration run.",
                );
              return hostOrchestrationClient.desktopSession(source, snapshot);
            }),
        );
        if (loaded.length) {
          const ids = new Set(loaded.map((session) => session.id));
          const next = [
            ...sessionsRef.current.filter((session) => !ids.has(session.id)),
            ...loaded,
          ];
          sessionsRef.current = next;
          setSessions(next);
        }
        return prepareOrchestrationWorkerDetails(workers, {
          openLead: async (leadId) => {
            if (!focusOpenSession(leadId)) await onSelectHistorySession(leadId);
          },
          openWorker: ensureOpenSession,
          hasSession: (id) =>
            sessionsRef.current.some((session) => session.id === id),
        });
      })()
        .then((request) => {
          if (request?.workers.length) setWorkerDetailRequest(request);
        })
        .catch(console.error);
    },
    [ensureOpenSession, focusOpenSession, onSelectHistorySession],
  );
  const onOpenWorkerDetails = useCallback(
    (worker: OrchestrationWorkerDetail) => {
      setInspectedWorkerId(worker.sessionId);
      queueWorkerPanes([worker]);
    },
    [queueWorkerPanes],
  );
  useEffect(() => {
    if (!workerDetailRequest) return;
    const { leadId, workers } = workerDetailRequest;
    const tab = tabs.find((entry) => leafIds(entry.layout).includes(leadId));
    if (!tab) {
      // Still opening: this runs again on the commit that lands the lead. If
      // the lead never arrived at all, drop the request rather than let it
      // fire against some later tab change.
      if (!sessionsRef.current.some((entry) => entry.id === leadId)) {
        setWorkerDetailRequest(null);
      }
      return;
    }
    setWorkerDetailRequest(null);
    // Every agent of a run shares one pane, the way files do: `openEditorTab`
    // focuses an open tab, adds to the pane already beside the lead, or splits
    // one off when there is none.
    const cwd =
      sessionsRef.current.find((entry) => entry.id === leadId)?.cwd ??
      projectCwdRef.current;
    const files = workers.map((worker) =>
      newAgentTab(worker.title, cwd, {
        sessionId: worker.sessionId,
        leadId,
        harness: worker.harness,
      }),
    );
    setTabs((prev) =>
      prev.map((entry) => {
        if (entry.id !== tab.id) return entry;
        const opened = files.reduce(
          (next, file) => openEditorTab(next, file),
          entry,
        );
        // Leave the first worker focused so View agents lands on the start
        // of the run rather than the last tab added.
        return files[0] ? openEditorTab(opened, files[0]) : opened;
      }),
    );
    setActiveTabId(tab.id);
    setComposerFocused(false);
  }, [tabs, workerDetailRequest]);
  const { openSubagentTab, workflowProjects, workflowActivity, workflowApp } =
    useWorkflowRequests({
      tabs,
      tabsRef,
      setTabs,
      sessions,
      sessionsRef,
      recents,
      activeId: active?.id,
      activeAppView,
      setActiveTabId,
      setComposerFocused,
      onSubmit,
      focusOpenSession,
      onSelectHistorySession,
      onSelectRemoteSession,
      onNewInProject,
    });
  const orchestrationWorkers = useMemo(
    () => ({
      selectedId: inspectedWorkerId,
      inspect: setInspectedWorkerId,
      openDetails: onOpenWorkerDetails,
    }),
    [inspectedWorkerId, onOpenWorkerDetails],
  );
  const orchestrationActions = useMemo(
    () => ({
      canControl: false,
      open: onOpenApprovalSession,
      openAgents: queueWorkerPanes,
      update: () => {},
      confirm: async () => {
        throw new Error(
          translate("Connect to the Host before controlling this run."),
        );
      },
      retry: () => {},
    }),
    [onOpenApprovalSession, queueWorkerPanes],
  );

  tabProjectsRef.current = new Map(
    deckProjectTabs.map((tab) => [tab.id, tabProjectName(tab, sessions)]),
  );
  const {
    projectHistory,
    paletteSessions,
    sidebarHistory,
    treeHistory,
    inboxUnseen,
    linkedSessionUpdateIds,
    inboxRelatedSessions,
    repairSessions,
    sidebarOpenSessionIds,
    openProjectSessions,
  } = useWorkspaceSummaries({
    history,
    storedLinkedSessions,
    sessions,
    tabs,
    recents,
    sidebarCwd,
    projectBranches,
    orchestrationRuns,
    paletteOpen,
    onInboxAppeared,
    linkedSessionUpdatesRef,
  });

  const onToggleSidebar = useCallback(() => {
    // Saving synchronously notifies preference subscribers. Keep it outside a
    // React updater, and read the store so batched clicks see the latest action.
    saveSessionSidebarOpen(!loadSessionSidebarOpen());
    // A journal write can fail; only acknowledge the value the store accepted.
    setSessionSidebarOpen(loadSessionSidebarOpen());
  }, []);

  /** Quick Open: files by default, `>` commands, `#` sessions, `@` projects. */
  const [, setPaletteMode] = useQuickOpenMode();
  const openPalette = useCallback((query: string) => {
    void setPaletteMode(parseQuickOpenQuery(query).mode);
    setPaletteQuery(query);
    setPaletteToken((token) => token + 1);
    setPaletteOpen(true);
  }, [setPaletteMode]);
  const onGoToFile = useCallback(() => openPalette(""), [openPalette]);
  const onOpenCommandPalette = useCallback(
    () => openPalette(">"),
    [openPalette],
  );
  const onReload = useCallback(() => {
    void (async () => {
      if (!(await confirmReload(files.hasDirtyFiles()))) return;
      window.location.reload();
    })();
  }, []);

  const onFindInProject = useCallback(() => {
    saveSessionSidebarOpen(true);
    setSessionSidebarOpen(loadSessionSidebarOpen());
    setSidebarTab("files");
    setFilesSearchOpen(true);
    setSearchFocusToken((token) => token + 1);
  }, []);

  const onOpenLinkedWorkItem = useCallback(
    (item: LinkedWorkItem, sessionId: string) => {
      const request = linkedWorkItemPanelRequest.current + 1;
      linkedWorkItemPanelRequest.current = request;
      setPaletteOpen(false);
      const cwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        history.find((session) => session.id === sessionId)?.cwd ??
        sidebarCwd;
      void onSelectHistorySession(sessionId).then(() => {
        if (linkedWorkItemPanelRequest.current !== request) return;
        if (!sessionsRef.current.some((session) => session.id === sessionId)) {
          return;
        }
        setLinkedWorkItemPanels((current) => {
          const next = new Map(current);
          // Reinsert the panel so it wins if this workspace tab contains
          // multiple sessions with remembered panels.
          next.delete(sessionId);
          next.set(sessionId, { item, sessionId, cwd });
          return next;
        });
      });
    },
    [history, onSelectHistorySession, sidebarCwd],
  );

  const onLeaveInbox = closeAppPage;

  const onOpenInboxSession = useCallback(
    (sessionId: string) => {
      const cwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        history.find((session) => session.id === sessionId)?.cwd;
      setSidebarTab("sessions", cwd);
      void onSelectHistorySession(sessionId);
    },
    [history, onSelectHistorySession],
  );

  const onRepairChecks = useCallback(
    async (item: InboxItem, request: CiRepairRequest, sessionId?: string) => {
      const cwd = item.projectPath;
      if (!cwd) throw new Error("Choose a local project for this PR first.");
      let session = sessionId ? await ensureOpenSession(sessionId) : undefined;
      if (
        sessionId &&
        (!session ||
          session.inboxAsk ||
          session.orchestrationLeadId ||
          !sameProjectPath(session.cwd, cwd))
      ) {
        throw new Error("Choose a chat from this project.");
      }
      if (
        session &&
        (session.busy || session.pendingSwitch || isPreparingHandoff(session))
      ) {
        throw new Error(
          "This chat is busy. Choose another chat or start a new one.",
        );
      }
      if (!session) {
        session = {
          ...newDefaultSession(cwd, newSessionRuntimeMode),
          title: `Fix CI #${item.number}: ${item.title}`,
          linkedWorkItem: linkedWorkItemFromInboxItem(item) ?? undefined,
        };
        const next = [...sessionsRef.current, session];
        sessionsRef.current = next;
        setSessions(next);
      }
      const repairSessionId = session.id;
      trackCiRepair(cwd, request, repairSessionId, (settle) =>
        onSubmit(repairSessionId, request.text, [], {
          ciRepair: request,
          noteCard: undefined,
          handoffCard: undefined,
          onSettled: (outcome) => settle(outcome.status),
        }),
      );
      setSidebarTab("sessions", cwd);
      await onSelectHistorySession(session.id);
    },
    [
      ensureOpenSession,
      onSubmit,
      onSelectHistorySession,
      newSessionRuntimeMode,
    ],
  );

  const onOpenAutomationSession = useCallback(
    async (sessionId: string) => {
      const session = await ensureOpenSession(sessionId);
      if (!session)
        throw new Error("This conversation is no longer available.");
      setPaletteOpen(false);
      setSidebarTab("sessions", session.cwd);
      setProjectCwd(session.cwd);
      setRecents(rememberProject(session.cwd));
      await onSelectHistorySession(sessionId);
    },
    [ensureOpenSession, onSelectHistorySession],
  );

  const onOpenArchivedSession = useCallback(
    (sessionId: string) => {
      void onSelectHistorySession(sessionId);
    },
    [onSelectHistorySession],
  );

  const onRailBack = onVisitBack;
  const onRailForward = onVisitForward;
  useEffect(() => {
    if (!dockVisible) setProjectTerminalFocused(false);
  }, [dockVisible]);

  useEffect(() => {
    void invoke("set_traffic_lights_visible", { visible: true }).catch(
      () => {},
    );
  }, []);

  const onSessionNavigationOrder = useCallback(
    (ids: readonly string[]) => {
      sessionNavigationIdsRef.current = ids;
      sessionNavigationProjectRef.current = pathKey(sidebarCwd);
    },
    [sidebarCwd],
  );

  const onNavigateSessionList = useCallback(
    (delta: number, _inCurrentTab = false) => {
      const activeWorkspace = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      if (!activeWorkspace || activeWorkspace.diffFocused) return;
      const current =
        sessionsRef.current.find(
          (session) => session.id === activeWorkspace.focusedId,
        ) ??
        sessionsRef.current.find((session) =>
          leafIds(activeWorkspace.layout).includes(session.id),
        );
      if (
        !current ||
        sessionNavigationProjectRef.current !== pathKey(current.cwd)
      )
        return;
      const remoteProject =
        isRemoteProjectPath(current.cwd) || !!sessionUsesHost(current);
      const navigationId = remoteProject
        ? remoteSessionFor(current.id)
        : current.id;
      if (!navigationId) return;

      const next = adjacentItemId(
        sessionNavigationIdsRef.current,
        navigationId,
        delta,
      );
      if (!next || next === navigationId) return;
      if (remoteProject) {
        onSelectRemoteSession(current.cwd, next);
        return;
      }
      // Stepping gives no hover to warm the transcript, so load the one a
      // further step away once this switch has its own session.
      const prefetchAhead = () => {
        const ahead = adjacentItemId(
          sessionNavigationIdsRef.current,
          next,
          delta,
        );
        if (ahead && ahead !== current.id) onPrefetchHistorySession(ahead);
      };
      void onSelectHistorySession(next).then(prefetchAhead);
    },
    [onPrefetchHistorySession, onSelectHistorySession, onSelectRemoteSession],
  );

  const onNavigateProjectList = useCallback(
    (delta: number) => {
      const current = normalizeProjectPath(projectCwdRef.current);
      const ids = projectRailItems(loadRecents(), current).map(
        (project) => project.path,
      );
      const next = adjacentItemId(ids, current, delta);
      if (!next || sameProjectPath(next, current)) return;
      onSelectProject(next);
    },
    [onSelectProject],
  );

  const toggleAutosave = useCallback(() => {
    const next = saveAutosave(!loadAutosave());
    if (IS_MAC) void invoke("autosave_set_enabled", { enabled: next });
  }, []);

  const zoom = useCallback((direction: "in" | "out" | "reset") => {
    const next = saveUiScale(
      direction === "reset"
        ? UI_SCALE_DEFAULT
        : direction === "in"
          ? zoomInUiScale(loadUiScale())
          : zoomOutUiScale(loadUiScale()),
    );
    void applyUiScale(next);
  }, []);

  const commandHandlers: CommandHandlers = {
    "Tab: New": onNew,
    "Terminal: New": onNewTerminal,
    "App: New Window": () => void invoke("open_new_window").catch(() => {}),
    "App: Open Project": () => void pickProject(),
    "File: Autosave": toggleAutosave,
    "Pane: Close": appPage ? closeAppPage : () => onClosePane(),
    "Tab: Close": appPage
      ? closeAppPage
      : activeTabId
        ? () => onCloseTitleTab(activeTabId)
        : undefined,
    "Tab: Close Others": onCloseOtherTabs,
    "Tab: Close All": onCloseAllTabs,
    "Editor: Find": appPage ? undefined : () => void openFindInActiveEditor(),
    "Editor: Replace": appPage
      ? undefined
      : () => void openReplaceInActiveEditor(),
    "App: Find in Files": onFindInProject,
    "App: Command Palette": onOpenCommandPalette,
    "App: Search": onGoToFile,
    "View: Search Everywhere": () => onOpenSearch(),
    "App: Toggle Sidebar": onToggleSidebar,
    "View: Toggle Changes": sourceControlAvailable ? onToggleChanges : undefined,
    "Terminal: Toggle Dock": onToggleProjectTerminal,
    "View: Toggle Menu Bar": IS_MAC
      ? undefined
      : () => void saveMenuBarVisible(!loadMenuBarVisible()),
    "Pane: Split Right": appPage ? undefined : () => onSplit("right"),
    "Pane: Split Down": appPage ? undefined : () => onSplit("down"),
    "View: Inbox": onOpenInbox,
    "View: Notes": notesEnabled ? onOpenNotes : undefined,
    "View: Automations": onOpenAutomations,
    "View: Workflows": onOpenWorkflows,
    "App: Settings": () => openSettings(),
    "App: Switch Model": appPage
      ? undefined
      : () => window.dispatchEvent(new Event("open_model_picker")),
    "View: Zoom In": () => zoom("in"),
    "View: Zoom Out": () => zoom("out"),
    "View: Reset Zoom": () => zoom("reset"),
    "View: Reload": onReload,
    "Tab: Back": onVisitBack,
    "Tab: Forward": onVisitForward,
    "App: Go to File": onGoToFile,
    "Tab: Next": onNext,
    "Tab: Previous": onPrev,
    "Tab: Cycle Next": onNext,
    "Tab: Cycle Previous": onPrev,
    "Tab: Activate 1–8": (slot) => onActivate(Number(slot)),
    "Tab: Activate Last": () => onActivate(-1),
    "Session: Previous": () => onNavigateSessionList(-1),
    "Session: Next": () => onNavigateSessionList(1),
    "Session: Previous in Current Tab": () => onNavigateSessionList(-1, true),
    "Session: Next in Current Tab": () => onNavigateSessionList(1, true),
    "Project: Previous": () => onNavigateProjectList(-1),
    "Project: Next": () => onNavigateProjectList(1),
    "Pane: Focus Left": appPage ? undefined : () => onFocusDir("left"),
    "Pane: Focus Right": appPage ? undefined : () => onFocusDir("right"),
    "Pane: Focus Up": appPage ? undefined : () => onFocusDir("up"),
    "Pane: Focus Down": appPage ? undefined : () => onFocusDir("down"),
    "Terminal: New Tab": onNewTerminalTab,
    "Help: Keyboard Shortcuts": () => openSettings("keybindings"),
    "Help: What's New": () =>
      void readAppVersion().then((version) => onOpenWhatsNew(version)),
    "Help: Check for Updates": () => void runUpdateFlow(true),
    ...Object.fromEntries(
      Object.entries(HELP_URLS).map(([id, url]) => [
        id,
        () => void openUrl(url).catch(console.error),
      ]),
    ),
  };
  const dispatch = useCommandDispatcher(commandHandlers);

  useWorkspaceShortcuts({
    onArchiveFocusedSession,
    openSettings,
    onOpenApprovalSession,
    onSelectRemoteSession,
    dispatch,
    appViewFocusedRef,
    paletteOpenRef,
    whatsNewVersionRef,
    sessionsRef,
  });

  const lastRemoteSnapshot = useRef(new Map<string, HostSession>());
  const onRemoteSnapshot = useCallback(
    (shellId: string, snapshot?: HostSession) => {
      if (!snapshot) {
        lastRemoteSnapshot.current.delete(shellId);
        setSessions((current) =>
          current.map((entry) =>
            entry.id === shellId
              ? {
                  ...entry,
                  title: "New remote session",
                  blocks: [],
                  busy: false,
                }
              : entry,
          ),
        );
        return;
      }
      if (lastRemoteSnapshot.current.get(shellId) === snapshot) return;
      lastRemoteSnapshot.current.set(shellId, snapshot);
      setSessions((current) => {
        const shell = current.find((entry) => entry.id === shellId);
        if (!shell) return current;
        const project = remoteProjectFor(shell.cwd);
        if (!project) return current;
        return current.map((entry) =>
          entry.id === shellId
            ? remoteSessionState(entry, snapshot, project)
            : entry,
        );
      });
    },
    [],
  );

  const onManageWorktrees = useCallback(
    () => openSettings("worktrees"),
    [openSettings],
  );

  const onOpenOriginBot = useCallback(async (sessionId: string, origin: NonNullable<Block["origin"]>) => {
    const session = sessionsRef.current.find(item => item.id === sessionId);
    const project = session && remoteProjectFor(session.cwd);
    if (!project) throw new Error("Unavailable Bot");
    const machineId = project.local ? sharedHostMachineId() : (await remoteMachineFor(project.environmentId))?.id;
    if (!machineId) throw new Error("Unavailable Bot");
    const target = await resolveBotOrigin(origin, (method, params) => remoteRequest(machineId, method, params));
    if (target.threadId) selectBotThread(project.environmentId, { botId: target.bot.id, threadId: target.threadId });
    onOpenAssistant(machineId);
  }, [onOpenAssistant]);

  const sessionPaneProps = {
    onOpenBot: onOpenOriginBot,
    workspaceSwitchingSessionId: workspaceNavigation.pending
      ? active?.id
      : undefined,
    recents,
    hideProjectPicker: true,
    onFocus: onFocusPane,
    onClose: onClosePane,
    onCwdChange,
    onBranchChange,
    onWorktreeChange: onComposerWorktreeChange,
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
    onArchiveSession: onArchiveHistorySession,
    onDeleteSession: onDeleteHistorySession,
    onApproval,
    onQuestionReply,
    onQuestionInteraction,
    onOpenFile,
    onOpenDiff,
    onOpenPlan,
    onBuildPlan,
    onSecondOpinion,
    onForkSession,
    onHandoff,
    onBtwSubmit,
    onBtwRetry,
    onBtwDelete,
    onBtwStop,
    onBtwModelChange,
  };

  const changesPaneFiles = useMemo(() => {
    if (!activeTab) return [];
    const ids = new Set(leafIds(activeTab.layout));
    return activeTab.editorPanes.flatMap((pane) =>
      ids.has(pane.id)
        ? pane.files
            .filter((file) => file.changes || file.sessionChanges)
            .map((file) => ({ paneId: pane.id, fileId: file.id }))
        : [],
    );
  }, [activeTab]);
  const sessionHeaderActions = useMemo<SessionHeaderActions>(
    () => ({
      rename: (sessionId, title) => {
        void onRenameHistorySession(sessionId, title);
      },
      archive: (sessionId) => {
        void onArchiveHistorySession(sessionId, true);
      },
      splitRight: onSplitSession,
      terminalAvailable: supportsProjectTerminal(projectCwd),
      // Each chat in a split owns its terminal and files toggles.
      terminalSessionIds: sessionsWithToolPanes(activeTab, "terminal"),
      toggleTerminal: (sessionId) => {
        const session = sessionsRef.current.find((entry) => entry.id === sessionId);
        onToggleSessionTerminal(sessionId, session ? sessionExecutionCwd(session) : terminalCwd, session?.cwd);
      },
      filesSessionIds: sessionsWithToolPanes(activeTab, "files"),
      toggleFiles: (sessionId) => {
        const session = sessionsRef.current.find((entry) => entry.id === sessionId);
        if (!session?.cwd || session.cwd === "~") return;
        const owner = tabsRef.current.find((tab) => leafIds(tab.layout).includes(sessionId));
        const pane = owner && sessionToolPanes(owner, sessionId, "files")[0];
        if (pane) onClosePane(pane.id);
        else {
          onShowFileExplorer(session.cwd, sessionExecutionCwd(session), sessionId);
          setFilesSearchOpen(false);
        }
      },
      selectProviderAccount: onSelectProviderAccount,
      manageProviderAccounts: () =>
        openSettings("providers", "provider-accounts"),
      changesOpen: changesPaneFiles.length > 0,
      toggleChanges: () => {
        if (changesPaneFiles.length === 0) {
          onOpenAllChanges("unstaged");
          return;
        }
        for (const { paneId, fileId } of changesPaneFiles)
          onCloseFile(paneId, fileId);
      },
    }),
    [
      changesPaneFiles,
      activeTab,
      onClosePane,
      onShowFileExplorer,
      active?.id,
      sidebarTab,
      sidebarCwd,
      onFocusPane,
      onSplitSession,
      setSidebarTab,
      onArchiveHistorySession,
      onCloseFile,
      onOpenAllChanges,
      onRenameHistorySession,
      onSelectProviderAccount,
      onToggleSessionTerminal,
      terminalCwd,
      openSettings,
      projectCwd,
      sessionDefaults?.cwd,
      newSessionRuntimeMode,
    ],
  );

  const onDesktopModeChange = useCallback((mode: DesktopMode) => {
    const request = ++desktopModeRequestRef.current;
    if (mode === desktopMode && workspaceVisible && !activeAppView) return;
    workspaceNavigation.cancel();
    setPaletteOpen(false);
    closeAppDialog();
    setDesktopMode(mode);
    saveDesktopMode(mode, desktopLocationsRef.current);
    const target = desktopModeTarget(mode, desktopLocationsRef.current, tabsRef.current, sessionsRef.current);
    if (target) {
      setProjectCwd(target.cwd);
      activateTab(target.tabId, target.paneId ?? target.sessionId);
      showWorkspace();
      return;
    }
    const remembered = desktopLocationsRef.current[mode];
    const fallback = () => {
      if (mode === "chat") onNewChat();
      else { openAppView("projects"); setComposerFocused(false); }
    };
    if (remembered?.sessionId && history.some(session => session.id === remembered.sessionId)) {
      const originTab = activeTabIdRef.current;
      const originView = appViewFocusedRef.current;
      const current = () => desktopModeRequestRef.current === request &&
        activeTabIdRef.current === originTab && appViewFocusedRef.current === originView;
      void (async () => {
        try {
          const restored = await ensureOpenSession(remembered.sessionId!);
          if (!current()) return;
          if (!restored || restored.inboxAsk || desktopModeForCwd(restored.cwd) !== mode) { fallback(); return; }
          await onSelectHistorySession(restored.id, restored.cwd, { shouldNavigate: current });
        } catch {
          if (current()) fallback();
        }
      })();
    } else fallback();
  }, [desktopMode, workspaceVisible, activeAppView, workspaceNavigation.cancel, activateTab, history, ensureOpenSession, onSelectHistorySession, onNewChat, closeAppDialog, showWorkspace, openAppView]);
  const onNewDesktopSession = useCallback(() => {
    if (desktopMode === "chat") onNewChat();
    else if (desktopModeForCwd(sidebarCwd) === "code") onNew();
    else {
      const cwd = desktopLocationsRef.current.code?.cwd;
      if (cwd) onNewInProject(cwd);
      else openAppView("projects");
    }
  }, [desktopMode, sidebarCwd, onNewChat, onNew, onNewInProject, openAppView]);

  const renderAppView = createWorkspacePageRenderer({
    desktopMode,
    sidebarCwd,
    recents,
    closeAppPage,
    onSelectProject,
    pickProject,
    onNewChat,
    onRemoveProject,
    onRestoreProject,
    assistantMachineId,
    onSelectHistorySession,
    onSelectRemoteSession,
    gitCwd,
    projectHistory,
    sessions,
    searchViewFocusToken,
    searchQueryRequest,
    onLeaveSearch,
    closeAppDialog,
    onOpenFile,
    onLeaveInbox,
    onStartInboxItem,
    onAskInboxItem,
    onRestartInboxAsk,
    setInboxAskPortal,
    inboxRelatedSessions,
    repairSessions,
    onRepairChecks,
    onOpenInboxSession,
    onOpenInboxIntegrations,
    projectCwd,
    onLeaveNotes,
    onLeaveAutomations,
    launchAutomation,
    onOpenAutomationSession,
    settingsSection,
    settingsAnchor,
    notificationProjectPath,
    notificationSettingsRequest,
    sidebarHistory,
    onRemoveWorktree,
    onCheckWorktreeRemoval,
    onDeleteWorktreeSessions,
    onCloseSettings,
    onSelectSettingsSection,
    onOpenArchivedSession,
    onArchiveHistorySession,
    onDeleteHistorySession,
    onOpenWhatsNew,
  });

  const {
    desktopModeToggle,
    activityBarProps,
    manualUpdateOpen,
    setManualUpdateOpen,
    sidebarFooter,
    sidebarNavigation,
    sidebarWorkflows,
    surfaceModeToggle,
    titlebarNavigation,
    updateStatus,
    windowLeading,
  } = useWorkspaceChrome({
    desktopMode,
    onDesktopModeChange,
    activeTab,
    sessions,
    workspaceVisible,
    setTabs,
    activeAppView,
    assistantMachineId,
    onOpenAssistant,
    sidebarCwd,
    recents,
    active,
    onGoToFile,
    onOpenInbox,
    notesEnabled,
    onOpenNotes,
    onOpenSettings,
    onOpenAutomations,
    onOpenWorkflows,
    appPage,
    inboxUnseen,
    onOpenNotificationSettings,
    updateNotice,
    onOpenWhatsNew,
    setUpdateNotice,
    onNewDesktopSession,
    openAppView,
    onSelectHistorySession,
  });
  return {
    active,
    activeAppView,
    desktopMode,
    desktopModeToggle,
    onDesktopModeChange,
    onNewDesktopSession,
    activeLinkedWorkItemPanel,
    activeSessionId,
    activeTab,
    activeTabId,
    activityBarProps,
    appDialog,
    appPage,
    appPageHostRef,
    approvalSessionIds,
    approvalToasts,
    busySessionIds,
    closeAppDialog,
    closeLinkedWorkItemPanel,
    commandHandlers,
    composerFocusToken,
    composerFocused,
    currentProjectDock,
    dirtyFiles,
    dispatch,
    editorNavigations,
    explorerRootLabel,
    failedProjectPaths,
    fileErrorCounts,
    filesCwd,
    filesSearchOpen,
    focusProjectTerminal,
    gitCwd,
    harnessUpdateHeight,
    historyFailed,
    historyPending,
    inboxAskPortal,
    inboxVisible,
    lastDockSide,
    linkedSessionUpdateIds,
    linkedWorkItemPanels,
    loadedProjects,
    manualUpdateOpen,
    menuBarPinned,
    navigationExpanded,
    notesEnabled,
    onApproval,
    onArchiveHistorySession,
    onArchiveHistorySessions,
    onCloseFile,
    onCloseOtherFiles,
    onCloseOtherProjectTerminals,
    onCloseProjectTerminal,
    onDeleteHistorySession,
    onDeleteHistorySessions,
    onFileDeleted,
    onFileDirtyChange,
    onFileErrorCountChange,
    onFileMoved,
    onFindInProject,
    onGoToFile,
    onHideProjectTerminal,
    onMoveDockToPane,
    onMovePane,
    onMovePaneToDock,
    onNew,
    onNewChat,
    onNewInProject,
    onNewTerminal,
    onOpenApprovalSession,
    onOpenFile,
    onOpenInboxSession,
    onOpenLinkedWorkItem,
    onOpenNotificationSettings,
    onOpenSessionFile,
    onOpenTerminal,
    onPinFile,
    onPinHistorySession,
    onPinHistorySessions,
    onPlaceSessionOnPane,
    onPrefetchHistorySession,
    onProjectTerminalSide,
    onProjectTerminalSize,
    onRailBack,
    onRailForward,
    onRatio,
    onFitPaneLayout,
    onRemoteSessionDeleted,
    onRemoveProject,
    onRenameHistorySession,
    onReorderFiles,
    onReorderProjectTerminals,
    onRepairChecks,
    onSearchEverywhere,
    onSelectFileSurface,
    onSelectHistorySession,
    onSelectProject,
    onSelectProjectTerminal,
    onSelectRemoteSession,
    onSelectWorkspace,
    onSessionNavigationOrder,
    onSetHistorySessionLinkedWorkItem,
    onTerminalMetaChange,
    onToggleNavigation,
    onToggleSidebar,
    onUpdatePlan,
    openFilePaths,
    openProjectSessions,
    openSettings,
    openSubagentTab,
    orchestrationActions,
    orchestrationWorkers,
    paletteOpen,
    paletteQuery,
    paletteSessions,
    paletteToken,
    pickProject,
    projectCwd,
    projectSwitchPending,
    projectTerminalFocused,
    projectTerminals,
    providerSignInRequest,
    questionSessionIds,
    recents,
    refreshHistory,
    reminderNoticesHeight,
    remoteProjectDialogOpen,
    newEnvironmentDialogOpen,
    renderAppView,
    repairSessions,
    searchFocusToken,
    sessionDeleteDialog,
    sessionHeaderActions,
    sessionPaneProps,
    sessionReminders,
    sessionSidebarOpen,
    sessions,
    setFilesSearchOpen,
    setHarnessUpdateHeight,
    setManualUpdateOpen,
    setPaletteOpen,
    setProviderSignInRequest,
    setReminderNoticesHeight,
    setRemoteProjectDialogOpen,
    setNewEnvironmentDialogOpen,
    setSessionDeleteDialog,
    setSidebarTab,
    setWhatsNewVersion,
    sidebarCwd,
    sidebarFooter,
    sidebarHistory,
    sidebarNavigation,
    sidebarOpenSessionIds,
    sidebarTab,
    sidebarWorkflows,
    sourceControlAvailable,
    surfaceModeToggle,
    tabVisitNav,
    tabs,
    titlebarNavigation,
    transcriptPool,
    treeHistory,
    unseenFinishedIds,
    updateStatus,
    whatsNewVersion,
    windowLeading,
    workflowActivity,
    workflowApp,
    workflowProjects,
    workspaceNavigation,
    workspaceVisible,
    worktreeTabStats,
  };
}

export type WorkspaceViewModel = ReturnType<typeof useWorkspaceController>;
