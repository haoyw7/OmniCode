import { lightImpact, attentionHaptic, setHapticsForeground } from "../haptics";

import { usePreferenceState } from "../../features/settings/model/usePreferenceState";
import type { MobileNotesHandle } from "../MobileNotes";
import {
  appendNoteReference,
  noteSourceProject,
  type Note,
} from "../../features/notes/notesText";
import { useConnectionAppearance, removeConnectionAppearance } from "../connectionAppearance";
import { connectionErrorMessage } from "../connectionError";
import type { MobileAssistantHandle } from "../MobileAssistant";
import type { MobileBotSelection } from "../MobileBots";
import type { BotTarget } from "../../features/bots/model/botNavigation";
import { resolveBotOrigin } from "../../features/bots/model/botOrigin";
import type { SessionReference } from "../../features/bots/model/botView";
import { useMobileAssistantUnread } from "../useMobileAssistantUnread";
import { useHostQueue } from "../../features/connections/ui/useHostQueue";
import {
  outgoingPlacement,
  type OutgoingMessage,
} from "../../features/connections/model/outgoing";
import { consumePlanCommand } from "../../features/sessions/model/plan";
import {
  IMPLEMENT_PLAN_PROMPT,
  skipPlanDecision,
  usePlanDecision,
} from "../../features/sessions/model/planDecision";
import { isCompactCommand } from "../../features/sessions/model/compact";
import { MobileMessageQueue } from "../MobileMessageQueue";
import { backMobileSheet } from "../mobileSheetBack";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  DEFAULT_RUNTIME_MODE,
  sessionDisplayTitle,
  sessionExecutionCwd,
  type Attachment,
  type Block,
  type QueuedMessage,
} from "../../features/sessions/model/session";
import type {
  HostProject,
  HostSession,
  HostSessionSummary,
  HostCommand,
} from "../../features/connections/model/protocol";
import { createSessionSnapshotStore, useSessionSnapshot, selectSessionShell, sameSessionShell, type MobileSessionShell } from "../sessionSnapshotStore";
import { createMobileGitSource } from "../mobileGit";
import { createMobileSessionChangesSource } from "../mobileSessionChanges";
import { useMobileAppUpdates } from "../MobileAppUpdates";
import {
  configurationForSession,
  type MobileConfiguration,
} from "../MobileModelControls";
import {
  defaultConfiguration as firstConfiguration,
  defaultProviderAccount,
  loadMobileProjectDefaults,
  type MobileAgentDefaults as AgentDefaults,
} from "../agentDefaults";
import type { HostModelCatalog } from "../../features/connections/model/protocol";
import {
  MobileClient,
  type PendingCommand,
  type MobileFirstMessage,
  type MobileSessionPatch,
  type Connection,
  type HostConnectionStatus,
} from "../client";
import type { MobileComposerPanel } from "../MobileComposer";
import { createMobileDraft } from "../MobileDraftComposer";
import { normalizePairingCode } from "../pairing";
import { type MobileSheetPoint } from "../MobileSheet";
import { sessionListStore } from "../sessionListStore";
import {
  mobileSettingsTitle,
  mobileSettingsParent,
  type MobilePreferencePanel,
  type MobileSettingsPage,
} from "../mobileSettingsRoutes";
import { readLastLocation, saveLastLocation } from "../lastLocation";
import { initializeMobileWorkspace, saveMobileWorkspace, flushMobileWorkspace, stopMobileWorkspace } from "../hostWorkspace";
import { initializeHostConnections, stopHostConnections } from "../../features/connections/model/hostConnections";
import type { WorkspaceLocation } from "../../features/connections/model/hostWorkspace";
import { connectHostPreferences } from "../../features/settings/model/hostPreferences";
import { activePreferenceStore, subscribeSharedPreferences } from "../../features/settings/model/sharedPreferences";
import { useMobileActivity } from "../useMobileActivity";
import { type MobileHomeScope } from "../MobileDeviceChips";
import { useMobileHostDirectory } from "../useMobileHostDirectory";
import { saveLastOnline } from "../lastOnline";
import { useHostConnectionStatus } from "../useHostConnectionStatus";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { translate } from "../../shared/i18n/language";
import { nativeSourceKey, nativeSyncBlocked, type NativeSessionAccess } from "../../integrations/harness/core/nativeSessions";
import { readMobileAttachments } from "../attachments";
import {
  CURRENT_WORKSPACE,
  type MobileWorkspace,
} from "../MobileWorkspaceControls";
import {
  WORKTREE_CREATION_FOLD_MS,
  anchorWorktreeCreation,
  appendWorktreeCreationLog,
  completeWorktreeCreation,
  failWorktreeCreation,
  foldWorktreeCreation,
  persistWorktreeCreation,
  startWorktreeCreation,
  type PersistedWorktreeCreation,
  type WorktreeCreation,
} from "../../features/source-control/model/worktreeCreation";
import { WORKTREE_NAME_ERROR } from "../../features/source-control/model/worktreeNaming";
import { takeBackQueuedMessage } from "../queuedDraft";
import { loadFollowUpBehavior } from "../../features/settings/model/settings";
import { loadAccentColor, loadTranscriptAnchor, loadTranscriptLayout, loadChatBackgroundPath, loadNewThreadBackgroundEffect } from "../../features/settings/model/appearance";
import { loadSoundsEnabled } from "../../features/settings/model/sounds";
import { mobileStorage } from "../storage";
import { useStableCallback } from "../useStableCallback";
import { applyGlassSettings, readGlassSettings, type GlassSettings } from "../glassSettings";
import { loadThemePreference } from "../../features/settings/model/appearance";
import { applyMobileSkin, loadMobileSkin, type MobileSkinPreference } from "../theme/skin";
import { useNow } from "../../shared/hooks/useNow";
import { useMobileHeaderMotion, type MobileRoute } from "../MobilePageTransition";
import { migrateConnectionSettings } from "../connectionScope";
import { loadProjectChatBackgroundSettings, projectChatBackgroundRevision, projectChatBackgroundImageRevision, subscribeProjectChatBackground } from "../../features/projects/model/projectChatBackground";
import { useProjectBackgroundEffect } from "../../features/projects/ui/useProjectBackgroundEffect";
import { dismissImageLightbox } from "../../shared/ui/ImageLightbox";

export const client = new MobileClient(mobileStorage);
/** Home page id for the projectless chats list; never a Host project id. */
const CHATS_PAGE_ID = "omnicode:chats";

/**
 * `undefined` while checking; `null` when the Host cannot verify ownership
 * (older Host or unavailable). Only a verified idle session may be written,
 * and a running Host turn already holds the shared lock.
 */
function nativeWriteBlocked(
  snapshot: MobileSessionShell | undefined,
  access: NativeSessionAccess | undefined,
): boolean {
  if (snapshot?.archived || snapshot?.session.orchestrationLeadId) return true;
  if (!snapshot?.session.nativeSession) return false;
  if (nativeSyncBlocked(snapshot.nativeStatus)) return true;
  return !(snapshot.status === "running" && snapshot.runId) && access?.state !== "idle";
}

export const browseHostDirectories = (path?: string) => client.browseDirectories(path);
// Settings doubles as the connection screen before pairing.
type View = "home" | "chat" | "settings" | "bots";

/** A sent message shown before the Host records it. */
type SendingMessage = {
  commandId: string;
  sessionId?: string;
  outgoing: OutgoingMessage;
  /** Stands in for a conversation the first message is still creating. */
  placeholder?: HostSession;
};
const message = (error: unknown) =>
  error instanceof Error
    ? translate(error.message)
    : translate("Unable to reach this Host.");
const HOME_SCOPE_KEY = "omnicode.mobile.homeScope";
function loadHomeScope(): MobileHomeScope {
  try {
    return localStorage.getItem(HOME_SCOPE_KEY) === "all" ? "all" : "device";
  } catch {
    return "device";
  }
}
function saveHomeScope(scope: MobileHomeScope) {
  try {
    localStorage.setItem(HOME_SCOPE_KEY, scope);
  } catch {
    // Scope is a convenience; an unavailable store keeps the session's choice.
  }
}

export function useMobileAppController() {
  const { language, t } = useTranslation();
  const appUpdates = useMobileAppUpdates();
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutTrigger = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>("settings");
  // Settings is the unpaired fallback, not a page to load before an existing
  // Host has had a chance to restore Home or its conversation.
  const [initialRestorePending, setInitialRestorePending] = useState(true);
  // List scope survives navigation, so chat controls need their own entry source.
  const [sessionEntrySource, setSessionEntrySource] = useState<"project" | "other" | "bot">("other");
  const assistantOpen = view === "bots";
  const botsReturnView = useRef<Exclude<View, "bots">>("home");
  const botsReturnSession = useRef<{ project: HostProject; sessionId?: string; source: "project" | "other" } | undefined>(undefined);
  const [botResume, setBotResume] = useState<MobileBotSelection>();
  const [notesOpen, setNotesOpen] = useState(false);
  const notesPage = useRef<MobileNotesHandle>(null);
  const pageOverlayOpen = notesOpen;
  const assistantPage = useRef<MobileAssistantHandle>(null);
  const assistantRpc = useCallback(async <T,>(method: string, params?: object) => {
    return client.rpc<T>(method, params);
  }, []);
  const [homeProjectId, setHomeProjectId] = useState<string>();
  const [allProjectsPage, setAllProjectsPage] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const [homeMenuOpen, setHomeMenuOpen] = useState(false);
  const homeMenuTrigger = useRef<HTMLButtonElement>(null);
  const settingsReturnView = useRef<View>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hostPickerOpen, setHostPickerOpen] = useState(false);
  const [homeScope, setHomeScopeState] = usePreferenceState<MobileHomeScope>(loadHomeScope);
  const setHomeScope = useCallback((scope: MobileHomeScope) => {
    saveHomeScope(scope);
    setHomeScopeState(scope);
  }, []);
  const hostPickerTrigger = useRef<HTMLButtonElement>(null);
  const [settingsPage, setSettingsPage] = useState<MobileSettingsPage>("root");

  const connectionAppearance = useConnectionAppearance(client.connection?.endpoint);
  const connectionName = connectionAppearance.displayName || client.connection?.name || "OmniCode";
  const [connected, setConnected] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [savedHosts, setSavedHosts] = useState<Connection[]>([]);
  // Assistant read marks and drafts belong to the Host's conversation, not to one address.
  const assistantHostId = connected ? client.connection?.environmentId : undefined;
  const resolveNoteImage = useMemo(() => {
    const hostId = client.connection?.endpoint;
    return async (asset: string) => {
      if (client.connection?.endpoint !== hostId) throw new Error(t("Host connection changed."));
      const image = await client.noteImage(asset);
      return `data:${image.mime};base64,${image.data}`;
    };
  }, [client.connection?.endpoint, t]);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [projectListState, setProjectListState] = useState<"loading" | "ready" | "failed">("loading");
  const [project, setProject] = useState<HostProject>();
  const [sessions, setSessions] = useState<HostSessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  // A draft keeps its page identity when its first send creates a session.
  const [chatPageKey, setChatPageKey] = useState("draft");
  const chatPageIdentity = useRef(chatPageKey);
  chatPageIdentity.current = chatPageKey;
  const [snapshotStore] = useState(createSessionSnapshotStore);
  const setSnapshot = snapshotStore.set;
  const [nativeAccessResult, setNativeAccessResult] = useState<{
    key: string;
    value: NativeSessionAccess | undefined;
  }>();
  const [sessionConfirmed, setSessionConfirmed] = useState(false);
  const [animateFrom, setAnimateFrom] = useState<string>();
  // A send shown in the transcript the moment it leaves, until the Host has
  // recorded it (or it failed and its text went back to the composer).
  const [sendingMessage, setSendingMessage] = useState<SendingMessage>();
  const sendingRef = useRef<SendingMessage>(undefined);
  sendingRef.current = sendingMessage;
  const selectShell = useCallback((value: HostSession | undefined) => selectSessionShell(
    value, sendingMessage?.sessionId === value?.session.id ? sendingMessage?.outgoing : undefined,
  ), [sendingMessage]);
  const snapshot = useSessionSnapshot(snapshotStore, selectShell, sameSessionShell);
  // A new conversation keeps the transcript its sending copy mounted.
  const transcriptKeys = useRef(new Map<string, string>());
  const [catalog, setCatalog] = useState<HostModelCatalog>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const draftDefaults = useRef<AgentDefaults>({});
  const draftConfigurationChanged = useRef(false);
  const [configuration, setConfiguration] = useState<MobileConfiguration>({
    harness: "codex",
    model: "",
    modelSettings: {},
    runtimeMode: "supervised",
  });
  const [draft] = useState(createMobileDraft);
  const setDraft = draft.set;
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  // A new conversation's working copy, and the worktree its first send creates.
  const [workspace, setWorkspace] = useState<MobileWorkspace>(CURRENT_WORKSPACE);
  const [worktreeCreation, setWorktreeCreation] = useState<WorktreeCreation>();
  const [followUpBehavior, setFollowUpBehavior] = usePreferenceState(loadFollowUpBehavior);
  const [transcriptLayout, setTranscriptLayout] = usePreferenceState(loadTranscriptLayout);
  const [transcriptAnchor, setTranscriptAnchor] = usePreferenceState(loadTranscriptAnchor);
  const [accentColor, setAccentColor] = usePreferenceState(loadAccentColor);
  const [soundsEnabled, setSoundsEnabled] = usePreferenceState(loadSoundsEnabled);
  const acceptedQueueAttachments = useRef<Attachment[]>([]);
  const parkedDrafts = useRef<Array<{
    text: string;
    attachments: Attachment[];
    planMode: boolean;
    accepted: Attachment[];
  }>>([]);
  const [composerPanel, setComposerPanel] = useState<MobileComposerPanel>(null);
  const [progressDock, setProgressDock] = useState<HTMLDivElement | null>(null);
  const [sessionActionsOpen, setSessionActionsOpen] = useState(false);
  const [homeActionSession, setHomeActionSession] = useState<HostSessionSummary>();
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);
  const [sessionActionsTarget, setSessionActionsTarget] = useState<string>();
  const [sessionActionsPoint, setSessionActionsPoint] = useState<MobileSheetPoint>();
  const [sessionStatusOpen, setSessionStatusOpen] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [addingConnection, setAddingConnection] = useState(false);
  const [preferencePanel, setPreferencePanel] =
    useState<MobilePreferencePanel>(null);
  const [busy, setBusy] = useState(false);
  // Pairing a new Host is gated separately so a slow or timed-out attempt on
  // the current Host never blocks adding another connection.
  const [pairing, setPairing] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const [pairingSuccess, setPairingSuccess] = useState<{ name: string }>();
  const pairingInFlight = useRef(false);
  /** Each Host connection attempt bumps this; superseded attempts drop their results. */
  const hostAttempt = useRef(0);
  const stopPreferences = useRef<(() => void) | undefined>(undefined);
  const workspaceHost = useRef<string | undefined>(undefined);
  const workspaceReady = useRef<string | undefined>(undefined);
  const preparingSharedState = useRef(0);
  const sharedStateGeneration = useRef(0);
  const stopSharedState = () => {
    sharedStateGeneration.current++;
    stopPreferences.current?.();
    stopPreferences.current = undefined;
    workspaceHost.current = undefined;
    workspaceReady.current = undefined;
    stopMobileWorkspace();
    stopHostConnections();
  };
  const prepareSharedState = async (): Promise<WorkspaceLocation | undefined> => {
    const connection = client.connection;
    if (!connection) return;
    setSharedStateError("");
    preparingSharedState.current++;
    try {
      const restoredHost = workspaceHost.current;
      stopSharedState();
      // Reinitializing sync on reconnect must not restore over a running window.
      if (restoredHost === connection.environmentId) workspaceHost.current = restoredHost;
      const generation = sharedStateGeneration.current;
      const { environmentId, endpoint } = connection;
      const status = client.getConnectionStatus();
      const cachedCapabilities = status.state !== "connected" && status.reason !== "identity" && status.reason !== "authentication"
        && !!localStorage.getItem(`omnicode.hostPreferences.v1:${environmentId}`);
      const request = <T,>(method: string, params?: Record<string, unknown>): Promise<T> => {
        if (client.connection?.environmentId !== environmentId || client.connection.endpoint !== endpoint)
          return Promise.reject(new Error(t("Host connection changed.")));
        return client.rpc<T>(method, params);
      };
      const stop = await connectHostPreferences({ hostId: environmentId, request,
        capabilities: client.hasCapability("clientState.v1") || cachedCapabilities ? ["clientState.v1"] : [] });
      if (generation !== sharedStateGeneration.current || client.connection?.environmentId !== environmentId || client.connection.endpoint !== endpoint) { stop(); return; }
      stopPreferences.current = stop;
      const [location] = await Promise.all([
        initializeMobileWorkspace(client).then((location) => {
          if (generation === sharedStateGeneration.current) workspaceReady.current = environmentId;
          return location;
        }).catch((problem) => {
          // Older or temporarily unavailable persistence APIs do not block opening
          // a conversation. Keep the upgrade/sync error visible for the user.
          if (generation === sharedStateGeneration.current) setSharedStateError(message(problem));
          return undefined;
        }),
        initializeHostConnections({ environmentId, request, allowCached: !!cachedCapabilities }).catch((problem) => {
          if (generation === sharedStateGeneration.current) setSharedStateError(message(problem));
        }),
      ]);
      return generation === sharedStateGeneration.current ? location : undefined;
    } finally { preparingSharedState.current--; }
  };
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [hostError, setHostError] = useState("");
  const [sharedStateError, setSharedStateError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pending, setPending] = useState<PendingCommand>();
  const [foreground, setForeground] = useState(true);
  useEffect(() => { setHapticsForeground(foreground); }, [foreground]);
  const hostStatus = useHostConnectionStatus(client, connected, foreground);
  const assistantUnreadCount = useMobileAssistantUnread(
    assistantHostId,
    assistantRpc,
    !assistantOpen && foreground &&
      connected && hostStatus.state === "connected" && client.hasCapability("assistant.v1"),
  );
  // Each paired address is its own connection, even when it reaches the same Host.
  const connectionKey = client.connection?.endpoint;
  // Loader identity scopes shared list subscriptions to one paired Host. An
  // outgoing page cannot start a request on the newly selected connection.
  const listEnvironment = client.connection?.environmentId;
  const onDrawerLoadSessions = useCallback(async (projectId: string) => {
    const current = () => client.connection?.endpoint === connectionKey && client.connection?.environmentId === listEnvironment;
    if (!current()) throw new Error(translate("Host connection changed."));
    const result = await client.sessions(projectId);
    if (!current()) throw new Error(translate("Host connection changed."));
    return result;
  }, [connectionKey, listEnvironment, connectionRevision]);
  const onCachedSessions = useCallback((projectId: string) =>
    client.connection?.endpoint === connectionKey && client.connection?.environmentId === listEnvironment
      ? client.cachedSessions?.(projectId) : undefined,
  [connectionKey, listEnvironment, connectionRevision]);
  const lists = useMemo(() => sessionListStore(onDrawerLoadSessions), [onDrawerLoadSessions]);
  const listRunning = useRef(false);
  listRunning.current = sessions.some((item) => item.status === "running");
  const previousConnection = useRef(connectionKey);
  const hostScopeReady = previousConnection.current === connectionKey;
  useEffect(() => {
    if (!connected || hostStatus.state !== "connected" || !connectionKey) return;
    saveLastOnline(connectionKey);
    const timer = setInterval(() => saveLastOnline(connectionKey), 60_000);
    return () => clearInterval(timer);
  }, [connected, hostStatus.state, connectionKey]);
  const hostDrafts = useRef(new Map<string, {
    projectId: string; sessionId?: string; text: string; attachments: Attachment[];
    planMode: boolean; accepted: Attachment[]; parked: typeof parkedDrafts.current;
  }>());
  const nativeLink = snapshot?.session.nativeSession;
  const imageProjectId = snapshot?.projectId ?? project?.id;
  const readHostImage = useCallback((path: string) => client.readBinaryFile(path, imageProjectId), [imageProjectId]);
  const gitCwd = snapshot ? sessionExecutionCwd(snapshot.session) : undefined;
  const gitSupported = client.hasCapability("git.index") && client.hasCapability("git.fileDiff");
  const gitSource = useMemo(() => hostScopeReady && snapshot?.session.id === sessionId && snapshot && gitCwd && gitSupported
    ? createMobileGitSource(client, snapshot.projectId, gitCwd) : undefined,
  [client.connection, hostScopeReady, sessionId, snapshot?.session.id, snapshot?.projectId, gitCwd, gitSupported]);
  const checkpointSupported = client.hasCapability("sessions.checkpoint");
  const sessionChangesSource = useMemo(() => hostScopeReady && snapshot?.session.id === sessionId && snapshot && checkpointSupported
    ? createMobileSessionChangesSource(client, snapshot.projectId, snapshot.session.id) : undefined,
  [client.connection, hostScopeReady, sessionId, snapshot?.session.id, snapshot?.projectId, checkpointSupported]);
  const nativeAccessKey = nativeLink && snapshot.session.id === sessionId
    ? JSON.stringify([client.connection?.environmentId, client.connection?.endpoint,
        sessionId, nativeLink.provider, nativeSourceKey(nativeLink), nativeLink.accountId])
    : undefined;
  const checkNativeAccess = connected && foreground && !pageOverlayOpen && view === "chat";
  const nativeAccess = checkNativeAccess && nativeAccessResult?.key === nativeAccessKey
    ? nativeAccessResult?.value : undefined;
  useEffect(() => {
    setNativeAccessResult(undefined);
    if (!checkNativeAccess || !nativeAccessKey || !sessionId || !nativeLink) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const unavailable = (): NativeSessionAccess => ({
      state: "unknown", reason: "hostUnavailable", path: nativeLink.path, checkedAt: Date.now(),
    });
    const check = async () => {
      let value: NativeSessionAccess;
      try {
        const access = await client.nativeAccess(sessionId);
        value = access && access.path === nativeLink.path ? access : unavailable();
      } catch {
        value = unavailable();
      }
      if (!current) return;
      setNativeAccessResult({ key: nativeAccessKey, value });
      // One probe at a time: a slow response must not overwrite a newer owner.
      timer = setTimeout(check, 5_000);
    };
    void check();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [checkNativeAccess, nativeAccessKey]);
  const now = useNow(30_000, foreground && (drawerOpen || view === "home"));
  const [theme, setTheme] = usePreferenceState(loadThemePreference);
  const [skin, setSkin] = usePreferenceState<MobileSkinPreference>(loadMobileSkin);
  const [glass, setGlass] = usePreferenceState<GlassSettings>(readGlassSettings);
  const [backgroundPath] = usePreferenceState(loadChatBackgroundPath);
  const [backgroundEffect] = usePreferenceState(loadNewThreadBackgroundEffect);
  useSyncExternalStore(subscribeProjectChatBackground, projectChatBackgroundRevision, projectChatBackgroundRevision);
  const projectBackground = project && client.connection
    ? loadProjectChatBackgroundSettings(`@project:${encodeURIComponent(client.connection.environmentId)}:${encodeURIComponent(project.id)}`) : null;
  const projectBackgroundUrl = useProjectBackgroundEffect(projectBackground?.path ?? null,
    projectBackground?.effect ?? "none", projectChatBackgroundImageRevision());
  const projectBackgroundStyle = projectBackground ? {
    "--chat-background-image": projectBackgroundUrl ? `url(${JSON.stringify(projectBackgroundUrl)})` : "none",
    "--chat-background-opacity": String(projectBackground.opacity),
  } as CSSProperties : undefined;
  const navigation = useRef(0);
  const appRoot = useRef<HTMLDivElement>(null);
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const setAppRoot = useCallback((element: HTMLDivElement | null) => {
    appRoot.current = element;
    setOverlayHost(element);
  }, []);
  const header = useRef<HTMLElement>(null);
  const navigationReady = useRef(false);
  useEffect(() => { if (!loading) navigationReady.current = true; }, [loading]);
  const loadTiming = useRef<{ turn: number; id: string; start: number; cached: boolean }>(undefined);
  const queueView = useRef({ view, sessionId });
  const queueOverlayClose = useRef<(() => void) | undefined>(undefined);
  const transcriptOverlayClose = useRef<(() => void) | undefined>(undefined);
  const onTranscriptOverlayChange = useCallback((close?: () => void) => {
    transcriptOverlayClose.current = close;
    if (close) setComposerPanel(null);
  }, []);
  const onQueueOverlayChange = useCallback((close?: () => void) => {
    queueOverlayClose.current = close;
    if (close) setComposerPanel(null);
  }, []);
  queueView.current = { view, sessionId };
  const connectionTrigger = useRef<HTMLButtonElement>(null);
  const projectTrigger = useRef<HTMLButtonElement>(null);
  const sessionActionsTrigger = useRef<HTMLButtonElement>(null);
  const sessionStatusTrigger = useRef<HTMLButtonElement>(null);
  const projectGeneration = useRef(0);

  // A selected device owns the whole page, including the failure/loading state.
  // Run before paint: the client changes identity before verification can finish.
  useLayoutEffect(() => {
    if (previousConnection.current === connectionKey) return;
    const previous = previousConnection.current;
    previousConnection.current = connectionKey;
    if (previous && project && (draft.get() || attachments.length || parkedDrafts.current.length)) {
      hostDrafts.current.set(previous, { projectId: project.id, sessionId,
        text: draft.get(), attachments, planMode, accepted: acceptedQueueAttachments.current,
        parked: parkedDrafts.current });
    }
    navigation.current += 1;
    projectGeneration.current += 1;
    loadTiming.current = undefined;
    setProjects([]);
    setProjectListState("loading");
    setProject(undefined);
    setSessions([]);
    setSessionId(undefined);
    setSnapshot(undefined);
    setSessionConfirmed(false);
    setNativeAccessResult(undefined);
    setCatalog(undefined);
    setCatalogLoading(false);
    setHistoryLoading(false);
    setLoading(false);
    setDraft("");
    setAttachments([]);
    acceptedQueueAttachments.current = [];
    parkedDrafts.current = [];
    setPlanMode(false);
    setPending(undefined);
    setError("");
    setHostError("");
    setSharedStateError("");
    setPollError("");
    setHomeProjectId(undefined);
    setAllProjectsPage(false);
    setSearchOpen(false);
    setComposerPanel(null);
    setSessionActionsOpen(false);
    setSessionActionsTarget(undefined);
    setHomeActionSession(undefined);
    setSessionStatusOpen(false);
    setAddingProject(false);
    setNotesOpen(false);
    setBotResume(undefined);
    botsReturnSession.current = undefined;
    setPreferencePanel(null);
    setConnected(!!connectionKey && !client.connection?.disabled);
    setView(connectionKey ? "home" : "settings");
  }, [connectionKey]);

  useEffect(() => {
    if (!searchOpen || view !== "home") setSearchQuery("");
    if (view !== "home") setSearchOpen(false);
  }, [searchOpen, view]);

  useEffect(() => {
    applyMobileSkin(skin, theme);
    // Only the automatic skin follows the device appearance.
    if (skin !== "auto" || theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyMobileSkin(skin, theme);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [skin, theme]);

  useEffect(() => {
    applyGlassSettings(glass);
  }, [glass]);

  useEffect(() => {
    let live = true;
    const attempt = ++hostAttempt.current;
    const current = () => live && hostAttempt.current === attempt;
    void (async () => {
      try {
        migrateConnectionSettings(await client.savedConnections().catch(() => []));
        const [restored, pending] = await Promise.all([client.restore(), client.pending()]);
        if (current()) setPending(pending);
        if (restored) {
          const location = await prepareSharedState();
          if (!current()) return;
          const items = await client.projects();
          if (current()) {
            setConnected(true);
            setProjects(items);
            setProjectListState("ready");
            setProject((current) => current ?? items[0]);
            setUrl((value) => value || client.connection!.endpoint);
            await restoreLocation(items, location);
          }
        }
      } catch (problem) {
        if (current()) {
          setHostError(message(problem));
          setUrl((value) => value || (client.connection?.endpoint ?? ""));
          if (client.connection && !client.connection.disabled) {
            if (!activePreferenceStore() && client.getConnectionStatus().reason !== "identity" && client.getConnectionStatus().reason !== "authentication")
              await prepareSharedState().catch(() => undefined);
            if (!current()) return;
            setConnected(true);
            setView("home");
            setProjectListState("failed");
          }
        }
      } finally {
        if (current()) setLoading(false);
        if (live) setInitialRestorePending(false);
      }
    })();
    const onVisibility = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    const listener = Capacitor.isNativePlatform()
      ? App.addListener("appStateChange", (state) =>
          setForeground(state.isActive),
        )
      : undefined;
    return () => {
      live = false;
      stopSharedState();
      document.removeEventListener("visibilitychange", onVisibility);
      void listener?.then((handle) => handle.remove());
    };
  }, []);

  useEffect(() => {
    if (!connected || hostStatus.state !== "connected" || !foreground || pageOverlayOpen || !drawerOpen || !project) return;
    const ids = [project.id];
    lists.seed(ids, onCachedSessions, true);
    const changed = () => {
      const history = lists.getSnapshot()[project.id];
      if (history?.sessions) setSessions(history.sessions);
      if (history?.failed) setPollError(message(history.error));
    };
    changed();
    return lists.subscribe(ids, changed, true);
  }, [connected, hostStatus.state, foreground, pageOverlayOpen, drawerOpen, project?.id, lists, onCachedSessions]);

  useEffect(() => {
    if (!connected || hostStatus.state !== "connected" || !foreground || pageOverlayOpen || (view === "settings" && !drawerOpen)) return;
    let live = true;
    const turn = navigation.current;
    const hostId = client.connection?.endpoint;
    const current = () => live && navigation.current === turn && hostId === client.connection?.endpoint;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    setPollError("");
    const poll = async () => {
      let running = false;
      try {
        if (drawerOpen || view === "home") {
          const items = await client.projects();
          if (current()) {
            setProjects(items);
            setProjectListState("ready");
            setProject((selected) => selected ?? items[0]);
            setHostError("");
          }
        }
        if (view === "chat" && sessionId) {
          const result = await client.session(sessionId);
          if (current()) {
            setSnapshot((previous) =>
              previous &&
              previous.session.id === result.session.id &&
              previous.revision > result.revision
                ? previous
                : result,
            );
            setSessionConfirmed(true);
            setLoading(false);
          }
          running = result.status === "running";
        }
        if (!running && drawerOpen && listRunning.current) running = true;
        if (current()) {
          failures = 0;
          setPollError("");
          const pending = await client.pending();
          if (current()) setPending(pending);
        }
      } catch (problem) {
        if (current()) {
          failures += 1;
          setPollError(message(problem));
          setProjectListState((state) => state === "ready" ? state : "failed");
        }
      }
      if (live)
        timer = setTimeout(
          poll,
          failures
            ? Math.min(30_000, 2000 * 2 ** failures)
            : running
              ? view === "chat" && sessionId && !drawerOpen
                ? 250
                : 750
              : 3000,
        );
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    connected,
    connectionKey,
    connectionRevision,
    hostStatus.state,
    foreground,
    pageOverlayOpen,
    view,
    drawerOpen,
    project,
    sessionId,
    snapshot?.status,
  ]);

  useLayoutEffect(() => {
    const timing = loadTiming.current;
    if (!snapshot || !timing || snapshot.session.id !== timing.id || navigation.current !== timing.turn)
      return;
    // Record committed text/layout without background-tab frame throttling.
    // Keep only the latest measure per path for local browser diagnostics.
    const name = timing.cached ? "omnicode.mobile.session.cached" : "omnicode.mobile.session.network";
    const end = performance.now();
    appRoot.current?.setAttribute("data-session-load-ms", (end - timing.start).toFixed(3));
    appRoot.current?.setAttribute("data-session-load-source", timing.cached ? "cache" : "network");
    appRoot.current?.setAttribute("data-session-load-stage", "commit");
    try {
      performance.clearMeasures(name);
      performance.measure(name, { start: timing.start, end });
    } catch { /* Timing support must not affect conversation rendering. */ }
    loadTiming.current = undefined;
  });

  useEffect(() => {
    if (!connected || !foreground || pageOverlayOpen || view !== "chat") return;
    let live = true;
    let request = 0;
    const hostId = client.connection?.endpoint;
    const hydrate = () => {
      const value = snapshotStore.get();
      const turn = ++request;
      if (!value) return;
      void client.sessionPreviews(value.session.id).then((result) => {
        if (live && turn === request && hostId === client.connection?.endpoint && result)
          setSnapshot((previous) => previous?.session.id === result.session.id
            && previous.revision <= result.revision ? result : previous);
      }).catch(() => {});
    };
    const unsubscribe = snapshotStore.subscribe(hydrate);
    hydrate();
    return () => { live = false; unsubscribe(); };
  }, [connected, connectionKey, foreground, pageOverlayOpen, view, snapshotStore]);

  useEffect(() => {
    const environmentId = client.connection?.environmentId;
    const projectId = view === "home" ? homeProjectId ?? project?.id : project?.id;
    if (!connected || !environmentId || workspaceHost.current !== environmentId || !projectId || loading || (view !== "chat" && view !== "home")) return;
    const location = {
      environmentId,
      projectId,
      ...(view === "chat" && sessionId ? { sessionId } : {}),
    };
    saveLastLocation(location);
    void saveMobileWorkspace(client, location).catch((problem) => setSharedStateError(message(problem)));
  }, [connected, project?.id, homeProjectId, sessionId, view, loading]);

  useEffect(() => {
    if (connected && foreground) void flushMobileWorkspace(client).catch(() => undefined);
  }, [connected, foreground, connectionRevision]);

  useEffect(() => {
    const environmentId = client.connection?.environmentId;
    if (!connected || hostStatus.state !== "connected" || loading || busy || preparingSharedState.current
      || !environmentId || workspaceHost.current === environmentId || !client.hasCapability("workspaces.read")) return;
    let live = true;
    const attempt = hostAttempt.current;
    void (async () => {
      try {
        const location = await prepareSharedState();
        const items = await client.projects();
        if (!live || attempt !== hostAttempt.current || client.connection?.environmentId !== environmentId) return;
        setProjects(items);
        setProjectListState("ready");
        await restoreLocation(items, location);
      } catch (problem) {
        if (live && attempt === hostAttempt.current) setHostError(message(problem));
      }
    })();
    return () => { live = false; };
  }, [connected, hostStatus.state, connectionKey, loading, busy]);

  useEffect(() => subscribeSharedPreferences(() => {
    if (!project || sessionId || draftConfigurationChanged.current) return;
    const defaults = loadMobileProjectDefaults(client.connection, project.id);
    draftDefaults.current = defaults;
    const next = catalog && firstConfiguration(catalog, defaults);
    if (next) setConfiguration(next);
  }), [project, sessionId, catalog]);

  const refreshSavedHosts = useCallback(() => {
    void client.savedConnections().then(setSavedHosts).catch(() => undefined);
  }, [client]);
  useEffect(refreshSavedHosts, [refreshSavedHosts, connectionKey, connectionRevision, connected]);
  const openAddConnection = () => {
    setError("");
    setPairingError("");
    setPairingSuccess(undefined);
    setAddingConnection(true);
  };
  const connect = async (credentials = { url, token }) => {
    if (pairingInFlight.current) return;
    pairingInFlight.current = true;
    setPairing(true);
    setPairingError("");
    let pairedHost: { name: string } | undefined;
    try {
      await activateConnection(
        async () => {
          await client.connect(credentials.url, normalizePairingCode(credentials.token));
          pairedHost = { name: client.connection!.name };
          setPairingSuccess(pairedHost);
        },
        (problem) => {
          // The code has already been redeemed if workspace loading fails.
          // Keep the successful pairing and report that separate Host error.
          if (pairedHost) setHostError(message(problem));
          else setPairingError(connectionErrorMessage(problem, credentials.url));
        },
      );
    } finally {
      pairingInFlight.current = false;
      setPairing(false);
    }
  };
  const switchHost = (endpoint: string, after?: (projects: HostProject[]) => void) => {
    // A newer switch supersedes one still loading, so a stalled Host never traps the picker.
    if (pairing) return;
    setHostPickerOpen(false);
    if (client.connection?.endpoint === endpoint && !client.connection.disabled) return;
    setDrawerOpen(false);
    void activateConnection(
      () => client.switchTo(endpoint),
      (problem) => setHostError(message(problem)),
      after,
    );
  };
  const activateConnection = async (
    open: () => Promise<void>,
    fail: (problem: unknown) => void,
    /** Continues navigation once the new Host's Home is ready. */
    after?: (projects: HostProject[]) => void,
  ) => {
    const attempt = ++hostAttempt.current;
    const current = () => hostAttempt.current === attempt;
    setBusy(true);
    setError("");
    setHostError("");
    setPollError("");
    stopSharedState();
    // Connection progress and failures stay inline; only confirm a completed switch.
    try {
      await open();
      if (!current()) return;
      const location = await prepareSharedState();
      if (!current()) return;
      setLoading(false);
      const items = await client.projects();
      if (!current()) return;
      projectGeneration.current += 1;
      setProject(undefined);
      setSessionId(undefined);
      setSnapshot(undefined);
      setSessionConfirmed(false);
      setCatalog(undefined);
      setCatalogLoading(false);
      setAttachments([]);
      acceptedQueueAttachments.current = [];
      parkedDrafts.current = [];
      setPlanMode(false);
      setToken("");
      setUrl(client.connection!.endpoint);
      setProjects(items);
      setSessions([]);
      setProjectListState("ready");
      setConnected(true);
      setConnectionRevision((value) => value + 1);
      const pending = await client.pending();
      if (!current()) return;
      setPending(pending);
      await restoreLocation(items, location);
      if (current()) after?.(items);
    } catch (problem) {
      if (current()) {
        fail(problem);
        setProjectListState((state) => state === "ready" ? state : "failed");
      }
    } finally {
      if (current()) setBusy(false);
      refreshSavedHosts();
    }
  };
  const openProject = async (
    item: HostProject,
    nextView: View = "chat",
  ): Promise<HostSessionSummary[] | undefined> => {
    const turn = ++navigation.current;
    const projectTurn = ++projectGeneration.current;
    setProject(item);
    setSessions(client.cachedSessions?.(item.id) ?? []);
    const defaults = loadMobileProjectDefaults(client.connection, item.id);
    draftDefaults.current = defaults;
    draftConfigurationChanged.current = false;
    const cachedCatalog = client.cachedModels(item.id);
    setCatalog(cachedCatalog);
    setCatalogLoading(!cachedCatalog);
    setConfiguration((cachedCatalog && firstConfiguration(cachedCatalog, defaults)) ?? {
      harness: "codex", model: "", modelSettings: {},
      runtimeMode: defaults.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    });
    setSessionId(undefined);
    setWorkspace(CURRENT_WORKSPACE);
    setWorktreeCreation(undefined);
    setChatPageKey(`draft:${item.id}:${turn}`);
    setSnapshot(undefined);
    setSessionConfirmed(false);
    setAnimateFrom(undefined);
    setComposerPanel(null);
    setSessionActionsOpen(false);
    setSessionStatusOpen(false);
    setView(nextView);
    setSessionEntrySource("other");
    setLoading(false);
    setHistoryLoading(true);
    setError("");
    // Provider discovery can launch CLIs; it is independent of history and
    // must never hold the conversation's first paint behind the slowest CLI.
    void client.models(item.id).then((catalog) => {
      if (projectGeneration.current !== projectTurn) return;
      setCatalog(catalog);
      const first = firstConfiguration(catalog, defaults);
      if (first && !draftConfigurationChanged.current) setConfiguration((current) => ({
        ...first, runtimeMode: current.runtimeMode,
      }));
    }).catch((problem) => {
      if (projectGeneration.current === projectTurn) setError(message(problem));
    }).finally(() => {
      if (projectGeneration.current === projectTurn) setCatalogLoading(false);
    });
    try {
      const history = await client.sessions(item.id);
      if (projectGeneration.current !== projectTurn) return;
      setSessions(history);
      return history;
    } catch (problem) {
      if (navigation.current === turn) setError(message(problem));
    } finally {
      if (projectGeneration.current === projectTurn) setHistoryLoading(false);
    }
  };
  // Only boot and an explicit Host switch restore the shared location.
  const restoreLocation = async (items: HostProject[], restored?: WorkspaceLocation) => {
    const environmentId = client.connection?.environmentId;
    const last = restored ?? readLastLocation(environmentId);
    const target =
      items.find((item) => item.id === last?.projectId) ?? items[0];
    setView("home");
    setHomeProjectId(undefined);
    setAllProjectsPage(false);
    setSearchOpen(false);
    setSettingsPage("root");
    setProject(target);
    // Warm the likely next conversation's catalog while Home is already usable.
    // Navigation shares this in-flight request; failures are retried on entry.
    if (target) void client.models(target.id).catch(() => {});
    if (target && restored?.sessionId && restored.projectId === target.id) await openSession(restored.sessionId, target.id);
    if (client.connection?.environmentId === environmentId) workspaceHost.current = environmentId;
  };
  const openSession = async (
    id?: string,
    restoredProjectId?: string,
    entrySource: "project" | "other" | "bot" = "other",
    resolved?: HostSession,
  ) => {
    const start = performance.now();
    appRoot.current?.removeAttribute("data-session-load-ms");
    appRoot.current?.removeAttribute("data-session-load-source");
    const turn = ++navigation.current;
    if (id) draftConfigurationChanged.current = true;
    const known = resolved ?? (id ? client.cachedSession(id) : undefined);
    // A run that continued after this conversation was last open leaves the
    // list ahead of the snapshot. Painting it would flash long-past messages
    // before the sync replaces them, so wait for the sync instead.
    const listed = known && client.cachedSessions?.(known.projectId)?.find((item) => item.id === id);
    const cached = known && (!listed || listed.revision <= known.revision) && (!restoredProjectId ||
      (known.projectId === restoredProjectId && !known.archived)) ? known : undefined;
    loadTiming.current = id ? { turn, id, start, cached: !!cached } : undefined;
    setSessionId(id);
    setWorkspace(CURRENT_WORKSPACE);
    setWorktreeCreation(undefined);
    setChatPageKey((current) => id ?? (current.startsWith("draft:") ? current : `draft:${restoredProjectId ?? project?.id ?? ""}`));
    setSnapshot(cached);
    setSessionConfirmed(false);
    if (cached) setConfiguration(configurationForSession(cached));
    setAnimateFrom(undefined);
    const hostId = client.connection?.endpoint;
    const savedDraft = hostId ? hostDrafts.current.get(hostId) : undefined;
    const restoreDraft = savedDraft?.projectId === (restoredProjectId ?? project?.id) && savedDraft?.sessionId === id
      ? savedDraft : undefined;
    setDraft(restoreDraft?.text ?? "");
    setAttachments(restoreDraft?.attachments ?? []);
    acceptedQueueAttachments.current = restoreDraft?.accepted ?? [];
    parkedDrafts.current = restoreDraft?.parked ?? [];
    setPlanMode(restoreDraft?.planMode ?? false);
    if (restoreDraft && hostId) hostDrafts.current.delete(hostId);
    setComposerPanel(null);
    setSessionActionsOpen(false);
    setSessionStatusOpen(false);
    setDrawerOpen(false);
    setView("chat");
    setSessionEntrySource(entrySource);
    setLoading(!!id);
    setError("");
    if (!id) return;
    try {
      const result = resolved ?? await client.session(id);
      if (navigation.current === turn) {
        if (restoredProjectId && (result.projectId !== restoredProjectId || (result.archived && entrySource !== "bot"))) {
          const owner = projects.find((item) => item.id === restoredProjectId);
          if (owner) void openProject(owner);
          await openSession(undefined, undefined, entrySource);
          return;
        }
        setSnapshot((previous) => previous && previous.session.id === result.session.id &&
          previous.revision > result.revision ? previous : result);
        setSessionConfirmed(true);
        setConfiguration(configurationForSession(result));
      }
    } catch (problem) {
      if (navigation.current === turn) setError(message(problem));
    } finally {
      if (navigation.current === turn) setLoading(false);
    }
  };
  const openBotSession = useStableCallback(async (ref: SessionReference, target: BotTarget, bot: MobileBotSelection) => {
    if (client.connection?.environmentId !== ref.environmentId)
      throw new Error("This conversation belongs to another Host");
    if (view !== "bots" || target.project.id !== ref.projectId || target.session.projectId !== ref.projectId ||
      target.session.session.id !== ref.sessionId)
      throw new Error("Conversation is unavailable");
    setBotResume(bot);
    // Initialize the source project's catalog/history before showing its already verified session.
    if (project?.id !== target.project.id) void openProject(target.project, "bots");
    await openSession(ref.sessionId, ref.projectId, "bot", target.session);
  });
  const activity = useMobileActivity(client, {
    snapshots: snapshotStore,
    connected,
    foreground,
    assistantVisible: assistantOpen && !notesOpen,
    visibleSession: view === "chat" && !pageOverlayOpen && !drawerOpen && !loading && sessionConfirmed && snapshot && snapshot.session.id === sessionId
      ? { id: snapshot.session.id, projectId: snapshot.projectId, revision: snapshotStore.get()!.revision,
          lastCompletedRunId: snapshot.lastCompletedRunId, pendingInputKey: snapshot.pendingInputKey }
      : undefined,
    language,
    onOpen: async (target) => {
      if (target.kind === "assistant") {
        setNotesOpen(false);
        onDrawerAssistant();
        return;
      }
      const openedAt = navigation.current;
      try {
        const items = await client.projects();
        const owningProject = items.find((item) => item.id === target.projectId);
        if (!owningProject || client.connection?.environmentId !== target.environmentId || navigation.current !== openedAt) return;
        setProjects(items);
        const projectNavigation = navigation.current + 1;
        await openProject(owningProject);
        if (navigation.current !== projectNavigation) return;
        await openSession(target.sessionId);
      } catch (problem) { setError(message(problem)); }
    },
  });
  const dispatch = useCallback(
    async (command?: HostCommand, text?: string | MobileFirstMessage) => {
      const startedAt = navigation.current;
      const startedPage = chatPageIdentity.current;
      setBusy(true);
      setError("");
      try {
        const completedCommand = command ?? (await client.pending())?.command;
        const receipt = command
          ? await client.dispatch(command, text)
          : await client.retryPending();
        setPending(undefined);
        // A recovered create/send can belong to a different project than the
        // currently visible one. Navigate to its actual owning project.
        const result = await client.session(receipt.sessionId, receipt.revision);
        const sending = sendingRef.current;
        if (completedCommand?.type === "create" && sending?.commandId === completedCommand.commandId)
          transcriptKeys.current.set(receipt.sessionId, sending.commandId);
        if (
          completedCommand?.type === "send" ||
          completedCommand?.type === "create"
        ) {
          setAnimateFrom(
            [...result.session.blocks]
              .reverse()
              .find((block) => block.role === "user")?.id,
          );
        }
        const owner = projects.find((item) => item.id === result.projectId);
        if (owner) {
          const changedProject = owner.id !== project?.id;
          setProject(owner);
          if (changedProject) {
            const projectTurn = ++projectGeneration.current;
            setCatalog(undefined);
            setCatalogLoading(true);
            try {
              const nextCatalog = await client.models(owner.id);
              if (projectGeneration.current === projectTurn) setCatalog(nextCatalog);
            } finally {
              if (projectGeneration.current === projectTurn) setCatalogLoading(false);
            }
          }
        }
        setSessionId(receipt.sessionId);
        const samePage = navigation.current === startedAt && chatPageIdentity.current === startedPage;
        if (!(samePage && queueView.current.view === "chat" &&
          (queueView.current.sessionId === receipt.sessionId ||
            (completedCommand?.type === "create" && !queueView.current.sessionId && project?.id === result.projectId))))
          setChatPageKey(receipt.sessionId);
        setSnapshot(result);
        setSessionConfirmed(true);
        setConfiguration(configurationForSession(result));
        setView("chat");
        if (
          (completedCommand?.type === "send" && !completedCommand.questionAnswer) ||
          completedCommand?.type === "create"
        ) {
          const previousDraft = parkedDrafts.current.pop();
          setDraft(previousDraft?.text ?? "");
          setAttachments(previousDraft?.attachments ?? []);
          acceptedQueueAttachments.current = previousDraft?.accepted ?? [];
          if (previousDraft) setPlanMode(previousDraft.planMode);
        }
        return receipt;
      } catch (problem) {
        setError(message(problem));
        setPending(await client.pending());
      } finally {
        setBusy(false);
      }
    },
    [projects, project?.id],
  );
  const queueRequest = useCallback(
    async (
      command: Extract<HostCommand, { type: "queue" }>,
      transient: boolean,
    ) => {
      const generation = navigation.current;
      if (!transient) {
        setBusy(true);
        setError("");
      }
      try {
        const receipt = transient
          ? await client.rpc<
              import("../../features/connections/model/protocol").CommandReceipt
            >("commands.dispatch", command)
          : await client.dispatch(command);
        const result = await client.session(command.sessionId, receipt.revision);
        if (navigation.current === generation && queueView.current.view === "chat" && queueView.current.sessionId === command.sessionId) {
          setSnapshot((current) =>
            current &&
            current.session.id === result.session.id &&
            current.revision > result.revision
              ? current
              : result,
          );

        }
        if (!transient) setPending(undefined);
        return receipt;
      } catch (problem) {
        if (navigation.current === generation && queueView.current.view === "chat" && queueView.current.sessionId === command.sessionId) {
          setError(message(problem));

        }
        if (!transient) setPending(await client.pending());
        throw problem;
      } finally {
        if (!transient) setBusy(false);
      }
    },
    [],
  );
  const placeholder = !snapshot && sendingMessage && !sendingMessage.sessionId
    && project?.id === sendingMessage.placeholder?.projectId ? sendingMessage.placeholder : undefined;
  const transcriptSessionId = snapshot?.session.id ?? placeholder?.session.id;
  const queue = useHostQueue(snapshot, queueRequest);
  const restoreQueuedMessage = useStableCallback(async (queued: QueuedMessage) => {
    if (!sessionId) return;
    const generation = navigation.current;
    setReadingAttachments(true);
    try {
      await takeBackQueuedMessage(queued, {
        read: (id, offset) =>
          client.rpc("attachments.read", { sessionId, id, offset }),
        remove: queue.onDelete,
        current: () => generation === navigation.current,
        pendingRemoval: async (id) => {
          const removal = (await client.pending())?.command;
          return removal?.type === "queue" &&
            removal.action === "remove" && removal.messageId === id;
        },
        restore: (restored) => {
          if (generation !== navigation.current) return;
          const text = draft.get();
          if (text.trim() || attachments.length) {
            parkedDrafts.current.push({
              text, attachments, planMode,
              accepted: acceptedQueueAttachments.current,
            });
          }
          acceptedQueueAttachments.current = queued.attachments;
          setDraft(queued.text);
          setAttachments(restored);
          setPlanMode(queued.intent === "plan");
          setComposerPanel(null);
          requestAnimationFrame(() => {
            if (generation === navigation.current)
              appRoot.current?.querySelector<HTMLTextAreaElement>('[data-page-active="true"] .mobile-composer textarea')?.focus();
          });
        },
      });
    } finally {
      setReadingAttachments(false);
    }
  });
  const send = async () => {
    const text = draft.get();
    if (
      !project ||
      (!text.trim() && !attachments.length) ||
      busy ||
      pending ||
      readingAttachments ||
      (!!sessionId && !sessionConfirmed) ||
      nativeWriteBlocked(snapshot, nativeAccess) ||
      (snapshot?.status === "running" && !snapshot.supportsQueue)
    )
      return;
    if (isCompactCommand(text)) {
      if (attachments.length) {
        setError(t("Remove attachments before compacting context."));
        return;
      }
      if (!snapshot || snapshot.status !== "idle" || !["codex", "claude", "grok", "opencode", "pi", "omp"].includes(snapshot.session.harness)) {
        setError(t("Context compaction is unavailable for this conversation."));
        return;
      }
      const generation = navigation.current;
      const receipt = await dispatch({ type: "compact", sessionId: snapshot.session.id, commandId: crypto.randomUUID() });
      if (receipt && navigation.current === generation) setDraft("");
      return;
    }
    const parsed = consumePlanCommand(text);
    if (parsed.planning && !parsed.text.trim() && !attachments.length) {
      setPlanMode(true);
      setDraft("");
      return;
    }
    if (
      !sessionId &&
      !catalog?.models[configuration.harness]?.some(
        (item) => item.id === configuration.model,
      )
    ) {
      setError(
        t(
          "No available model. Install and sign in to a provider on this Host.",
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    const generation = navigation.current;
    const commandId = crypto.randomUUID();
    const sent = { text, attachments };
    // Show the message at once where the Host will record it: in the
    // transcript, or in the queue of a conversation that is busy.
    const instant = sessionId
      ? !!snapshot && snapshot.session.id === sessionId
      : !snapshot;
    if (instant) {
      const outgoing: OutgoingMessage = {
        id: commandId,
        text: parsed.text,
        startedAt: Date.now(),
        placement: sessionId ? outgoingPlacement(snapshotStore.get(), followUpBehavior) : "transcript",
        ...(attachments.length ? { attachments } : {}),
      };
      const block: Block = {
        id: commandId,
        role: "user",
        text: parsed.text,
        startedAt: outgoing.startedAt,
        sending: true,
        ...(attachments.length ? { attachments } : {}),
      };
      setSendingMessage({
        commandId,
        sessionId,
        outgoing,
        ...(sessionId ? {} : {
          placeholder: {
            session: {
              id: block.id,
              harness: configuration.harness,
              model: configuration.model,
              modelSettings: configuration.modelSettings,
              runtimeMode: configuration.runtimeMode,
              title: "",
              cwd: project.cwd,
              blocks: [block],
            },
            projectId: project.id,
            revision: 0,
            status: "idle",
            updatedAt: Date.now(),
          },
        }),
      });
      if (!sessionId) setAnimateFrom(block.id);
      setDraft("");
      setAttachments([]);
    }
    let recorded = false;
    try {
      const hostId = client.connection?.endpoint;
      const providerAccountId = !sessionId
        ? defaultProviderAccount(configuration.harness, draftDefaults.current)
        : undefined;
      if (providerAccountId) {
        const accounts = await client.providerAccounts();
        if (!accounts) throw new Error(t("Provider accounts are unavailable on this Host."));
        if (!accounts[configuration.harness]?.some((account) => account.id === providerAccountId))
          throw new Error(t("This provider account is no longer available. Choose an account in Settings and start a new conversation."));
      }
      if (generation !== navigation.current || hostId !== client.connection?.endpoint) return;
      const uploaded = await client.uploadAttachments(attachments, acceptedQueueAttachments.current);
      if (generation !== navigation.current || hostId !== client.connection?.endpoint) return;
      const prompt: MobileFirstMessage = {
        text: parsed.text,
        ...(uploaded.length ? { attachments: uploaded } : {}),
        ...(planMode || parsed.planning ? { intent: "plan" } : {}),
      };
      if (sessionId) {
        recorded = !!await dispatch({
          ...prompt,
          type: "send",
          commandId,
          sessionId,
          followUpBehavior,
        });
      } else {
        let executionCwd = workspace.mode === "current" ? workspace.cwd : undefined;
        let created: PersistedWorktreeCreation | undefined;
        if (workspace.mode === "worktree") {
          // Created before the conversation, as on desktop; its log sits under
          // the first message until the Host's copy of that message keeps it.
          const base = workspace.base ?? "HEAD";
          const creationId = crypto.randomUUID();
          setWorktreeCreation(anchorWorktreeCreation(startWorktreeCreation(base, creationId), creationId, commandId));
          try {
            const branch = await client.worktreeName(
              project.id,
              project.cwd,
              configuration.harness,
              parsed.text || attachments.map((file) => file.name).join(", "),
            );
            if (generation !== navigation.current || hostId !== client.connection?.endpoint) return;
            const tree = await client.worktreeCreate(project.id, project.cwd, branch, base);
            const finished = completeWorktreeCreation(
              (tree.log ?? []).reduce(
                (next, line) => appendWorktreeCreationLog(next, creationId, line),
                startWorktreeCreation(base, creationId),
              ),
              creationId,
              tree.path,
            );
            if (generation !== navigation.current || hostId !== client.connection?.endpoint) return;
            created = persistWorktreeCreation(finished);
            executionCwd = tree.path;
            // Retrying a failed start reuses this worktree instead of making another.
            setWorkspace({ mode: "current", cwd: tree.path, linkedWorktree: !tree.isMain });
            setWorktreeCreation(anchorWorktreeCreation(finished, creationId, commandId));
            window.setTimeout(() => setWorktreeCreation((current) =>
              current?.id === creationId ? foldWorktreeCreation(current, creationId) : current,
            ), WORKTREE_CREATION_FOLD_MS);
          } catch (problem) {
            setWorktreeCreation((current) =>
              current?.id === creationId ? failWorktreeCreation(current, creationId, message(problem)) : current,
            );
            throw message(problem) === WORKTREE_NAME_ERROR ? new Error(t(WORKTREE_NAME_ERROR)) : problem;
          }
        }
        recorded = !!await dispatch(
          {
            type: "create",
            commandId,
            projectId: project.id,
            executionCwd,
            harness: configuration.harness,
            model: configuration.model,
            modelSettings: configuration.modelSettings,
            ...(providerAccountId ? { providerAccountId } : {}),
            runtimeMode: configuration.runtimeMode,
          },
          created ? { ...prompt, worktreeCreation: created } : prompt,
        );
      }
      if (generation === navigation.current) {
        if (recorded) void lightImpact();
        else void attentionHaptic();
      }
    } catch (problem) {
      if (generation === navigation.current) void attentionHaptic();
      setError(message(problem));
    } finally {
      setBusy(false);
      if (instant) {
        setSendingMessage(undefined);
        // Nothing was recorded: the message goes back to the composer.
        if (!recorded && navigation.current === generation && !draft.get()) {
          setDraft(sent.text);
          setAttachments(sent.attachments);
        }
      }
    }
  };
  const addFiles = async (files: File[]) => {
    if (busy || pending || readingAttachments) return;
    const generation = navigation.current;
    setReadingAttachments(true);
    setError("");
    try {
      const added = await readMobileAttachments(files, attachments.length);
      if (generation === navigation.current)
        setAttachments((current) => [...current, ...added]);
    } catch (problem) {
      if (generation === navigation.current) setError(message(problem));
    } finally {
      setReadingAttachments(false);
    }
  };
  const addProject = async (path: string) => {
    setBusy(true);
    setError("");
    try {
      const added = await client.openProject(path);
      setProjects(await client.projects());
      setAddingProject(false);
      setDrawerOpen(false);
      openHome(added);
    } finally {
      setBusy(false);
    }
  };
  const changeSettingsPage = useStableCallback((next: MobileSettingsPage) => {
    setPreferencePanel(null);
    setAboutOpen(false);
    setSettingsPage(next);
  });
  const navigate = (next: View) => {
    setHomeMenuOpen(false);
    setAboutOpen(false);
    if (next === "settings" && view !== "settings") settingsReturnView.current = view;
    navigation.current += 1;
    setLoading(false);
    setComposerPanel(null);
    setSessionActionsOpen(false);
    setSessionStatusOpen(false);
    setAddingConnection(false);
    setAddingProject(false);
    setPreferencePanel(null);
    setDrawerOpen(false);
    setSettingsPage("root");
    setView(next);
  };
  const openChats = () => {
    setHomeProjectId(CHATS_PAGE_ID);
    setAllProjectsPage(false);
    setSearchOpen(false);
    navigate("home");
  };
  const closeBots = useStableCallback(() => {
    const previous = botsReturnSession.current;
    if (botsReturnView.current === "chat" && previous) {
      if (project?.id !== previous.project.id) void openProject(previous.project, "home");
      void openSession(previous.sessionId, previous.project.id, previous.source);
    } else navigate(botsReturnView.current);
  });
  const backToBot = useStableCallback(() => navigate("bots"));
  const openHome = (owner?: HostProject, allProjects = false) => {
    setHomeProjectId(owner?.id);
    setAllProjectsPage(allProjects);
    setSearchOpen(false);
    navigate("home");
    if (owner) void client.models(owner.id).catch(() => {});
  };
  const updateSessionMetadata = async (
    patch: MobileSessionPatch,
    id = sessionId,
    ownerId = project?.id,
  ) => {
    if (!ownerId || !id) return;
    const turn = navigation.current;
    setBusy(true);
    try {
      const summary = await client.updateSession(ownerId, id, patch);
      const result = view === "chat" && id === sessionId ? await client.session(id, summary.revision) : undefined;
      if (navigation.current === turn) {
        lists.seed([ownerId], onCachedSessions, true);
        lists.refresh([ownerId]);
        setHomeRefreshKey((value) => value + 1);
        setHomeActionSession((current) => current?.id === id ? summary : current);
        if (result) {
          setSnapshot((previous) =>
            previous && previous.revision > result.revision ? previous : result,
          );
        }
        setSessions((items) =>
          items.map((item) => (item.id === id ? summary : item)),
        );
      }
    } finally {
      setBusy(false);
    }
  };
  const removeActiveConnection = async () => {
    navigation.current += 1;
    projectGeneration.current += 1;
    setBusy(true);
    const endpoint = client.connection?.endpoint;
    try {
      await client.disconnect();
      stopSharedState();
      setConnected(false);
      setProjects([]);
      setProject(undefined);
      setSessions([]);
      setSnapshot(undefined);
      setSessionConfirmed(false);
      setHistoryLoading(false);
      setSessionId(undefined);
      setError("");
      setHostError("");
      setSharedStateError("");
      setPollError("");
      if (endpoint) removeConnectionAppearance(endpoint);
    } catch (problem) {
      setError(message(problem));
      throw problem;
    } finally { setBusy(false); refreshSavedHosts(); }
    // Deleting the active Host falls back to another paired one.
    const next = (await client.savedConnections())[0];
    if (next)
      await activateConnection(() => client.switchTo(next.endpoint), (problem) => setHostError(message(problem)));
  };
  const reconnect = async () => {
    const attempt = ++hostAttempt.current;
    const hostId = client.connection?.endpoint;
    const current = () => hostAttempt.current === attempt && client.connection?.endpoint === hostId;
    setBusy(true);
    setHostError("");
    try {
      await client.reconnect();
      if (!current()) return;
      const location = workspaceReady.current === client.connection?.environmentId ? undefined : await prepareSharedState();
      if (!current()) return;
      await flushMobileWorkspace(client).catch(() => undefined);
      setConnectionRevision((value) => value + 1);
      setHomeRefreshKey((value) => value + 1);
      setPreferencePanel(null);
      const items = await client.projects();
      if (!current()) return;
      setProjects(items);
      setProjectListState("ready");
      setConnected(true);
      if (!connected) await restoreLocation(items, location);
      setError("");
      setPollError("");
    } catch (problem) {
      if (current()) setHostError(message(problem));
    } finally {
      if (current()) setBusy(false);
    }
  };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = App.addListener("backButton", () => {
      if (dismissImageLightbox()) return;
      if (backMobileSheet()) return;
      if (hostPickerOpen) setHostPickerOpen(false);
      else if (notesOpen) {
        if (notesPage.current) notesPage.current.back();
        else setNotesOpen(false);
      }
      else if (assistantOpen) {
        if (assistantPage.current) assistantPage.current.back();
        else closeBots();
      }
      else if (queueOverlayClose.current) queueOverlayClose.current();
      else if (sessionStatusOpen) setSessionStatusOpen(false);
      else if (sessionActionsOpen) {
        if (!busy) setSessionActionsOpen(false);
      } else if (preferencePanel) setPreferencePanel(null);
      else if (addingConnection) {
        if (!pairing || pairingSuccess) setAddingConnection(false);
      } else if (composerPanel) setComposerPanel(null);
      else if (addingProject) {
        if (!busy) setAddingProject(false);
      } else if (drawerOpen) setDrawerOpen(false);
      else if (transcriptOverlayClose.current) transcriptOverlayClose.current();
      else if (homeMenuOpen) setHomeMenuOpen(false);
      else if (view === "home" && searchOpen) setSearchOpen(false);
      else if (view === "settings" && settingsPage !== "root")
        changeSettingsPage(mobileSettingsParent(settingsPage));
      else if (view === "settings" && client.connection) navigate(settingsReturnView.current);
      else if (view === "chat" && sessionEntrySource === "bot") backToBot();
      else if (view === "chat") openHome(project);
      else if (view === "home" && homeProjectId) openHome();
      else void App.exitApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [
    assistantOpen,
    sessionEntrySource,
    notesOpen,
    view,
    connected,
    addingConnection,
    addingProject,
    composerPanel,
    preferencePanel,
    sessionActionsOpen,
    sessionStatusOpen,
    drawerOpen,
    hostPickerOpen,
    settingsPage,
    changeSettingsPage,
    busy,
    pairing,
    pairingSuccess,
    homeProjectId,
    searchOpen,
    homeMenuOpen,
    project,
  ]);

  const running = snapshot?.status === "running";
  // Home and drawer rows can belong to another project, so they carry their
  // own summary; the current project's rows stay live through `sessions`.
  const sessionActionsSummary = view === "home" ? homeActionSession : sessions.find(
    (item) => item.id === sessionActionsTarget,
  ) ?? (homeActionSession?.id === sessionActionsTarget ? homeActionSession : undefined);
  const nativeReadOnly = nativeWriteBlocked(snapshot, nativeAccess);
  const skillHarness = snapshot?.session.pendingConfiguration?.harness ?? snapshot?.session.harness ?? configuration.harness;
  const skillContextKey = `${client.connection?.endpoint ?? ""}\0${project?.id ?? ""}\0${skillHarness}\0${sessionId ?? ""}\0${snapshot?.session.executionCwd || snapshot?.session.cwd || project?.cwd || ""}`;
  const loadSkillCatalog = useCallback((refresh = false) => {
    if (!project) return Promise.reject(new Error("Open a project first."));
    return client.skills(project.id, skillHarness, sessionId, refresh);
  }, [project?.id, skillHarness, sessionId]);
  // Controls float above scrolling content; Home uses a plain title menu.
  const floatingHeader = true;
  const homeProject = projects.find((item) => item.id === homeProjectId);
  const homeChats = homeProjectId === CHATS_PAGE_ID;
  const homePageOpen = !!homeProject || homeChats;
  const route: MobileRoute = {
    key: view === "bots" ? "bots" : view === "settings" ? `settings:${settingsPage}` : view === "chat" ? `chat:${chatPageKey}`
      : `home:${homeProjectId ?? (allProjectsPage ? "all" : "root")}`,
    section: view,
    // Home depths are 0–2; chat is always above every list page.
    depth: view === "bots" ? 0 : view === "settings" ? (settingsPage === "root" ? 0 : 1)
      : view === "home" ? (homeProjectId ? 2 : allProjectsPage ? 1 : 0) : 3,
  };
  useMobileHeaderMotion(header, route, navigationReady.current);
  const title =
    view === "chat"
      ? (snapshot &&
          sessionDisplayTitle(
            snapshot.session.title,
            snapshot.session.harness,
          )) ||
        t("New conversation")
      : view === "home"
        ? homeProject?.name || (homeChats ? t("Chats") : allProjectsPage ? t("Projects") : "OmniCode")
        : t(mobileSettingsTitle(settingsPage));
  // Memoized children keep their handlers across shell updates.
  const onTranscriptCommand = useStableCallback(async (command: HostCommand) =>
    !!(await dispatch(command)),
  );
  // A pending question's panel can be folded away to read the conversation or
  // to type into the composer; its card in the transcript brings it back.
  const pendingQuestion = snapshot?.session.pendingQuestion;
  const pendingQuestionKey = pendingQuestion
    ? `${snapshot!.session.id}:${pendingQuestion.requestId}`
    : undefined;
  const [collapsedQuestion, setCollapsedQuestion] = useState<string>();
  const questionOpen = !!pendingQuestionKey && collapsedQuestion !== pendingQuestionKey;
  const onQuestionOpenChange = useStableCallback((open: boolean) => {
    setCollapsedQuestion(open ? undefined : pendingQuestionKey);
    const focused = document.activeElement;
    if (open && focused instanceof HTMLElement && focused.closest(".mobile-composer-dock"))
      focused.blur();
  });
  // A finished plan asks to be implemented from the composer's place. Typing
  // in the composer folds the panel away; leaving it empty brings it back.
  const planDecisionId = usePlanDecision(
    snapshotStore.get()?.session.blocks,
    !!snapshot && snapshot.status !== "running" && !pendingQuestion && !nativeReadOnly,
  );
  const [collapsedPlan, setCollapsedPlan] = useState<string>();
  const planDecisionOpen = !!planDecisionId && collapsedPlan !== planDecisionId;
  useEffect(() => {
    if (!collapsedPlan) return;
    const reopen = (event: FocusEvent) => {
      if (draft.get().trim()) return;
      const next = event.relatedTarget;
      if (next instanceof Element && next.closest(".mobile-composer-dock")) return;
      setCollapsedPlan(undefined);
    };
    document.addEventListener("focusout", reopen);
    return () => document.removeEventListener("focusout", reopen);
  }, [collapsedPlan, draft]);
  const sendPlanTurn = useStableCallback((text: string, intent?: "plan") => {
    if (!snapshot || busy || pending || !sessionConfirmed) return false;
    // Implementing leaves plan mode; a revision keeps planning.
    setPlanMode(intent === "plan");
    void dispatch({ type: "send", commandId: crypto.randomUUID(),
      sessionId: snapshot.session.id, text, ...(intent ? { intent } : {}) });
  });
  const planDecision = useMemo(() => planDecisionId ? {
    blockId: planDecisionId,
    open: planDecisionOpen,
    onImplement: () => sendPlanTurn(IMPLEMENT_PLAN_PROMPT),
    onRevise: (feedback: string) => sendPlanTurn(feedback, "plan"),
    onSkip: () => skipPlanDecision(planDecisionId),
  } : undefined, [planDecisionId, planDecisionOpen, sendPlanTurn]);
  const onDrawerOpenChange = useStableCallback((open: boolean) => {
    if (open) setHomeMenuOpen(false);
    if (open) setComposerPanel(null);
    setDrawerOpen(open);
  });
  const onDrawerHost = useStableCallback(() => {
    refreshSavedHosts();
    setHostPickerOpen(true);
  });
  const probeHost = useCallback((connection: Connection) => client.probeConnection(connection), []);
  // Settings rows carry no credentials; probe the saved connection with the same address.
  const probeSavedHost = useCallback((connection: { endpoint: string }) => {
    const saved = savedHosts.find((item) => item.endpoint === connection.endpoint);
    return saved ? client.probeConnection(saved) : Promise.resolve<HostConnectionStatus>({ state: "disconnected" });
  }, [savedHosts]);
  const pairedConnections = client.connection
    ? [client.connection, ...savedHosts.filter((item) => item.endpoint !== connectionKey)]
    : savedHosts;
  // Device chips keep their paired order instead of moving the active device first.
  const deviceConnections = client.connection && savedHosts.some((item) => item.endpoint === connectionKey)
    ? savedHosts.map((item) => item.endpoint === connectionKey ? client.connection! : item)
    : pairedConnections;
  const homeOverview = view === "home" && !homePageOpen && !allProjectsPage;
  const remoteHosts = useMobileHostDirectory(client, pairedConnections, connectionKey,
    homeScope === "all" && homeOverview && connected && foreground && !pageOverlayOpen);
  const onRemoteSession = useStableCallback((endpoint: string, id: string, owner: HostProject) =>
    switchHost(endpoint, (items) => {
      const target = items.find((item) => item.id === owner.id);
      if (!target) return;
      void openProject(target);
      void openSession(id, target.id);
    }));
  const onRemoteProject = useStableCallback((endpoint: string, owner: HostProject) =>
    switchHost(endpoint, (items) => {
      const target = items.find((item) => item.id === owner.id);
      if (target) openHome(target);
    }));
  const forgetConnection = async (endpoint: string) => {
    if (endpoint === client.connection?.endpoint) return removeActiveConnection();
    try {
      await client.forget(endpoint);
      removeConnectionAppearance(endpoint);
    } finally {
      refreshSavedHosts();
    }
  };
  // A conversation in another project opens that project with it, like a
  // restored location: history loads for the drawer while the chat opens.
  const onDrawerSession = useStableCallback((id: string, owner: HostProject) => {
    void openProject(owner);
    void openSession(id, owner.id);
  });
  const onDrawerNewSession = useStableCallback((owner: HostProject) => {
    void openProject(owner);
    void openSession();
  });
  const onNewChat = useStableCallback(() => {
    setError("");
    void (async () => {
      try {
        const chat = await client.createChat();
        setProjects(await client.projects());
        void openProject(chat);
        void openSession(undefined, undefined, "project");
      } catch (problem) {
        setError(message(problem));
      }
    })();
  });
  const chatSupported = client.hasCapability("projects.createChat");
  const onDrawerHome = useStableCallback(() => openHome());
  const onDrawerAllProjects = useStableCallback(() => openHome(undefined, true));
  const onDrawerProject = useStableCallback((owner: HostProject) => openHome(owner));
  const onDrawerSessionActions = useStableCallback(
    (id: string, trigger: HTMLButtonElement, point?: MobileSheetPoint) => {
      sessionActionsTrigger.current = trigger;
      setSessionActionsTarget(id);
      setSessionActionsPoint(point);
      setSessionActionsOpen(true);
    },
  );
  const onDrawerSummaryActions = useStableCallback(
    (summary: HostSessionSummary, trigger: HTMLButtonElement, point?: MobileSheetPoint) => {
      setHomeActionSession(summary);
      onDrawerSessionActions(summary.id, trigger, point);
    },
  );
  const onDrawerSettings = useStableCallback(() => navigate("settings"));
  const onDrawerAssistant = useStableCallback(() => {
    if (view !== "bots" && sessionEntrySource !== "bot") {
      botsReturnView.current = view;
      botsReturnSession.current = view === "chat" && project ? { project, sessionId, source: sessionEntrySource } : undefined;
    }
    setBotResume(undefined);
    navigate("bots");
  });
  const onOpenOriginBot = useStableCallback(async (origin: NonNullable<Block["origin"]>) => {
    const connection = client.connection;
    const target = await resolveBotOrigin(origin, assistantRpc);
    if (client.connection !== connection) throw new Error("Host connection changed.");
    onDrawerAssistant();
    setBotResume({ id: target.bot.id, name: target.bot.name, avatar: target.bot.avatar,
      threadId: target.threadId, defaultScope: target.defaultScope });
  });
  const onDrawerNotes = useStableCallback(() => {
    setDrawerOpen(false);
    setComposerPanel(null);
    setSessionStatusOpen(false);
    setSessionActionsOpen(false);
    setNotesOpen(true);
  });
  const onNoteAddToChat = useStableCallback(async (note: Note) => {
    const hostId = client.connection?.endpoint;
    const current = () => hostId && client.connection?.endpoint === hostId;
    if (view !== "chat" || !project) {
      const owner = (note.sourceCwd && noteSourceProject(note.sourceCwd)
        ? projects.find((item) => item.cwd === note.sourceCwd) ?? await client.openProject(note.sourceCwd)
        : project ?? projects[0]);
      if (!current()) throw new Error(t("Host connection changed."));
      if (!owner) throw new Error(t("Choose a project before adding a note to chat."));
      await openProject(owner);
      if (!current()) throw new Error(t("Host connection changed."));
      await openSession();
      setProjects(await client.projects());
    }
    if (!current()) throw new Error(t("Host connection changed."));
    setDraft(appendNoteReference(draft.get(), note.title, note.body));
    setNotesOpen(false);
  });
  const openAddProject = (trigger: HTMLButtonElement) => {
    projectTrigger.current = trigger;
    setError("");
    setAddingProject(true);
  };
  const toggleHomeSearch = () => {
    setHomeMenuOpen(false);
    setSearchOpen((open) => !open);
  };
  const interceptSearchOutside = (event: MouseEvent, close: boolean) => {
    if (
      view !== "home" || !searchOpen ||
      (event.target instanceof Element && event.target.closest(".mobile-header-search"))
    ) return;
    event.preventDefault();
    event.stopPropagation();
    // Keep search open through pointerdown so its matching click is consumed
    // before any underlying row or toolbar action can run.
    if (close) setSearchOpen(false);
  };
  const onComposerSend = useStableCallback(() => void send());
  const onComposerStop = useStableCallback(() => {
    if (sessionId && snapshot?.runId)
      void dispatch({ type: "cancel", commandId: crypto.randomUUID(), sessionId, runId: snapshot.runId });
  });
  const onComposerConfiguration = useStableCallback((next: MobileConfiguration) => {
    if (!sessionId) {
      if (next.model) draftConfigurationChanged.current = true;
      setConfiguration(next);
    } else {
      void dispatch({ type: "configure", commandId: crypto.randomUUID(), sessionId,
        ...(snapshot && (snapshot.session.pendingConfiguration || next.harness !== snapshot.session.harness)
          ? { harness: next.harness } : {}),
        model: next.model, modelSettings: next.modelSettings, runtimeMode: next.runtimeMode });
    }
  });
  const onComposerExpand = useStableCallback(() => {
    if (questionOpen) onQuestionOpenChange(false);
    else if (planDecisionId) setCollapsedPlan(planDecisionId);
  });
  const onComposerProject = useStableCallback((item: HostProject) => void openProject(item, "chat"));
  const onComposerFiles = useStableCallback((files: File[]) => void addFiles(files));
  const onComposerRemoveAttachment = useCallback((id: string) =>
    setAttachments((current) => current.filter((item) => item.id !== id)), []);
  const queueDisabled = nativeReadOnly || busy || !!pending || loading || !sessionConfirmed;
  const composerQueue = useMemo(() => <MobileMessageQueue
    key={snapshot?.session.id}
    {...queue}
    onOverlayChange={onQueueOverlayChange}
    onRestore={restoreQueuedMessage}
    disabled={queueDisabled}
  />, [snapshot?.session.id, queue.messages, queue.status, queue.canSteer, queue.canResume,
    queue.canReorder, queue.onReorder, queue.onDelete, queue.onEdit, queue.onEditingChange,
    queue.onSteer, queue.onResume, onQueueOverlayChange, restoreQueuedMessage, queueDisabled]);
  const canCreateWorktree = client.hasCapability("git.worktreeCreate");
  const composerWorkspace = useMemo(() => canCreateWorktree && project ? {
    value: workspace, onChange: setWorkspace,
    loadBranches: () => client.branches(project.id),
    loadWorktrees: () => client.worktrees(project.id),
    creating: worktreeCreation?.status === "creating",
  } : undefined, [canCreateWorktree, project?.id, workspace, worktreeCreation?.status]);
  const projectsUnavailable = projectListState === "failed" || hostStatus.state === "failed" || hostStatus.state === "disconnected";
  const projectsPending = projectListState === "loading" && !projectsUnavailable;
  // An unreachable device keeps Home's device row with a centered retry state.
  const homeUnavailable = view === "home" && !homePageOpen && !allProjectsPage && !!client.connection &&
    !(hostScopeReady && projects.length) && (projectsUnavailable || projectsPending);  return {
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
    assistantOpen,
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
    onOpenOriginBot,
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
    setSessionActionsOpen,
    setSessionActionsPoint,
    setSessionActionsTarget,
    setSessionStatusOpen,
    setSoundsEnabled,
    setSkin,
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
    snapshotStore,
    soundsEnabled,
    switchHost,
    t,
    skin,
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
  };
}

export type MobileAppViewModel = ReturnType<typeof useMobileAppController>;

