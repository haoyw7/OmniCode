import { Omi } from "../../shared/ui/branding/Omi";
import { Button } from "../../shared/ui/forms/Button";
import { IconButton } from "../../shared/ui/forms/IconButton";
import { MobileSpinner } from "../MobileSpinner";
import { saveConnectionAppearance } from "../connectionAppearance";
import { delegateSession } from "../../features/bots/model/delegateSession";
import { MobileEmpty } from "../MobileEmpty";
import {
  ArrowLeft,
  Chatting,
  ChevronDown,
  Computer,
  Folder,
  FolderPlus,
  Info,
  MoreVertical,
  PanelLeft,
  RefreshCw,
  Search,
  X,
} from "../../shared/ui/icons";
import { MobileSessionTranscript, MobileSessionContextRing, MobileSnapshotActions, MobileSnapshotStatus } from "../MobileSessionViews";
import { MobileDraftComposer } from "../MobileDraftComposer";
import { MobileSheet, SHEET_WIDTH } from "../MobileSheet";
import { MobileDrawer } from "../MobileDrawer";
import { isChatFolder } from "../../features/projects/model/chatFolderPath";
import { MobileHome } from "../MobileHome";
import { MobileHomeMenu } from "../MobileHomeMenu";
import { MobileHeaderSearch } from "../MobileHeaderSearch";
import { mobileSettingsParent } from "../mobileSettingsRoutes";
import { mobileWorkspacePending } from "../hostWorkspace";
import { SharedStateStatus } from "../../features/settings/ui/SharedStateStatus";
import { MobileHostStatus } from "../MobileHostStatus";
import { MobileDeviceChips } from "../MobileDeviceChips";
import { MobileHostUnavailable } from "../MobileHostUnavailable";
import { loadLastOnline } from "../lastOnline";
import { setUiLanguage, translate } from "../../shared/i18n/language";
import { nativeProviderLabel, nativeSyncNotice, type NativeSessionAccess } from "../../integrations/harness/core/nativeSessions";
import { saveFollowUpBehavior } from "../../features/settings/model/settings";
import { applyAccentColor, saveAccentColor, saveTranscriptAnchor, saveTranscriptLayout } from "../../features/settings/model/appearance";
import { saveSoundsEnabled } from "../../features/settings/model/sounds";
import { saveGlassSettings } from "../glassSettings";
import { saveThemePreference } from "../../features/settings/model/appearance";
import { MobilePageOverlay, MobilePageTransition } from "../MobilePageTransition";
import { MobileOverlayHostContext } from "../MobileOverlayHost";
import { MobileSheetPresence } from "../MobileSheetPresence";
import { SurfaceVisibilityContext } from "../../shared/ui/SurfaceVisibility";
import { GradientBlurBackground } from "../../features/settings/ui/GradientBlurBackground";

import { lazyMobilePage, lazyMobileSheet } from "../mobileLazy";
import { saveMobileSkin } from "../theme/skin";
import { browseHostDirectories, client, type MobileAppViewModel } from "./useMobileAppController";

const MobileSettings = lazyMobilePage(async () => ({ default: (await import("../MobileSettings")).MobileSettings }));
const MobileNotes = lazyMobilePage(async () => ({ default: (await import("../MobileNotes")).MobileNotes }));
const MobileBots = lazyMobilePage(async () => ({ default: (await import("../MobileBots")).MobileBots }));
const MobileAgentDefaults = lazyMobilePage(async () => ({ default: (await import("../MobileAgentDefaults")).MobileAgentDefaults }));
const MobileProviderAccounts = lazyMobilePage(async () => ({ default: (await import("../MobileProviderAccounts")).MobileProviderAccounts }));
const MobileSharedConnections = lazyMobilePage(async () => ({ default: (await import("../MobileSharedConnections")).MobileSharedConnections }));
const MobileArchive = lazyMobilePage(async () => ({ default: (await import("../MobileArchive")).MobileArchive }));
const MobileConnectionSheet = lazyMobileSheet(async () => ({ default: (await import("../MobileConnectionSheet")).MobileConnectionSheet }));
const MobileProjectPicker = lazyMobileSheet(async () => ({ default: (await import("../MobileProjectPicker")).MobileProjectPicker }));
const MobileHostPicker = lazyMobileSheet(async () => ({ default: (await import("../MobileHostPicker")).MobileHostPicker }));

function nativeAccessNotice(access: NativeSessionAccess | undefined): string {
  if (access === undefined)
    return translate("Checking whether this conversation is open elsewhere…");
  if (access.reason === "hostUnavailable")
    return translate("Unable to check native session access. Reconnect to the Host to continue.");
  const holder = access.holder;
  if (holder && access.state === "external")
    return translate(
      "Open in {provider} (pid {pid}) on the computer. Close it there to continue here.",
      { provider: nativeProviderLabel(holder.provider), pid: holder.pid },
    );
  if (holder && access.reason === "ambiguousProcess")
    return translate(
      "{provider} is running in this project (pid {pid}) on the computer and may be using this conversation. Close it to continue here.",
      { provider: nativeProviderLabel(holder.provider), pid: holder.pid },
    );
  if (access.reason === "anotherOmniCode")
    return translate("OmniCode desktop is using this conversation. Try again when it finishes.");
  if (access.reason === "unsupportedPlatform")
    return translate("Native session ownership cannot be verified on this platform. Imported history is read-only.");
  return translate("Native session access could not be confirmed. Saved history keeps syncing; check other clients before continuing here.");
}
export function MobileAppView({ vm }: { vm: MobileAppViewModel }) {
  const {
    aboutOpen,
    aboutTrigger,
    accentColor,
    activity,
    addProject,
    addingConnection,
    addingProject,
    allProjectsPage,
    animateFrom,
    appUpdates,
    assistantPage,
    assistantRpc,
    assistantUnreadCount,
    attachments,
    backgroundEffect,
    backgroundPath,
    busy,
    catalog,
    catalogLoading,
    changeSettingsPage,
    chatSupported,
    composerPanel,
    composerQueue,
    composerWorkspace,
    configuration,
    connect,
    connected,
    connectionAppearance,
    connectionKey,
    connectionName,
    connectionRevision,
    connectionTrigger,
    deviceConnections,
    dispatch,
    draft,
    drawerOpen,
    error,
    floatingHeader,
    followUpBehavior,
    foreground,
    forgetConnection,
    gitSource,
    glass,
    header,
    historyLoading,
    homeChats,
    homeMenuOpen,
    homeMenuTrigger,
    homeOverview,
    homePageOpen,
    homeProject,
    homeRefreshKey,
    homeScope,
    homeUnavailable,
    hostError,
    hostPickerOpen,
    hostPickerTrigger,
    hostScopeReady,
    hostStatus,
    initialRestorePending,
    interceptSearchOutside,
    language,
    loadSkillCatalog,
    loading,
    nativeAccess,
    nativeReadOnly,
    navigate,
    navigationReady,
    notesOpen,
    notesPage,
    now,
    onCachedSessions,
    onComposerConfiguration,
    onComposerExpand,
    onComposerFiles,
    onComposerProject,
    onComposerRemoveAttachment,
    onComposerSend,
    onComposerStop,
    onDrawerAllProjects,
    onDrawerAssistant,
    onDrawerHome,
    onDrawerHost,
    onDrawerLoadSessions,
    onDrawerNewSession,
    onDrawerNotes,
    onDrawerOpenChange,
    onDrawerProject,
    onDrawerSession,
    onDrawerSessionActions,
    onDrawerSettings,
    onDrawerSummaryActions,
    onNewChat,
    onNoteAddToChat,
    onQuestionOpenChange,
    onRemoteProject,
    onRemoteSession,
    onTranscriptCommand,
    onTranscriptOverlayChange,
    openAddProject,
    openAddConnection,
    openChats,
    openHome,
    openProject,
    openSession,
    overlayHost,
    pageOverlayOpen,
    pairedConnections,
    pairing,
    pairingError,
    pairingSuccess,
    pending,
    placeholder,
    planDecision,
    planDecisionOpen,
    planMode,
    pollError,
    preferencePanel,
    probeHost,
    probeSavedHost,
    progressDock,
    project,
    projectBackground,
    projectBackgroundStyle,
    projectTrigger,
    projects,
    projectsPending,
    projectsUnavailable,
    questionOpen,
    readingAttachments,
    readHostImage,
    reconnect,
    remoteHosts,
    resolveNoteImage,
    route,
    running,
    searchOpen,
    searchQuery,
    searchTrigger,
    sendingMessage,
    sessionActionsOpen,
    sessionActionsPoint,
    sessionActionsSummary,
    sessionActionsTarget,
    sessionActionsTrigger,
    sessionChangesSource,
    sessionConfirmed,
    sessionEntrySource,
    sessionId,
    sessionStatusOpen,
    sessionStatusTrigger,
    sessions,
    setAboutOpen,
    setAccentColor,
    setAddingConnection,
    setAddingProject,
    setAppRoot,
    closeBots,
    botResume,
    openBotSession,
    backToBot,
    setComposerPanel,
    setDrawerOpen,
    setFollowUpBehavior,
    setGlass,
    setHomeActionSession,
    setHomeMenuOpen,
    setHomeScope,
    setHostPickerOpen,
    setNotesOpen,
    setPairingError,
    setPlanMode,
    setPreferencePanel,
    setProgressDock,
    setSearchOpen,
    setSearchQuery,
    setSkin,
    setSessionActionsOpen,
    setSessionActionsPoint,
    setSessionActionsTarget,
    setSessionStatusOpen,
    setSoundsEnabled,
    setTheme,
    setToken,
    setTranscriptAnchor,
    setTranscriptLayout,
    setUrl,
    settingsPage,
    settingsReturnView,
    sharedStateError,
    skillContextKey,
    snapshot,
    skin,
    snapshotStore,
    soundsEnabled,
    switchHost,
    t,
    theme,
    title,
    toggleHomeSearch,
    token,
    transcriptAnchor,
    transcriptKeys,
    transcriptLayout,
    transcriptSessionId,
    updateSessionMetadata,
    url,
    view,
    worktreeCreation,
  } = vm;
  const noticeError = !addingConnection && !homeUnavailable
    ? error || hostError || sharedStateError || pollError ||
      (hostStatus.state === "failed" ? hostStatus.detail || t("Connection failed") : "")
    : "";
  // A journal entry also exists during a healthy send. Only offer recovery
  // after the active request settles; its sending bubble already shows progress.
  const showPendingNotice = !!pending && connected && !busy;
  return (
    <MobileOverlayHostContext.Provider value={overlayHost}>
    <div
      ref={setAppRoot}
      className="mobile-app"
      data-view={view}
      onPointerDownCapture={(event) => interceptSearchOutside(event, false)}
      onClickCapture={(event) => interceptSearchOutside(event, true)}
      onContextMenuCapture={(event) => interceptSearchOutside(event, true)}
    >
      <MobilePageOverlay key={`notes:${client.connection?.endpoint}`} open={notesOpen && !!client.connection}>
        {client.connection && <MobileNotes ref={notesPage} client={client} hostKey={client.connection.endpoint} hostName={connectionName}
          projects={projects} onClose={() => setNotesOpen(false)} onAddToChat={onNoteAddToChat} />}
      </MobilePageOverlay>
      <SurfaceVisibilityContext.Provider value={!pageOverlayOpen}>
      <div className="mobile-assistant-background" inert={pageOverlayOpen} aria-hidden={pageOverlayOpen || undefined}>
      {view !== "bots" && <>
      <header ref={header} className="mobile-header" data-floating={floatingHeader} data-project={view === "home" && homePageOpen} data-search={view === "home" && searchOpen} inert={drawerOpen || pageOverlayOpen || hostPickerOpen}>
        {view === "chat" && sessionEntrySource === "bot" ? (
          <IconButton label={t("Back to Bot conversation")} onClick={backToBot}><ArrowLeft size={24} /></IconButton>
        ) : view === "chat" && sessionEntrySource === "project" ? (
          <IconButton label={t("Back")} onClick={() => project && isChatFolder(project.cwd)
            ? openChats()
            : openHome(projects.find((item) => item.id === project?.id))}>
            <ArrowLeft size={24} />
          </IconButton>
        ) : view === "chat" || (view === "home" && !homePageOpen) ? (
          <IconButton
            label={t("Menu")}
            inert={view === "home" && searchOpen} aria-hidden={(view === "home" && searchOpen) || undefined}
            onClick={() => {
              setComposerPanel(null);
              setHomeMenuOpen(false);
              setDrawerOpen(true);
            }}
          >
            <PanelLeft size={24} />
          </IconButton>
        ) : view === "home" ? (
          <IconButton label={t("Back")} inert={searchOpen} aria-hidden={searchOpen || undefined} onClick={() => openHome()}>
            <ArrowLeft size={24} />
          </IconButton>
        ) : client.connection || settingsPage !== "root" ? (
          <IconButton
            label={t("Back")}
            onClick={() =>
              settingsPage !== "root"
                ? changeSettingsPage(mobileSettingsParent(settingsPage))
                : navigate(settingsReturnView.current)
            }
          >
            <ArrowLeft size={24} />
          </IconButton>
        ) : (
          <span className="mobile-header-logo">
            <Omi compact className="mobile-logo" />
          </span>
        )}
        {view === "home" ? homePageOpen ? (
          <div
            className="mobile-header-title"
            data-capsule="false"
            inert={searchOpen}
            aria-hidden={searchOpen || undefined}
          >
            <span className="mobile-project-header-text">
              <span className="mobile-project-header-name">
                <strong>{title}</strong>
              </span>
              <span className="mobile-header-host">
                <Computer size={14} aria-hidden="true" />
                <span className="mobile-project-header-host-name">{connectionName}</span>
                <MobileHostStatus status={hostStatus} dotOnly />
              </span>
            </span>
          </div>
        ) : (
          <button
            ref={homeMenuTrigger}
            type="button"
            className="mobile-header-title"
            data-capsule="false"
            inert={searchOpen}
            aria-hidden={searchOpen || undefined}
            aria-label={t("Projects")}
            aria-haspopup="dialog"
            aria-expanded={homeMenuOpen}
            onClick={() => setHomeMenuOpen((open) => !open)}
          >
            <strong>{title}</strong>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        ) : <div className="mobile-header-title" data-capsule={view === "settings" ? false : floatingHeader}>
          <strong>{view === "settings" && settingsPage === "root" ? "OmniCode" : title}</strong>
          {view === "chat" ? (
            <div className="mobile-header-context">
              {project?.name && (
                <span className="mobile-header-context-item">
                  <Folder size={14} aria-hidden="true" />
                  <span>{project.name}</span>
                </span>
              )}
              {client.connection && (
                <MobileHostStatus status={hostStatus} dotOnly />
              )}
            </div>
          ) : null}
        </div>}
          <MobileHeaderSearch
            open={view === "home" && searchOpen}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onClose={() => setSearchOpen(false)}
            trigger={searchTrigger}
            chats={homeChats}
          />
        {/* A new conversation has nothing to act on until its first message. */}
        {view === "chat" && (snapshot || loading) ? (
          <div className="mobile-header-actions">
            {/* The computer stands in until the session reports its context
                window; then the button becomes the context ring. */}
            <IconButton
              label={t("Status")}
              onClick={(event) => {
                // Keep the placeholder at full strength while loading.
                if (!snapshot || loading || !sessionConfirmed) return;
                sessionStatusTrigger.current = event.currentTarget;
                setComposerPanel(null);
                setSessionStatusOpen(true);
              }}
            >
              <MobileSessionContextRing store={snapshotStore} catalog={catalog} loading={loading} />
            </IconButton>
            <IconButton
              label={t("Session actions")}
              onClick={(event) => {
                // Like the status button, stay visible but inert while loading.
                if (!snapshot || loading || !sessionConfirmed) return;
                sessionActionsTrigger.current = event.currentTarget;
                setSessionActionsTarget(undefined);
                setSessionActionsPoint(undefined);
                setComposerPanel(null);
                setSessionActionsOpen(true);
              }}
              disabled={busy}
            >
              <MoreVertical size={24} />
            </IconButton>
          </div>
        ) : view === "settings" && settingsPage === "root" ? (
          <IconButton ref={aboutTrigger} label={t("About")} onClick={() => setAboutOpen((open) => !open)}>
            <Info size={24} />
          </IconButton>
        ) : view === "home" ? (
          <IconButton ref={searchTrigger} label={t(searchOpen ? "Close search" : homeChats ? "Search chats" : "Search conversations")} onClick={toggleHomeSearch}>
            {searchOpen ? <X size={24} /> : <Search size={24} />}
          </IconButton>
        ) : null}
      </header>

      <div className="mobile-notices" inert={drawerOpen || pageOverlayOpen || hostPickerOpen}>
      {noticeError && !showPendingNotice && (
          <div className="mobile-error" role="alert">
            <span>{noticeError}</span>
            {client.connection && (
              <IconButton
                label={t("Reconnect")}
                disabled={busy || hostStatus.state === "reconnecting"}
                onClick={() => void reconnect()}
              >
                <RefreshCw size={24} />
              </IconButton>
            )}
          </div>
        )}
      {showPendingNotice && (
        <div className="mobile-pending" role="status">
          <span>
            {t("Request confirmation has not been received.")}
            {noticeError && <small className="mobile-notice-detail">{noticeError}</small>}
          </span>
          <Button variant="secondary" onClick={() => void dispatch()}>
            {t("Retry")}
          </Button>
        </div>
      )}
      {/* Floats with the other notices: every navigation saves the location,
          so an in-flow banner shifted the whole page while that write settled. */}
      {!noticeError && !showPendingNotice && <SharedStateStatus pending={mobileWorkspacePending} pendingDelayMs={1500} />}
      </div>
      </>}

      <MobilePageTransition key={`pages:${client.connection?.endpoint}`} route={route}
        animate={navigationReady.current} visible={!pageOverlayOpen}>
      {view === "bots" && client.connection ? (
        <MobileBots
          ref={assistantPage}
          key={client.connection.endpoint}
          hostKey={client.connection.environmentId}
          hostName={connectionName}
          rpc={assistantRpc}
          foreground={foreground}
          onClose={closeBots}
          initialSelection={botResume}
          onOpen={openBotSession}
        />
      ) : initialRestorePending && view === "settings" ? (
        <div className="mobile-loading" role="status"><Omi expression="connecting" animated width={72} height={72} />{t("Loading…")}</div>
      ) : view === "settings" ? (
        <MobileSettings
          page={settingsPage}
          onPageChange={changeSettingsPage}
          connection={
            client.connection
              ? {
                  name: client.connection.name,
                  endpoint: client.connection.endpoint,
                  environmentId: client.connection.environmentId,
                  disabled: client.connection.disabled,
                }
              : undefined
          }
          hostStatus={hostStatus}
          busy={busy}
          loading={loading}
          pairing={pairing}
          addingConnection={addingConnection}
          connectionTrigger={connectionTrigger}
          onAddConnection={openAddConnection}
          connections={pairedConnections}
          sharedConnections={<MobileSharedConnections client={client} onPair={() => {
            setUrl("");
            setToken("");
            openAddConnection();
          }} />}
          onSwitchConnection={switchHost}
          probeConnection={probeSavedHost}
          onDeleteConnection={forgetConnection}
          connectionAppearance={connectionAppearance}
          onSaveConnectionAppearance={saveConnectionAppearance}
          onReconnect={() => void reconnect()}
          theme={theme}
          onThemeChange={(value) => {
            const next = value === "light" || value === "system" ? value : "dark";
            saveThemePreference(next);
            setTheme(next);
          }}
          skin={skin}
          onSkinChange={(value) => {
            saveMobileSkin(value);
            setSkin(value);
          }}
          glass={glass}
          onGlassChange={(value) => { saveGlassSettings(value); setGlass(value); }}
          language={language}
          onLanguageChange={setUiLanguage}
          followUpBehavior={followUpBehavior}
          onFollowUpBehaviorChange={(behavior) => {
            saveFollowUpBehavior(behavior);
            setFollowUpBehavior(behavior);
          }}
          transcriptLayout={transcriptLayout}
          onTranscriptLayoutChange={(layout) => {
            saveTranscriptLayout(layout);
            setTranscriptLayout(layout);
          }}
          transcriptAnchor={transcriptAnchor}
          onTranscriptAnchorChange={(anchor) => {
            saveTranscriptAnchor(anchor);
            setTranscriptAnchor(anchor);
          }}
          accentColor={accentColor}
          onAccentColorChange={(color) => {
            saveAccentColor(color);
            setAccentColor(applyAccentColor(color));
          }}
          soundsEnabled={soundsEnabled}
          onSoundsEnabledChange={(enabled) => {
            saveSoundsEnabled(enabled);
            setSoundsEnabled(enabled);
          }}
          archive={
            <MobileArchive
              projects={projects}
              disabled={busy || !connected}
              loadSessions={onDrawerLoadSessions}
              onRestore={(session) =>
                updateSessionMetadata(
                  { archived: false },
                  session.id,
                  session.projectId,
                )
              }
            />
          }
          agentDefaults={
            <MobileAgentDefaults
              key={`${client.connection?.endpoint ?? "disconnected"}:${connected}:${connectionRevision}`}
              client={client}
              hostId={connected ? client.connection : undefined}
              disabled={busy || loading || !connected}
              panel={preferencePanel}
              onPanelChange={setPreferencePanel}
            />
          }
          providerAccounts={
            <MobileProviderAccounts
              key={`${client.connection?.endpoint ?? "disconnected"}:${connected}:${connectionRevision}`}
              client={client}
              hostId={client.connection?.endpoint}
              enabled={connected && hostStatus.state === "connected"}
            />
          }
          preferencePanel={preferencePanel}
          onPreferencePanelChange={setPreferencePanel}
          activity={activity}
          appUpdates={appUpdates}
        />
      ) : view === "home" ? (
        <MobileHome
          key={client.connection?.endpoint}
          projects={hostScopeReady ? projects : []}
          project={hostScopeReady ? homeProject : undefined}
          projectsPage={!homePageOpen && allProjectsPage}
          chatsPage={homeChats}
          onChats={chatSupported || projects.some((item) => isChatFolder(item.cwd)) ? openChats : undefined}
          projectsPending={projectsPending}
          projectsUnavailable={projectsUnavailable}
          foreground={connected && hostStatus.state === "connected" && foreground && !drawerOpen && !pageOverlayOpen && !hostPickerOpen}
          inactive={drawerOpen || homeMenuOpen || addingConnection || sessionActionsOpen || hostPickerOpen}
          query={searchOpen ? searchQuery : ""}
          now={now}
          unreadIds={activity.unreadIds}
          loadSessions={onDrawerLoadSessions}
          cachedSessions={onCachedSessions}
          onProject={onDrawerProject}
          onSession={(id, owner) => {
            void openProject(owner);
            void openSession(id, owner.id, homePageOpen ? "project" : "other");
          }}
          refreshKey={homeRefreshKey}
          sessionActionsId={sessionActionsOpen ? sessionActionsTarget : undefined}
          onSessionActions={(summary, trigger, point) => {
            setHomeActionSession(summary);
            onDrawerSessionActions(summary.id, trigger, point);
          }}
          onNewChat={chatSupported ? onNewChat : undefined}
          onNewSession={() => {
            const owner = homeProject ?? projects.find((item) => item.id === project?.id) ?? projects[0];
            if (owner) {
              void openProject(owner);
              void openSession(undefined, undefined, homeProject ? "project" : "other");
            }
          }}
          onAddProject={openAddProject}
          devices={
            <MobileDeviceChips
              connections={deviceConnections}
              activeId={connectionKey}
              status={hostStatus}
              scope={homeScope}
              probing={homeOverview && foreground && !pageOverlayOpen}
              disabled={pairing}
              probe={probeHost}
              onScope={setHomeScope}
              onSwitch={switchHost}
            />
          }
          unavailable={homeUnavailable ? (
            <MobileHostUnavailable
              failed={projectsUnavailable}
              retrying={busy || hostStatus.state === "reconnecting"}
              lastOnline={loadLastOnline(connectionKey)}
              now={now}
              onRetry={() => void reconnect()}
            />
          ) : undefined}
          remote={remoteHosts}
          onRemoteSession={onRemoteSession}
          onRemoteProject={onRemoteProject}
        />
      ) : (
        <main className="mobile-chat chat-pane-background isolate" inert={drawerOpen || pageOverlayOpen || hostPickerOpen}
          data-project-chat-background={!!projectBackground}
          data-project-background-effect={projectBackground?.effect}
          data-session-empty={!(snapshot?.hasBlocks || placeholder?.session.blocks.length)}
          data-new-conversation={!sessionId}
          style={projectBackgroundStyle}>
          {(projectBackground?.effect === "gradient-blur" || (!projectBackground && backgroundPath && backgroundEffect === "gradient-blur")) && <GradientBlurBackground />}
          {transcriptSessionId ? (
            <MobileSessionTranscript
              key={transcriptKeys.current.get(transcriptSessionId) ?? transcriptSessionId}
              store={snapshotStore}
              sessionId={transcriptSessionId}
              initialSnapshot={snapshotStore.get()}
              historyLoading={loading}
              placeholder={placeholder}
              outgoing={sendingMessage?.sessionId === snapshot?.session.id ? sendingMessage?.outgoing : undefined}
              active={!drawerOpen && !pageOverlayOpen && !hostPickerOpen}
              onOverlayChange={onTranscriptOverlayChange}
              gitSource={gitSource}
              sessionChangesSource={sessionChangesSource}
              progressDock={progressDock}
              gitEnabled={foreground && connected && hostStatus.state === "connected" && sessionConfirmed && !loading}
              animateFrom={animateFrom}
              readBinaryFile={readHostImage}
              resolveNoteImage={client.hasCapability("notes.v1") ? resolveNoteImage : undefined}
              disabled={busy || !!pending || !sessionConfirmed || nativeReadOnly}
              onCommand={onTranscriptCommand}
              questionOpen={questionOpen}
              onQuestionOpenChange={onQuestionOpenChange}
              planDecision={planDecision}
              worktreeCreation={worktreeCreation}
            />
          ) : loading ? (
            <div className="mobile-loading">
              <MobileSpinner className="mobile-spin" size={20} />
              {t("Loading conversation…")}
            </div>
          ) : !project ? (
            <MobileEmpty icon={<Folder size={40} />} title={t("Open your first project")}>
              {t("Add a folder from your connected computer to get started.")}
              <Button variant="secondary"

                onClick={(event) => openAddProject(event.currentTarget)}
              >
                <FolderPlus size={16} />
                {t("Open project")}
              </Button>
            </MobileEmpty>
          ) : (
            <MobileEmpty
              icon={<Chatting size={40} />}
              title={
                sessionId
                  ? "Conversation unavailable"
                  : "What shall we work on?"
              }
            >
              {sessionId
                ? t("Check your connection and retry.")
                : t("Start a conversation in {project}.", {
                    project: project?.name || t("your project"),
                  })}
            </MobileEmpty>
          )}
          {nativeReadOnly ? <p className="mobile-native-readonly" role="status">
            {snapshot?.archived ? t("Archived") : snapshot?.session.orchestrationLeadId ? t("This worker is managed by its lead. Use desktop orchestration controls.")
              : nativeSyncNotice(snapshot?.nativeStatus) ?? nativeAccessNotice(nativeAccess)}
          </p> : null}
          {project && <MobileDraftComposer
            progressSlot={setProgressDock}
            compact={questionOpen || planDecisionOpen}
            onExpand={onComposerExpand}
            queue={composerQueue}
            draft={draft}
            skillsContextKey={skillContextKey}
            loadSkills={loadSkillCatalog}
            canCompact={!!snapshot && snapshot.status === "idle" && !nativeReadOnly && ["codex", "claude", "grok", "opencode", "pi", "omp"].includes(snapshot.session.harness)}
            configuration={
              snapshot ? snapshot.configuration : configuration
            }
            catalog={catalog}
            catalogLoading={catalogLoading}
            lockedAgent={!!sessionId}
            allowHandoff={
              client.hasCapability("sessions.handoff") && !running
            }
            disabled={
              nativeReadOnly ||
              busy ||
              !!pending ||
              (running && !snapshot?.supportsQueue) ||
              loading ||
              (!!sessionId && !sessionConfirmed) ||
              (!!sessionId && !snapshot)
            }
            working={busy || readingAttachments}
            readingAttachments={readingAttachments}
            running={running}
            canSend={
              !nativeReadOnly &&
              !busy &&
              !pending &&
              !readingAttachments &&
              !loading &&
              (!sessionId || sessionConfirmed) &&
              (!running || !!snapshot?.supportsQueue) &&
              (sessionId
                ? !!snapshot
                : !!catalog?.models[configuration.harness]?.some(
                    (model) => model.id === configuration.model,
                  ))
            }
            canStop={!busy && !pending && sessionConfirmed && !!snapshot?.runId}
            onSend={onComposerSend}
            onStop={onComposerStop}
            onConfigurationChange={onComposerConfiguration}
            panel={composerPanel}
            onPanelChange={setComposerPanel}
            project={project}
            projects={projects}
            onProjectChange={onComposerProject}
            attachments={attachments}
            onFiles={onComposerFiles}
            onRemoveAttachment={onComposerRemoveAttachment}
            planMode={planMode}
            onPlanModeChange={setPlanMode}
            workspace={composerWorkspace}
          />}
        </main>
      )}
      </MobilePageTransition>

      {!!client.connection && (
        <MobileDrawer
          key={`drawer:${client.connection?.endpoint}`}
          assistantUnreadCount={assistantUnreadCount}
          onAssistant={onDrawerAssistant}
          onNotes={client.hasCapability("notes.v1") ? onDrawerNotes : undefined}
          open={drawerOpen && view !== "settings" && !pageOverlayOpen}
          active={view !== "settings" && !pageOverlayOpen}
          covered={hostPickerOpen}
          foreground={foreground && connected && hostStatus.state === "connected"}
          onOpenChange={onDrawerOpenChange}
          projects={hostScopeReady ? projects : []}
          project={hostScopeReady ? project : undefined}
          sessions={hostScopeReady ? (project && client.cachedSessions?.(project.id)) ?? sessions : []}
          sessionId={sessionId}
          loading={historyLoading}
          unreadIds={activity.unreadIds}
          now={now}
          hostName={connectionName}
          hostStatus={hostStatus}
          hostTrigger={hostPickerTrigger}
          onHost={onDrawerHost}
          projectsPending={projectsPending}
          projectsUnavailable={projectsUnavailable}
          loadSessions={onDrawerLoadSessions}
          cachedSessions={onCachedSessions}
          onHome={onDrawerHome}
          onAllProjects={onDrawerAllProjects}
          onSession={onDrawerSession}
          refreshKey={homeRefreshKey}
          sessionActionsId={sessionActionsOpen ? sessionActionsTarget : undefined}
          onSessionActions={onDrawerSummaryActions}
          onNewSession={onDrawerNewSession}
          onSettings={onDrawerSettings}
        />
      )}
      <MobileSheetPresence open={hostPickerOpen}>
        <MobileHostPicker anchor={hostPickerTrigger}
          connections={pairedConnections}
          activeId={connectionKey} status={hostStatus} switching={pairing}
          probe={probeHost} onSwitch={switchHost} onReconnect={() => { setHostPickerOpen(false); void reconnect(); }}
          onAdd={() => {
            connectionTrigger.current = hostPickerTrigger.current;
            setHostPickerOpen(false);
            setDrawerOpen(false);
            openAddConnection();
          }}
          onManage={() => {
            setHostPickerOpen(false);
            navigate("settings");
            changeSettingsPage("connections");
          }}
          onClose={() => setHostPickerOpen(false)} />
      </MobileSheetPresence>
      <MobileSheetPresence open={sessionActionsOpen && view !== "settings" && !!(sessionActionsTarget ? sessionActionsSummary : snapshot)}>
      {(sessionActionsTarget ? sessionActionsSummary : snapshot) ? (
        <MobileSnapshotActions
          key={sessionActionsTarget ?? sessionId ?? "draft"}
          open={sessionActionsOpen}
          store={snapshotStore}
          currentSession={!sessionActionsTarget}
          summary={sessionActionsSummary}
          anchor={sessionActionsTrigger}
          anchorPoint={sessionActionsPoint}
          disabled={busy || loading || !!pending}
          onUpdate={(patch) =>
            updateSessionMetadata(patch, sessionActionsTarget ?? sessionId, sessionActionsSummary?.projectId ?? project?.id)
          }
          onDelegate={client.hasCapability("assistant.v1") ? async () => {
            const targetId = sessionActionsTarget ?? sessionId;
            const targetProject = sessionActionsSummary?.projectId ?? snapshot?.projectId;
            if (!client.connection || !targetId || !targetProject) throw new Error(t("Conversation is unavailable"));
            await delegateSession(assistantRpc, {
              environmentId: client.connection.environmentId,
              projectId: targetProject,
              sessionId: targetId,
            });
          } : undefined}
          onMarkUnread={
            sessionActionsSummary
              ? async () => {
                  activity.markUnread(
                    sessionActionsSummary.id,
                    sessionActionsSummary.revision,
                  );
                }
              : undefined
          }
          onClose={() => {
            setSessionActionsOpen(false);
          }}
        />
      ) : null}
      </MobileSheetPresence>
      <MobileSheetPresence open={sessionStatusOpen && view === "chat" && !!snapshot}>
      {snapshot ? (
        <MobileSnapshotStatus
          store={snapshotStore}
          catalog={catalog}
          hostName={connectionName}
          hostStatus={hostStatus}
          anchor={sessionStatusTrigger}
          onClose={() => setSessionStatusOpen(false)}
        />
      ) : null}
      </MobileSheetPresence>
      <MobileSheet
        open={aboutOpen && view === "settings" && settingsPage === "root"}
        title="About"
        placement="anchor"
        anchor={aboutTrigger}
        align="end"
        width={SHEET_WIDTH.list}
        onClose={() => setAboutOpen(false)}
      >
        <p className="mobile-about-version">
          OmniCode{appUpdates.installed ? ` ${appUpdates.installed.version}` : ""}
        </p>
        <button
          type="button"
          className="mobile-sheet-row"
          onClick={() => {
            setAboutOpen(false);
            changeSettingsPage("updates");
          }}
        >
          <RefreshCw size={20} />
          <span>{t("App updates")}</span>
        </button>
      </MobileSheet>
      <MobileHomeMenu
        key={client.connection?.endpoint}
        open={homeMenuOpen && view === "home" && !drawerOpen}
        anchor={homeMenuTrigger}
        projects={hostScopeReady ? projects : []}
        projectsPending={projectsPending}
        projectsUnavailable={projectsUnavailable}
        foreground={connected && hostStatus.state === "connected" && foreground && !pageOverlayOpen && !hostPickerOpen}
        loadSessions={onDrawerLoadSessions}
        cachedSessions={onCachedSessions}
        onClose={() => setHomeMenuOpen(false)}
        onProject={onDrawerProject}
      />
      <MobileSheetPresence open={addingConnection}>
        <MobileConnectionSheet
          anchor={connectionTrigger}
          url={url}
          token={token}
          disabled={pairing}
          error={pairingError}
          pairedHost={pairingSuccess}
          onUrlChange={setUrl}
          onTokenChange={setToken}
          onConnect={() => void connect()}
          onConnectWith={(credentials) => {
            setUrl(credentials.url);
            void connect(credentials);
          }}
          onClose={() => {
            if (!pairing || pairingSuccess) {
              setAddingConnection(false);
              setToken("");
              setPairingError("");
            }
          }}
        />
      </MobileSheetPresence>
      <MobileSheetPresence open={addingProject}>
        <MobileProjectPicker
          hostName={connectionName}
          anchor={projectTrigger}
          disabled={busy}
          browseDirectories={browseHostDirectories}
          onOpen={addProject}
          onClose={() => {
            if (!busy) setAddingProject(false);
          }}
        />
      </MobileSheetPresence>
      </div>
      </SurfaceVisibilityContext.Provider>
    </div>
    </MobileOverlayHostContext.Provider>
  );
}
