import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import {
  OPEN_CONNECTIONS_EVENT,
  OPEN_NEW_ENVIRONMENT_EVENT,
  OPEN_REMOTE_PROJECT_EVENT,
} from "../../features/connections/model/connections";
import type { ConnectableInboxSource } from "../../features/inbox/model/inboxFilters";
import { type Session } from "../../features/sessions/model/session";
import {
  loadFileTabMode,
  loadNotesEnabled,
  loadSettingsSection,
  saveSettingsSection,
  type SettingsSectionId,
} from "../../features/settings/model/settings";
import type { SettingsAnchor } from "../../features/settings/ui/SettingsView";
import {
  findSurfacePane,
  focusedFileTab,
  isAppPageKind,
  leafIds,
  openAppViewTab,
  openSessionAppView,
  type AppPageKind,
  type AppViewKind,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { useMouseHistoryNavigation } from "../hooks/useMouseHistoryNavigation";
import {
  usePageNavigation,
  type PageDestination,
} from "../hooks/usePageNavigation";

/** These views open over the current workspace rather than in a pane. */
const DIALOG_APP_VIEWS: ReadonlySet<AppViewKind> = new Set([
  "settings",
  "search",
]);

type Options = {
  tabs: WorkspaceTab[];
  activeTabId: string;
  notesEnabled: boolean;
  initialPage: AppPageKind | null;
  context: () => {
    tabs: WorkspaceTab[];
    sessions: Session[];
    activeTabId: string;
    projectCwd: string;
  };
  cancelNavigation: () => void;
  ensureContentTab: (cwd: string) => WorkspaceTab;
  activateTab: (id: string, paneId?: string) => void;
  onSelectFileSurface: (paneId: string, fileId: string) => void;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
};

/** Page/dialog presentation, settings destinations and their shared visit history. */
export function useWorkspaceAppViews(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const context = useCallback(() => latest.current.context(), []);
  const ensureContentTab = useCallback(
    (cwd: string) => latest.current.ensureContentTab(cwd),
    [],
  );
  const activateTab = useCallback(
    (id: string, paneId?: string) => latest.current.activateTab(id, paneId),
    [],
  );
  const {
    setTabs,
    setPaletteOpen,
    setProjectTerminalFocused,
    setComposerFocused,
  } = options;
  const [searchViewFocusToken, setSearchViewFocusToken] = useState(0);
  const [appPage, setAppPage] = useState<AppPageKind | null>(
    () => options.initialPage,
  );
  const closeAppPage = useCallback(() => {
    setAppPage(null);
    setComposerFocused(true);
  }, []);
  const showWorkspace = useCallback(() => setAppPage(null), []);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>(loadSettingsSection);
  const [settingsAnchor, setSettingsAnchor] = useState<SettingsAnchor | null>(
    null,
  );
  const [notificationProjectPath, setNotificationProjectPath] = useState<
    string | null
  >(null);
  const [notificationSettingsRequest, setNotificationSettingsRequest] =
    useState(0);
  const focusedAppView = options.tabs.find(
    (tab) => tab.id === options.activeTabId,
  );
  const activeAppView =
    appPage ??
    (focusedAppView
      ? focusedFileTab(focusedAppView)?.appView?.kind
      : undefined);
  const appViewFocusedRef = useRef(activeAppView);
  appViewFocusedRef.current = activeAppView;
  // Settings-like views open as a dialog over the workspace.
  const [appDialog, setAppDialog] = useState<AppViewKind | null>(null);
  const appDialogRef = useRef(appDialog);
  appDialogRef.current = appDialog;
  const closeAppDialog = useCallback(() => setAppDialog(null), []);
  const appPageHostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      appPage &&
      !appDialog &&
      !appPageHostRef.current?.contains(document.activeElement)
    ) {
      appPageHostRef.current?.focus({ preventScroll: true });
    }
  }, [appPage, appDialog]);

  const workspaceVisible = appPage === null;
  const inboxVisible = appPage === "inbox" && appDialog === null;
  const openAppView = useCallback(
    (kind: AppViewKind) => {
      latest.current.cancelNavigation();
      setPaletteOpen(false);
      if (isAppPageKind(kind)) {
        setAppDialog(null);
        setAppPage(kind);
        setProjectTerminalFocused(false);
        setComposerFocused(false);
        return;
      }
      if (DIALOG_APP_VIEWS.has(kind)) {
        setAppDialog(kind);
        return;
      }
      const owner = ensureContentTab(context().projectCwd);
      if (!owner) return;
      const initialMode =
        owner.surfaceMode ??
        (loadFileTabMode() === "workspace" ? "unified" : "split");
      let targetPaneId: string | undefined;
      flushSync(() =>
        setTabs((current) =>
          current.map((tab) => {
            if (tab.id !== owner.id) return tab;
            const next = openSessionAppView(
              { ...tab, surfaceMode: tab.surfaceMode ?? initialMode },
              kind,
            );
            targetPaneId = next.focusedId;
            return next;
          }),
        ),
      );
      activateTab(owner.id, targetPaneId);
      setProjectTerminalFocused(false);
      setComposerFocused(false);
    },
    [activateTab, ensureContentTab],
  );

  const leaveAppView = useCallback(() => {
    const tab = context().tabs.find(
      (entry) => entry.id === context().activeTabId,
    );
    if (!tab) return;
    for (const id of leafIds(tab.layout)) {
      if (context().sessions.some((session) => session.id === id)) {
        activateTab(tab.id, id);
        return;
      }
      const pane = findSurfacePane(tab, id)?.pane;
      const file = pane?.files.find((entry) => !entry.appView);
      if (pane && file) {
        activateTab(tab.id, pane.id);
        latest.current.onSelectFileSurface(pane.id, file.id);
        return;
      }
    }
    ensureContentTab(context().projectCwd);
  }, [activateTab, ensureContentTab]);

  const onOpenSearch = useCallback(() => {
    openAppView("search");
    setSearchViewFocusToken((token) => token + 1);
  }, [openAppView]);

  const [searchQueryRequest, setSearchQueryRequest] = useState<
    { query: string; token: number } | undefined
  >();
  const onSearchEverywhere = useCallback(
    (query: string) => {
      setSearchQueryRequest((previous) => ({
        query,
        token: (previous?.token ?? 0) + 1,
      }));
      onOpenSearch();
    },
    [onOpenSearch],
  );

  const onLeaveSearch = useCallback(() => {
    if (appDialogRef.current) closeAppDialog();
    else leaveAppView();
  }, [closeAppDialog, leaveAppView]);

  const onOpenInbox = useCallback(() => {
    openAppView("inbox");
  }, [openAppView]);

  const onOpenNotes = useCallback(() => {
    if (!loadNotesEnabled()) return;
    openAppView("notes");
  }, [openAppView]);

  const onLeaveNotes = closeAppPage;

  const onOpenAutomations = useCallback(() => {
    openAppView("automations");
  }, [openAppView]);

  const onOpenWorkflows = useCallback(() => {
    openAppView("workflows");
  }, [openAppView]);

  const onLeaveAutomations = closeAppPage;

  const openSettings = useCallback(
    (section?: SettingsSectionId, anchor?: SettingsAnchor) => {
      if (section) {
        setSettingsSection(section);
        saveSettingsSection(section);
      }
      setSettingsAnchor(anchor ?? null);
      setNotificationProjectPath(null);
      openAppView("settings");
    },
    [openAppView],
  );

  const onOpenSettings = useCallback(() => openSettings(), [openSettings]);
  useEffect(() => {
    const openConnections = () => openSettings("connections");
    window.addEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
    return () =>
      window.removeEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
  }, [openSettings]);
  const [remoteProjectDialogOpen, setRemoteProjectDialogOpen] = useState(false);
  useEffect(() => {
    const open = () => setRemoteProjectDialogOpen(true);
    window.addEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
    return () => window.removeEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
  }, []);
  const [newEnvironmentDialogOpen, setNewEnvironmentDialogOpen] = useState(false);
  useEffect(() => {
    const open = () => setNewEnvironmentDialogOpen(true);
    window.addEventListener(OPEN_NEW_ENVIRONMENT_EVENT, open);
    return () => window.removeEventListener(OPEN_NEW_ENVIRONMENT_EVENT, open);
  }, []);

  useEffect(() => {
    const onOpenMcp = () => openSettings("mcp");
    window.addEventListener("monocode:open-mcp-settings", onOpenMcp);
    return () =>
      window.removeEventListener("monocode:open-mcp-settings", onOpenMcp);
  }, [openSettings]);

  const onOpenNotificationSettings = useCallback(
    (path?: string) => {
      openSettings("inbox", "project-notifications");
      setNotificationProjectPath(path ?? null);
      setNotificationSettingsRequest((request) => request + 1);
    },
    [openSettings],
  );

  const onOpenInboxIntegrations = useCallback(
    (source: ConnectableInboxSource) => openSettings("inbox", source),
    [openSettings],
  );

  const onCloseSettings = useCallback(() => {
    if (appDialogRef.current) closeAppDialog();
    else leaveAppView();
  }, [closeAppDialog, leaveAppView]);

  const onSelectSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section);
    saveSettingsSection(section);
  }, []);

  const [assistantMachineId, setAssistantMachineId] = useState<string>();
  const onOpenAssistant = useCallback(
    (machineId?: string) => {
      if (machineId) setAssistantMachineId(machineId);
      latest.current.cancelNavigation();
      setPaletteOpen(false);
      const next = openAppViewTab(context().tabs, "assistant");
      flushSync(() => setTabs(next.tabs));
      activateTab(next.tabId, next.paneId);
      setProjectTerminalFocused(false);
      setComposerFocused(false);
    },
    [activateTab],
  );

  const navigate = useCallback(
    (destination: PageDestination) => {
      setPaletteOpen(false);
      activateTab(destination.tabId, destination.paneId);
      if (destination.fileId)
        latest.current.onSelectFileSurface(
          destination.paneId,
          destination.fileId,
        );
      setAppPage(destination.page);
      setAppDialog(destination.dialog);
      setProjectTerminalFocused(false);
      if (destination.page || destination.dialog) setComposerFocused(false);
    },
    [activateTab],
  );

  const tabVisitNav = usePageNavigation({
    tabs: options.tabs,
    activeTabId: options.activeTabId,
    page: appPage,
    dialog: appDialog,
    notesEnabled: options.notesEnabled,
    navigate,
  });
  const {
    back: onVisitBack,
    forward: onVisitForward,
    previousTabs,
  } = tabVisitNav;
  useMouseHistoryNavigation(onVisitBack, onVisitForward);
  return {
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
  };
}
