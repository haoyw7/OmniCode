import { createPortal } from "react-dom";
import { AppPageHeaderPortalContext } from "../features/workspace/ui/AppPageHeader";
import { windowDragRegion } from "./shell/startWindowDrag";
import type { SidebarProps } from "./shell/Sidebar.types";
import { PresenceBoundary } from "../shared/ui/PresenceBoundary";
import { translate } from "../shared/i18n/language";
import {
WorkflowAppContext
} from "../features/workflows/ui/workflowAppContext";
import {
WorkflowActivityContext
} from "../features/workflows/model/workflowActivity";
import { WorkflowProjectsContext } from "../features/workflows/kit/store/TabStoreProvider";
import {
AppViewHost,
AppViewRendererContext
} from "../features/workspace/ui/AppViewHost";
import {
OrchestrationActions,
OrchestrationWorkers
} from "../features/orchestration/ui/OrchestrationActions";
import {
useState, type CSSProperties
} from "react";
import { Sidebar } from "./shell/Sidebar";
import { PaneSurfaceSlots, type PaneSurfaceSlot } from "../shared/ui/PaneSurfaceSlots";
import { BackgroundTasksPane, BackgroundTasksClearButton } from "../features/sessions/ui/BackgroundTasksPanel";
import { DesktopTitlebarNavigation } from "./shell/DesktopNavigation";
import { WindowMenuButton } from "./shell/WindowMenuButton";
import { SidebarMain } from "./shell/SidebarMain";
import { GradientBlurBackground } from "../features/settings/ui/GradientBlurBackground";
import { ApprovalToasts } from "../features/sessions/ui/ApprovalToasts";
import { HarnessUpdateNotice } from "../features/providers/ui/HarnessUpdateNotice";
import { WhatsNewDialog } from "./shell/WhatsNewDialog";
import { ProviderSignInDialog } from "../features/sessions/ui/ProviderSignInDialog";
import { WindowDragBar,WINDOW_DRAG_BAR_HEIGHT } from "./shell/WindowChrome";
import { LAYER } from "../shared/lib/layers";
import { MENU_BAR_HEIGHT,MenuBar } from "./shell/MenuBar";
import {
commandShortcutLabel,paletteCommands
} from "./commands/registry";
import { QuickOpen } from "../features/search/ui/QuickOpen";
import { HarnessIcon } from "../features/sessions/ui/HarnessIcon";
import {
DeleteSessionDialog
} from "../features/sessions/ui/DeleteSessionDialog";
import {
HAS_NATIVE_GLASS,IS_MAC
} from "../platform/tauri/platform";
import { UpdateAvailableDialog } from "./shell/UpdateAvailableDialog";
import {
appViewTitle,
APP_PAGE_KINDS,leafIds
} from "../features/workspace/model/layout";


import {
looksLikeProject
} from "../features/projects/model/recents";
import { AppViewDialog } from "../features/workspace/ui/AppViewDialog";
import {
SessionHeaderActionsContext
} from "../features/workspace/ui/SessionHeaderActions";

import {
TranscriptPoolOutlet
} from "../features/sessions/ui/TranscriptPool";
import { ReminderNotices } from "../features/sessions/ui/ReminderNotices";

import { PaneTree } from "../features/workspace/ui/PaneTree";
import { SessionPane } from "../features/sessions/ui/SessionPane";
import { SubagentTabsContext } from "../features/sessions/ui/SubagentTabsContext";
import { SessionSurface } from "../features/sessions/ui/SessionSurface";
import { TerminalDockLayout } from "./shell/TerminalDockLayout";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";
import {
prefetchRemoteProjectSessions
} from "../features/connections/model/connections";
import { AddRemoteProjectDialog } from "../features/connections/ui/AddRemoteProjectDialog";
import { NewEnvironmentDialog } from "../features/connections/ui/NewEnvironmentDialog";

import { tabIsOneCard } from "./model/workspaceSelectors";
import { LinkedWorkItemPanel } from "./ui/workspaceSurfaces";
import type { WorkspaceViewModel } from "./controller/useWorkspaceController";
import { SessionPageCountsContext, useSessionPageCounts } from "./shell/sessions/sessionPageCounts";

const prefetchRemoteHistory = (path: string) => prefetchRemoteProjectSessions(path).then(() => undefined);
const paneSurfaceSlots: Record<string, PaneSurfaceSlot> = {
  backgroundTasks: {
    content: (sessionId, visible) => <BackgroundTasksPane sessionId={sessionId} visible={visible} />,
    actions: sessionId => <BackgroundTasksClearButton sessionId={sessionId} />,
  },
};

/** Workspace window layout. Pure view over the controller's view-model. */
export function AppView({ vm }: { vm: WorkspaceViewModel }) {
  const {
    desktopMode,
    desktopModeToggle,
    active,
    activeAppView,
    activeLinkedWorkItemPanel,
    activeSessionId,
    activeTab,
    activeTabId,
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
    surfaceModeToggle,
    tabVisitNav,
    tabs,
    titlebarNavigation,
    transcriptPool,
    treeHistory,
    unseenFinishedIds,
    updateStatus,
    whatsNewVersion,
    workflowActivity,
    workflowApp,
    workflowProjects,
    workspaceNavigation,
    workspaceVisible,
    worktreeTabStats,
  } = vm;
  const sessionPageCounts = useSessionPageCounts(tabs);

  const [sessionHeaderHost, setSessionHeaderHost] = useState<HTMLDivElement | null>(null);
  const [pageHeaderHost, setPageHeaderHost] = useState<HTMLDivElement | null>(null);
  const liftPageHeader = (appPage === "inbox" || appPage === "notes" || appPage === "automations" || appPage === "workflows") && !appDialog && !menuBarPinned;
  const activeLeaves = activeTab ? leafIds(activeTab.layout) : [];
  const singleConversation = activeLeaves.filter(id => sessions.some(session => session.id === id)).length === 1;
  // Full view lifts only the chat's tool toggles; its tabs stay in the pane.
  const liftSessionHeader = workspaceVisible && !appDialog && !menuBarPinned &&
    singleConversation;

  const sidebarProps: SidebarProps = {
    navigation: sidebarNavigation,
    footer: sidebarFooter,
    workflowsSection: sidebarWorkflows,
    recents: recents,
    onSelectProject: onSelectProject,
    onOpenProject: pickProject,
    onRemoveProject: onRemoveProject,
    onOpenNotificationSettings: onOpenNotificationSettings,
    projectHistory: treeHistory,
    loadedProjectPaths: loadedProjects,
    failedProjectPaths: failedProjectPaths,
    onLoadProject: refreshHistory,
    onPrefetchRemoteProject: prefetchRemoteHistory,
    onNewInProject: onNewInProject,
    cwd: sidebarCwd,
    gitCwd: gitCwd,
    worktreeTabStats: worktreeTabStats,
    onSelectWorkspace: onSelectWorkspace,
    workspaceSwitchPending: workspaceNavigation.pending?.project === sidebarCwd,
    workspaceSwitchError: workspaceNavigation.error?.project === sidebarCwd
                      ? workspaceNavigation.error.message
                      : undefined,
    explorerRootLabel: explorerRootLabel,
    open: sessionSidebarOpen,
    chromeInMenuBar: true,
    onToggleSidebar: onToggleSidebar,
    tab: sidebarTab,
    onTabChange: setSidebarTab,
    filesSearchOpen: filesSearchOpen,
    onFilesSearchOpenChange: setFilesSearchOpen,
    onOpenFilesSearch: onFindInProject,
    searchFocusToken: searchFocusToken,
    sessions: sidebarHistory,
    busySessionIds: busySessionIds,
    approvalSessionIds: approvalSessionIds,
    questionSessionIds: questionSessionIds,
    activeSessionId: active?.id,
    visibleSessionId: activeSessionId ?? null,
    status: historyFailed ? "error" : "idle",
    pending: historyPending,
    onSelectSession: onSelectHistorySession,
    onSelectRemoteSession: onSelectRemoteSession,
    onRemoteSessionDeleted: onRemoteSessionDeleted,
    onPrefetchSession: onPrefetchHistorySession,
    onSessionNavigationOrder: onSessionNavigationOrder,
    onPlaceSessionOnPane: onPlaceSessionOnPane,
    onRenameSession: onRenameHistorySession,
    onArchiveSession: onArchiveHistorySession,
    onArchiveSessions: onArchiveHistorySessions,
    onPinSession: onPinHistorySession,
    onPinSessions: onPinHistorySessions,
    onSetSessionLinkedWorkItem: onSetHistorySessionLinkedWorkItem,
    reminders: sessionReminders.reminders,
    onSetReminders: sessionReminders.schedule,
    onCancelReminders: sessionReminders.cancel,
    onDeleteSession: onDeleteHistorySession,
    onDeleteSessions: onDeleteHistorySessions,
    onOpenFile: onOpenFile,
    onOpenTerminal: onOpenTerminal,
    onFileMoved: onFileMoved,
    onFileDeleted: onFileDeleted,
    onNew: onNew,
    onNewChat: onNewChat,
    openSessions: openProjectSessions,
    openSessionIds: sidebarOpenSessionIds,
    onOpenInboxItem: onOpenLinkedWorkItem,
    onGoToFile: onGoToFile,
    unseenFinishedIds: unseenFinishedIds,
    linkedSessionUpdateIds: linkedSessionUpdateIds,
  };
  const desktopTitlebarNavigation = (
    <DesktopTitlebarNavigation
      menu={<WindowMenuButton handlers={commandHandlers} dispatch={dispatch} />}
      modeToggle={desktopModeToggle}
      canGoBack={tabVisitNav.canBack}
      canGoForward={tabVisitNav.canForward}
      onGoBack={onRailBack}
      onGoForward={onRailForward}
      onTogglePanel={onToggleSidebar}
      panelActive={sessionSidebarOpen}
    />
  );

  return (
    <WorkflowAppContext.Provider value={workflowApp}>
    <SubagentTabsContext.Provider value={openSubagentTab}>
    <WorkflowProjectsContext.Provider value={workflowProjects}>
    <WorkflowActivityContext.Provider value={workflowActivity}>
    <OrchestrationActions.Provider value={orchestrationActions}>
      <OrchestrationWorkers.Provider value={orchestrationWorkers}>
        <AppViewRendererContext.Provider value={renderAppView}>
          <SessionHeaderActionsContext.Provider value={sessionHeaderActions}>
          <PaneSurfaceSlots.Provider value={paneSurfaceSlots}>
            <div
              data-desktop-mode={desktopMode}
              className={`app-shell-root desktop-workspace relative flex h-full flex-col text-content ${
                HAS_NATIVE_GLASS
                  ? "bg-background-base/40"
                  : "bg-background-base"
              }`}
              style={
                {
                  "--menu-bar-h": menuBarPinned
                    ? `${MENU_BAR_HEIGHT}px`
                    : "0px",
                } as CSSProperties
              }
            >
              <div aria-hidden className="window-chat-background">
                <GradientBlurBackground />
              </div>

              <div
                data-window-chrome
                className="relative shrink-0"
                style={{ zIndex: LAYER.windowChrome, pointerEvents: "auto" }}
              >
                {!IS_MAC ? (
                  <MenuBar
                    windowNavigationWidth="calc(var(--desktop-sidebar-chrome-width, var(--desktop-sidebar-width)) - var(--desktop-sidebar-inset))"
                    windowNavigation={desktopTitlebarNavigation}
                    navigationItems={titlebarNavigation}
                    handlers={commandHandlers}
                    dispatch={dispatch}
                    canGoBack={tabVisitNav.canBack}
                    canGoForward={tabVisitNav.canForward}
                    sidebarOpen={sessionSidebarOpen}
                    navigationExpanded={navigationExpanded}
                    onToggleNavigation={undefined}
                    windowActions={surfaceModeToggle}
                  />
                ) : null}
                {!menuBarPinned ? (
                  <WindowDragBar
                    windowLeading={liftSessionHeader ? (
                      <div
                        ref={setSessionHeaderHost}
                        data-window-session-header={activeTabId}
                        className="min-w-0 flex-1"
                      />
                    ) : liftPageHeader ? (
                      <div ref={setPageHeaderHost} data-window-page-header={appPage} className="min-w-0 flex-1" />
                    ) : undefined}
                    windowNavigation={desktopTitlebarNavigation}
                    navigationItems={titlebarNavigation}
                    canGoBack={tabVisitNav.canBack}
                    canGoForward={tabVisitNav.canForward}
                    onGoBack={onRailBack}
                    onGoForward={onRailForward}
                    onTogglePanel={onToggleSidebar}
                    panelActive={sessionSidebarOpen}
                    navigationExpanded={navigationExpanded}
                    onToggleNavigation={undefined}
                    windowActions={surfaceModeToggle}
                  />
                ) : null}
              </div>

              <div className="relative isolate flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <SessionPageCountsContext.Provider value={sessionPageCounts}>
                  <Sidebar {...sidebarProps} desktopMode={desktopMode} />
                </SessionPageCountsContext.Provider>

                <SidebarMain open={sessionSidebarOpen}>
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <main
                      data-project-switching={projectSwitchPending || undefined}
                      aria-busy={projectSwitchPending || undefined}
                      className="project-switch-surface relative flex min-h-0 min-w-0 flex-1"
                    >
                      {APP_PAGE_KINDS.filter(
                        (kind) => kind !== "notes" || notesEnabled,
                      ).map((kind) => (
                        <div
                          key={kind}
                          data-app-page={kind}
                          ref={appPage === kind ? appPageHostRef : undefined}
                          tabIndex={-1}
                          hidden={appPage !== kind}
                          aria-hidden={appPage !== kind}
                          inert={
                            appPage !== kind || appDialog !== null || undefined
                          }
                          className={
                            appPage === kind
                              ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none focus-visible:focus-fill"
                              : "hidden"
                          }
                        >
                          <AppPageHeaderPortalContext.Provider value={kind === appPage && liftPageHeader && pageHeaderHost
                            ? (header) => createPortal(<div {...windowDragRegion()}>{header}</div>, pageHeaderHost)
                            : null}>
                            <AppViewHost
                              kind={kind}
                              visible={appPage === kind && appDialog === null}
                              focused={appPage === kind && appDialog === null}
                            />
                          </AppPageHeaderPortalContext.Provider>
                        </div>
                      ))}
                      <div
                        data-workspace-content
                        hidden={!workspaceVisible}
                        aria-hidden={!workspaceVisible}
                        inert={!workspaceVisible || undefined}
                        className={
                          workspaceVisible
                            ? "relative flex min-h-0 min-w-0 flex-1"
                            : "hidden"
                        }
                      >
                        <SurfaceVisibilityContext.Provider
                          value={workspaceVisible}
                        >
                          <TerminalDockLayout
                            projectTerminals={projectTerminals}
                            currentDock={currentProjectDock}
                            projectCwd={projectCwd}
                            workspaceVisible={workspaceVisible}
                            lastDockSide={lastDockSide}
                            focused={projectTerminalFocused}
                            onFocus={focusProjectTerminal}
                            onHide={onHideProjectTerminal}
                            onSideChange={onProjectTerminalSide}
                            onSizeCommit={onProjectTerminalSize}
                            onAddTerminal={onNewTerminal}
                            onSelectTerminal={onSelectProjectTerminal}
                            onCloseTerminal={onCloseProjectTerminal}
                            onCloseOtherTerminals={onCloseOtherProjectTerminals}
                            onReorderTerminals={onReorderProjectTerminals}
                            onTerminalMetaChange={onTerminalMetaChange}
                            onMoveToPane={onMoveDockToPane}
                          >
                            <div
                              className="relative flex min-h-0 min-w-0 flex-row"
                              style={{
                                gridArea: "main",
                              }}
                            >
                              <div className="relative min-h-0 min-w-0 flex-1">
                                {tabs.map((tab) => (
                                  <div
                                    key={tab.id}
                                    data-workspace-tab={tab.id}
                                    data-active={String(tab.id === activeTabId)}
                                    aria-hidden={tab.id !== activeTabId}
                                    className={
                                      tab.id === activeTabId
                                        ? "absolute inset-0 flex h-full min-h-0 flex-col"
                                        : "hidden"
                                    }
                                  >
                                    <div
                                      className={`flex min-h-0 min-w-0 flex-1 flex-col ${
                                        // One card for a lone pane or a chat's
                                        // unified view; split views card each
                                        // column on a gutter (see PaneTree).
                                        tabIsOneCard(tab, sessions)
                                          ? "pane-card mb-1 mr-1"
                                          : "h-full"
                                      }`}
                                    >
                                      <PaneTree
                                        {...sessionPaneProps}
                                        sessionHeaderHost={liftSessionHeader && tab.id === activeTabId ? sessionHeaderHost : null}
                                        visible={
                                          workspaceVisible &&
                                          tab.id === activeTabId
                                        }
                                        surfaceMode={tab.surfaceMode ?? "split"}
                                        autoArrangeTools={tab.autoArrangeTools}
                                        onOpenSessionFile={onOpenSessionFile}
                                        onOpenFileTerminal={onOpenTerminal}
                                        onFileMoved={onFileMoved}
                                        onFileDeleted={onFileDeleted}
                                        filesSearchOpen={tab.id === activeTabId && filesSearchOpen}
                                        onFilesSearchOpenChange={setFilesSearchOpen}
                                        layout={tab.layout}
                                        sessions={sessions}
                                        editorPanes={[
                                          ...tab.editorPanes,
                                          ...(tab.terminalPanes ?? []),
                                        ]}
                                        dirtyFileIds={dirtyFiles}
                                        fileErrorCounts={fileErrorCounts}
                                        focusedId={
                                          workspaceVisible &&
                                          tab.id === activeTabId &&
                                          !tab.diffFocused &&
                                          !projectTerminalFocused
                                            ? tab.focusedId
                                            : ""
                                        }
                                        addToChatSessionId={
                                          tab.id === activeTabId
                                            ? active?.id
                                            : undefined
                                        }
                                        composerFocused={
                                          workspaceVisible &&
                                          composerFocused &&
                                          !projectTerminalFocused
                                        }
                                        composerFocusToken={composerFocusToken}
                                        onSelectFile={onSelectFileSurface}
                                        onCloseFile={onCloseFile}
                                        onCloseOtherFiles={onCloseOtherFiles}
                                        onPinFile={onPinFile}
                                        onReorderFiles={onReorderFiles}
                                        onFileDirtyChange={onFileDirtyChange}
                                        onFileErrorCountChange={
                                          onFileErrorCountChange
                                        }
                                        transcriptPool={transcriptPool}
                                        onFitLayout={(previous, next) => onFitPaneLayout(tab.id, previous, next)}
                                        onRatio={(splitId, index, ratio) =>
                                          onRatio(tab.id, splitId, index, ratio)
                                        }
                                        editorNavigation={
                                          editorNavigations[tab.id] &&
                                          (!editorNavigations[tab.id]
                                            .ownerSessionId ||
                                            leafIds(tab.layout).includes(
                                              editorNavigations[tab.id]
                                                .ownerSessionId!,
                                            ))
                                            ? editorNavigations[tab.id].target
                                            : null
                                        }
                                        onUpdatePlan={onUpdatePlan}
                                        onMovePane={onMovePane}
                                        onMovePaneToDock={onMovePaneToDock}
                                        onTerminalMetaChange={
                                          onTerminalMetaChange
                                        }
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </TerminalDockLayout>
                          {[...linkedWorkItemPanels.values()].map((panel) => (
                            <LinkedWorkItemPanel
                              repairSessions={repairSessions}
                              onRepairChecks={onRepairChecks}
                              onOpenSession={(sessionId) => {
                                closeLinkedWorkItemPanel(panel.sessionId);
                                onOpenInboxSession(sessionId);
                              }}
                              key={panel.sessionId}
                              target={panel.item}
                              cwd={panel.cwd}
                              recents={recents}
                              visible={
                                !activeAppView &&
                                activeLinkedWorkItemPanel?.sessionId ===
                                  panel.sessionId
                              }
                              onClose={() =>
                                closeLinkedWorkItemPanel(panel.sessionId)
                              }
                            />
                          ))}
                        </SurfaceVisibilityContext.Provider>
                      </div>
                    </main>
                  </div>
                  <div className="hidden" aria-hidden>
                    {sessions
                      .filter((session) => session.inboxAsk)
                      .map((session) => {
                        const visible =
                          inboxVisible &&
                          inboxAskPortal?.sessionId === session.id;
                        return (
                          <SessionSurface
                            key={session.id}
                            host={visible ? inboxAskPortal.host : undefined}
                          >
                            <SurfaceVisibilityContext.Provider value={visible}>
                              <SessionPane
                                {...sessionPaneProps}
                                session={session}
                                visible={visible}
                                focused={visible}
                                inSplit={false}
                                composerFocused={visible && composerFocused}
                                composerFocusToken={composerFocusToken}
                              />
                            </SurfaceVisibilityContext.Provider>
                          </SessionSurface>
                        );
                      })}
                  </div>
                </SidebarMain>
              </div>

              {paletteOpen ? (
                <QuickOpen
                  renderSessionIcon={(harness) => <HarnessIcon harness={harness} className="size-4" />}
                  key={paletteToken}
                  open
                  cwd={filesCwd}
                  openPaths={openFilePaths}
                  initialQuery={paletteQuery}
                  commands={paletteCommands(commandHandlers)}
                  commandShortcut={commandShortcutLabel}
                  sessions={paletteSessions}
                  recents={recents}
                  currentProject={
                    looksLikeProject(sidebarCwd) ? sidebarCwd : null
                  }
                  onOpenFile={onOpenFile}
                  onRunCommand={(id) => void dispatch(id)}
                  onOpenSession={(sessionId) =>
                    void onSelectHistorySession(sessionId)
                  }
                  onOpenProject={onSelectProject}
                  onAddProject={() => void dispatch("App: Open Project")}
                  onSearchEverywhere={onSearchEverywhere}
                  onClose={() => setPaletteOpen(false)}
                />
              ) : null}

              <PresenceBoundary>{appDialog ? (
                <AppViewDialog
                  title={translate(appViewTitle(appDialog))}
                  onClose={closeAppDialog}
                  topInset={
                    menuBarPinned ? MENU_BAR_HEIGHT : WINDOW_DRAG_BAR_HEIGHT
                  }
                >
                  {renderAppView(appDialog, true)}
                </AppViewDialog>
              ) : null}</PresenceBoundary>
              <PresenceBoundary>{sessionDeleteDialog && (
                <DeleteSessionDialog
                  title={sessionDeleteDialog.title}
                  unusedWorktree={sessionDeleteDialog.unusedWorktree}
                  onClose={(choice) => {
                    sessionDeleteDialog.resolve(choice);
                    setSessionDeleteDialog(undefined);
                  }}
                />
              )}</PresenceBoundary>
              <HarnessUpdateNotice
                topOffset={
                  12 + (reminderNoticesHeight ? reminderNoticesHeight + 8 : 0)
                }
                onHeightChange={setHarnessUpdateHeight}
              />
              <ApprovalToasts
                notices={approvalToasts}
                focusedSessionId={
                  workspaceVisible ? activeTab?.focusedId : undefined
                }
                topOffset={
                  12 +
                  (reminderNoticesHeight ? reminderNoticesHeight + 8 : 0) +
                  (harnessUpdateHeight ? harnessUpdateHeight + 8 : 0)
                }
                onFocusSession={onOpenApprovalSession}
                onApproval={onApproval}
              />
              <ReminderNotices
                reminders={sessionReminders.due}
                error={sessionReminders.error}
                onOpen={sessionReminders.open}
                onSnooze={sessionReminders.schedule}
                onDismiss={sessionReminders.cancel}
                onRetry={sessionReminders.refresh}
                onOpenSettings={() => openSettings("general", "notifications")}
                onHeightChange={setReminderNoticesHeight}
              />
              <PresenceBoundary>{manualUpdateOpen && updateStatus.actionable ? (
                <UpdateAvailableDialog
                  snapshot={updateStatus.snapshot}
                  onInstall={updateStatus.install}
                  onSkip={() => {
                    setManualUpdateOpen(false);
                    updateStatus.skipVersion();
                  }}
                  onClose={() => setManualUpdateOpen(false)}
                />
              ) : null}</PresenceBoundary>
              <PresenceBoundary>{whatsNewVersion ? (
                <WhatsNewDialog
                  version={whatsNewVersion}
                  onClose={() => setWhatsNewVersion(null)}
                />
              ) : null}</PresenceBoundary>
              <PresenceBoundary>{remoteProjectDialogOpen ? (
                <AddRemoteProjectDialog
                  onCancel={() => setRemoteProjectDialogOpen(false)}
                  onOpen={(key) => {
                    setRemoteProjectDialogOpen(false);
                    onSelectProject(key);
                  }}
                />
              ) : null}</PresenceBoundary>
              <PresenceBoundary>{newEnvironmentDialogOpen ? (
                <NewEnvironmentDialog
                  onClose={() => setNewEnvironmentDialogOpen(false)}
                  onOpen={(key) => {
                    setNewEnvironmentDialogOpen(false);
                    onSelectProject(key);
                  }}
                />
              ) : null}</PresenceBoundary>
              <PresenceBoundary>{providerSignInRequest ? (
                <ProviderSignInDialog
                  key={providerSignInRequest.key}
                  harness={providerSignInRequest.harness}
                  onClose={() => setProviderSignInRequest(null)}
                />
              ) : null}</PresenceBoundary>
            </div>
            <TranscriptPoolOutlet pool={transcriptPool} />
          </PaneSurfaceSlots.Provider>
          </SessionHeaderActionsContext.Provider>
        </AppViewRendererContext.Provider>
      </OrchestrationWorkers.Provider>
    </OrchestrationActions.Provider>
    </WorkflowActivityContext.Provider>
    </WorkflowProjectsContext.Provider>
    </SubagentTabsContext.Provider>
    </WorkflowAppContext.Provider>
  );
}
