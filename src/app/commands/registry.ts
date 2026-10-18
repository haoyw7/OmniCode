import type { ExplorerMenuItem } from "../../features/connections/files/ui/ExplorerMenu";
import { quickComposerShortcutLabel } from "../../features/quick-composer/model/quickComposerShortcut";
import {
  KEYBINDINGS,
  keybindingShortcutLabel,
  loadQuickComposerEnabled,
  loadQuickComposerShortcut,
} from "../../features/settings/model/settings";
import { IS_MAC } from "../../platform/tauri/platform";

/**
 * Every app command the window can run, in menu order. The key handler, the
 * native menu events, the in-window menu bar and the command palette all run
 * commands through `dispatch(id)`, so a command has one implementation and one
 * effective shortcut wherever it is offered.
 *
 * `id` equals the `KEYBINDINGS` command when the command has a shortcut, so
 * user overrides apply; unbound commands use the same `Category: Title` form.
 * `title` is the English menu label; the palette shows the translated id.
 */

export type MenuId = "file" | "edit" | "view" | "go" | "terminal" | "help";

export type CommandSpec = {
  id: string;
  title: string;
  /** Event the native macOS menu emits for this command. */
  nativeEvent?: string;
  /** Menu placement; a separator falls between different groups. */
  menu?: { id: MenuId; group: number };
  /** Hidden from the command palette. */
  palette?: false;
  /**
   * Owned by a focused surface (composer, editor, model picker): its chord is
   * handled there, so the window key handler leaves it alone.
   */
  surface?: true;
  /** Shown as a checkable menu item. */
  checkable?: true;
};

export type CommandHandler = (arg?: unknown) => void;
export type CommandHandlers = Partial<Record<string, CommandHandler>>;

export const MENUS: { id: MenuId; label: string }[] = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "go", label: "Go" },
  { id: "terminal", label: "Terminal" },
  { id: "help", label: "Help" },
];

export const HELP_URLS: Record<string, string> = {
  "Help: Website": "https://github.com/haoyw7/OmniCode",
  "Help: GitHub": "https://github.com/haoyw7/OmniCode",
  "Help: Report a Bug":
    "https://github.com/haoyw7/OmniCode/issues/new?template=bug_report.yml",
  "Help: Request a Feature":
    "https://github.com/haoyw7/OmniCode/issues/new?template=feature_request.yml",
};

export const APP_COMMANDS: CommandSpec[] = [
  // File
  {
    id: "Tab: New",
    title: "New Tab",
    nativeEvent: "new_tab",
    menu: { id: "file", group: 0 },
  },
  {
    id: "Terminal: New",
    title: "New Terminal",
    nativeEvent: "new_terminal",
    menu: { id: "file", group: 0 },
  },
  {
    id: "App: New Window",
    title: "New Window",
    menu: { id: "file", group: 0 },
  },
  {
    id: "App: Open Project",
    title: "Open Project…",
    nativeEvent: "open_project",
    menu: { id: "file", group: 1 },
  },
  {
    id: "File: Autosave",
    title: "Autosave",
    menu: { id: "file", group: 2 },
    checkable: true,
  },
  {
    id: "Pane: Close",
    title: "Close Pane",
    nativeEvent: "close_tab",
    menu: { id: "file", group: 3 },
  },
  { id: "Tab: Close", title: "Close Tab", menu: { id: "file", group: 3 } },
  {
    id: "Tab: Close Others",
    title: "Close Other Tabs",
    nativeEvent: "close_other_tabs",
    menu: { id: "file", group: 3 },
  },
  {
    id: "Tab: Close All",
    title: "Close All Tabs",
    nativeEvent: "close_all_tabs",
    menu: { id: "file", group: 3 },
  },
  // Edit
  {
    id: "Editor: Find",
    title: "Find",
    nativeEvent: "find",
    menu: { id: "edit", group: 0 },
    surface: true,
  },
  {
    id: "Editor: Replace",
    title: "Replace",
    menu: { id: "edit", group: 0 },
    surface: true,
  },
  {
    id: "App: Find in Files",
    title: "Find in Files…",
    nativeEvent: "find_in_project",
    menu: { id: "edit", group: 1 },
  },
  // View
  {
    id: "App: Command Palette",
    title: "Command Palette…",
    nativeEvent: "open_command_palette",
    menu: { id: "view", group: 0 },
    palette: false,
  },
  {
    id: "App: Search",
    title: "Quick Open…",
    nativeEvent: "open_search",
    menu: { id: "view", group: 0 },
  },
  {
    id: "View: Search Everywhere",
    title: "Search Everywhere…",
    menu: { id: "view", group: 0 },
  },
  {
    id: "App: Toggle Sidebar",
    title: "Toggle Sidebar",
    nativeEvent: "toggle_sidebar",
    menu: { id: "view", group: 1 },
  },
  {
    id: "View: Toggle Changes",
    title: "Toggle Changes",
    menu: { id: "view", group: 1 },
  },
  {
    id: "Terminal: Toggle Dock",
    title: "Toggle Terminal",
    nativeEvent: "toggle_terminal",
    menu: { id: "view", group: 1 },
  },
  {
    id: "View: Toggle Menu Bar",
    title: "Menu Bar",
    menu: { id: "view", group: 1 },
    checkable: true,
  },
  {
    id: "Pane: Split Right",
    title: "Split Right",
    nativeEvent: "split_right",
    menu: { id: "view", group: 2 },
  },
  {
    id: "Pane: Split Down",
    title: "Split Down",
    nativeEvent: "split_down",
    menu: { id: "view", group: 2 },
  },
  {
    id: "View: Inbox",
    title: "Inbox",
    nativeEvent: "open_inbox",
    menu: { id: "view", group: 3 },
  },
  {
    id: "View: Notes",
    title: "Notes",
    nativeEvent: "open_notes",
    menu: { id: "view", group: 3 },
  },
  {
    id: "View: Automations",
    title: "Automations",
    menu: { id: "view", group: 3 },
  },
  {
    id: "View: Workflows",
    title: "Workflows",
    menu: { id: "view", group: 3 },
  },
  {
    id: "App: Settings",
    title: "Settings…",
    nativeEvent: "open_settings",
    menu: { id: "view", group: 3 },
  },
  {
    id: "App: Switch Model",
    title: "Switch Model…",
    nativeEvent: "open_model_picker",
    menu: { id: "view", group: 4 },
    surface: true,
  },
  {
    id: "View: Zoom In",
    title: "Zoom In",
    nativeEvent: "zoom_in",
    menu: { id: "view", group: 5 },
  },
  {
    id: "View: Zoom Out",
    title: "Zoom Out",
    nativeEvent: "zoom_out",
    menu: { id: "view", group: 5 },
  },
  {
    id: "View: Reset Zoom",
    title: "Reset Zoom",
    nativeEvent: "zoom_reset",
    menu: { id: "view", group: 5 },
  },
  {
    id: "View: Reload",
    title: "Reload",
    nativeEvent: "reload",
    menu: { id: "view", group: 6 },
  },
  // Go
  {
    id: "Tab: Back",
    title: "Back",
    nativeEvent: "back_tab",
    menu: { id: "go", group: 0 },
  },
  {
    id: "Tab: Forward",
    title: "Forward",
    nativeEvent: "forward_tab",
    menu: { id: "go", group: 0 },
  },
  {
    id: "App: Go to File",
    title: "Go to File…",
    nativeEvent: "go_to_file",
    menu: { id: "go", group: 1 },
  },
  {
    id: "Tab: Next",
    title: "Next Tab",
    nativeEvent: "next_tab",
    menu: { id: "go", group: 2 },
  },
  {
    id: "Tab: Previous",
    title: "Previous Tab",
    nativeEvent: "prev_tab",
    menu: { id: "go", group: 2 },
  },
  { id: "Tab: Cycle Next", title: "Cycle Next Tab", palette: false },
  { id: "Tab: Cycle Previous", title: "Cycle Previous Tab", palette: false },
  { id: "Tab: Activate 1–8", title: "Activate Tab", palette: false },
  { id: "Tab: Activate Last", title: "Activate Last Tab", palette: false },
  {
    id: "Session: Previous",
    title: "Previous Session",
    menu: { id: "go", group: 3 },
  },
  { id: "Session: Next", title: "Next Session", menu: { id: "go", group: 3 } },
  {
    id: "Session: Previous in Current Tab",
    title: "Previous Session in Tab",
    menu: { id: "go", group: 3 },
  },
  {
    id: "Session: Next in Current Tab",
    title: "Next Session in Tab",
    menu: { id: "go", group: 3 },
  },
  {
    id: "Project: Previous",
    title: "Previous Project",
    menu: { id: "go", group: 4 },
  },
  { id: "Project: Next", title: "Next Project", menu: { id: "go", group: 4 } },
  {
    id: "Pane: Focus Left",
    title: "Focus Left Pane",
    nativeEvent: "focus_left",
    menu: { id: "go", group: 5 },
  },
  {
    id: "Pane: Focus Right",
    title: "Focus Right Pane",
    nativeEvent: "focus_right",
    menu: { id: "go", group: 5 },
  },
  {
    id: "Pane: Focus Up",
    title: "Focus Pane Above",
    nativeEvent: "focus_up",
    menu: { id: "go", group: 5 },
  },
  {
    id: "Pane: Focus Down",
    title: "Focus Pane Below",
    nativeEvent: "focus_down",
    menu: { id: "go", group: 5 },
  },
  // Terminal
  {
    id: "Terminal: New Tab",
    title: "New Terminal Tab",
    nativeEvent: "new_terminal_tab",
    menu: { id: "terminal", group: 0 },
  },
  // Session archive checks the key event's target, so it stays key-only.
  { id: "Session: Archive", title: "Archive Session", palette: false },
  {
    id: "Composer: Toggle Workspace",
    title: "Toggle Workspace",
    palette: false,
    surface: true,
  },
  {
    id: "App: Quick Composer",
    title: "Quick Composer",
    palette: false,
    surface: true,
  },
  // Help
  {
    id: "Help: Keyboard Shortcuts",
    title: "Keyboard Shortcuts",
    menu: { id: "help", group: 0 },
  },
  {
    id: "Help: What's New",
    title: "What's New",
    menu: { id: "help", group: 0 },
  },
  {
    id: "Help: Check for Updates",
    title: "Check for Updates…",
    nativeEvent: "check_for_updates",
    menu: { id: "help", group: 0 },
  },
  {
    id: "Help: Website",
    title: "OmniCode Website",
    menu: { id: "help", group: 1 },
  },
  {
    id: "Help: GitHub",
    title: "View on GitHub",
    menu: { id: "help", group: 1 },
  },
  {
    id: "Help: Report a Bug",
    title: "Report a Bug…",
    menu: { id: "help", group: 1 },
  },
  {
    id: "Help: Request a Feature",
    title: "Request a Feature…",
    menu: { id: "help", group: 1 },
  },
];

/** The terminal menu repeats these from other menus, in this order. */
const TERMINAL_MENU_EXTRAS = ["Terminal: New", "Terminal: Toggle Dock"];

const SPEC_BY_ID = new Map(APP_COMMANDS.map((spec) => [spec.id, spec]));

/** The user's effective shortcut for a command, or null when unbound or disabled. */
export function commandShortcutLabel(id: string): string | null {
  if (id === "App: Quick Composer") {
    return IS_MAC && loadQuickComposerEnabled()
      ? quickComposerShortcutLabel(loadQuickComposerShortcut())
      : null;
  }
  const row = KEYBINDINGS.find((entry) => entry.command === id);
  return row ? keybindingShortcutLabel(id, row.keys) : null;
}

/** Commands offered in the palette: runnable here and not palette-hidden. */
export function paletteCommands(handlers: CommandHandlers): CommandSpec[] {
  return APP_COMMANDS.filter(
    (spec) => spec.palette !== false && Boolean(handlers[spec.id]),
  );
}

export type MenuState = {
  handlers: CommandHandlers;
  checked?: (id: string) => boolean;
  translate: (text: string) => string;
};

/** Menu rows for one menu, skipping commands this window cannot run. */
export function menuItems(menu: MenuId, state: MenuState): ExplorerMenuItem[] {
  const specs =
    menu === "terminal"
      ? [
          ...TERMINAL_MENU_EXTRAS.flatMap((id) => {
            const spec = SPEC_BY_ID.get(id);
            return spec ? [spec] : [];
          }),
          ...APP_COMMANDS.filter((spec) => spec.menu?.id === "terminal"),
        ]
      : APP_COMMANDS.filter((spec) => spec.menu?.id === menu);
  const items: ExplorerMenuItem[] = [];
  let group: number | undefined;
  for (const spec of specs) {
    if (!state.handlers[spec.id]) continue;
    const specGroup = spec.menu?.id === menu ? spec.menu.group : 0;
    if (group !== undefined && specGroup !== group) items.push({ kind: "sep" });
    group = specGroup;
    items.push({
      kind: "item",
      id: spec.id,
      label: state.translate(spec.title),
      shortcut: commandShortcutLabel(spec.id) ?? undefined,
      ...(spec.checkable ? { checked: state.checked?.(spec.id) ?? false } : {}),
    });
  }
  return items;
}

/**
 * The 80 ms window that stops one press from running twice when both the
 * native menu accelerator and the webview key handler see it.
 */
export function createCommandDebounce(windowMs = 80) {
  let last = { key: "", at: 0 };
  return (key: string, now: number): boolean => {
    if (key === last.key && now - last.at < windowMs) return false;
    last = { key, at: now };
    return true;
  };
}
