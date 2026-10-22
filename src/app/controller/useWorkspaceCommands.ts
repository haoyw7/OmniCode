import {
  openExternalUrl,
  openNewWorkspaceWindow,
  setNativeAutosaveEnabled,
} from "../../platform/tauri/workspaceWindow";
import type { useWorkspaceAppViews } from "./useWorkspaceAppViews";
import { useCallback } from "react";
import {
  UI_SCALE_DEFAULT,
  applyUiScale,
  loadUiScale,
  saveUiScale,
  zoomInUiScale,
  zoomOutUiScale,
} from "../../features/settings/model/uiScale";
import { IS_MAC } from "../../platform/tauri/platform";
import { HELP_URLS, type CommandHandlers } from "../commands/registry";
import { useCommandDispatcher } from "../commands/useCommandDispatcher";
import { readAppVersion, runUpdateFlow } from "../model/updater";
import {
  openFindInActiveEditor,
  openReplaceInActiveEditor,
} from "../../features/connections/files/editor/editorSearch";
import {
  loadAutosave,
  loadMenuBarVisible,
  saveAutosave,
  saveMenuBarVisible,
} from "../../features/settings/model/settings";

type WorkspaceAppViews = ReturnType<typeof useWorkspaceAppViews>;

type Options = {
  appPage: boolean;
  activeTabId: string;
  sourceControlAvailable: boolean;
  notesEnabled: boolean;
  onNew: () => void;
  onNewTerminal: () => void;
  pickProject: () => unknown;
  closeAppPage: () => void;
  onClosePane: () => void;
  onCloseTitleTab: (id: string) => void;
  onCloseOtherTabs: () => void;
  onCloseAllTabs: () => void;
  onFindInProject: () => void;
  onOpenCommandPalette: () => void;
  onGoToFile: () => void;
  onOpenSearch: () => void;
  onToggleSidebar: () => void;
  onToggleChanges: () => void;
  onToggleProjectTerminal: () => void;
  onSplit: (direction: "right" | "down") => void;
  onOpenInbox: () => void;
  onOpenNotes: () => void;
  openSettings: WorkspaceAppViews["openSettings"];
  onOpenAutomations: () => void;
  onOpenWorkflows: () => void;
  onReload: () => void;
  onVisitBack: () => void;
  onVisitForward: () => void;
  onNext: () => void;
  onPrev: () => void;
  onActivate: (slot: number) => void;
  onNavigateSessionList: (delta: number, inCurrentTab?: boolean) => void;
  onNavigateProjectList: (delta: number) => void;
  onFocusDir: (direction: "left" | "right" | "up" | "down") => void;
  onNewTerminalTab: () => void;
  onOpenWhatsNew: (version: string) => void;
};

/** Maps workspace feature actions to menu and keyboard commands. */
export function useWorkspaceCommands({
  appPage,
  activeTabId,
  sourceControlAvailable,
  notesEnabled,
  onNew,
  onNewTerminal,
  pickProject,
  closeAppPage,
  onClosePane,
  onCloseTitleTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onFindInProject,
  onOpenCommandPalette,
  onGoToFile,
  onOpenSearch,
  onToggleSidebar,
  onToggleChanges,
  onToggleProjectTerminal,
  onSplit,
  onOpenInbox,
  onOpenNotes,
  openSettings,
  onOpenAutomations,
  onOpenWorkflows,
  onReload,
  onVisitBack,
  onVisitForward,
  onNext,
  onPrev,
  onActivate,
  onNavigateSessionList,
  onNavigateProjectList,
  onFocusDir,
  onNewTerminalTab,
  onOpenWhatsNew,
}: Options) {
  const toggleAutosave = useCallback(() => {
    const next = saveAutosave(!loadAutosave());
    if (IS_MAC) void setNativeAutosaveEnabled(next);
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
    "App: New Window": () => void openNewWorkspaceWindow().catch(() => {}),
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
    "View: Toggle Changes": sourceControlAvailable
      ? onToggleChanges
      : undefined,
    "Terminal: Toggle Dock": onToggleProjectTerminal,
    "View: Toggle Menu Bar": IS_MAC
      ? undefined
      : () => void saveMenuBarVisible(!loadMenuBarVisible()),
    "Pane: Split Right": appPage ? undefined : () => onSplit("right"),
    "Pane: Split Down": appPage ? undefined : () => onSplit("down"),
    "View: Inbox": onOpenInbox,
    "View: Notes": notesEnabled ? onOpenNotes : undefined,
    "View: Usage": () => openSettings("usage"),
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
        () => void openExternalUrl(url).catch(console.error),
      ]),
    ),
  };
  const dispatch = useCommandDispatcher(commandHandlers);

  return { commandHandlers, dispatch };
}
