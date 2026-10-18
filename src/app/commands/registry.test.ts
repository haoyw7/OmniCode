import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import zhCN from "../../shared/i18n/zh-CN.json";
import {
  KEYBINDINGS,
  saveKeybindingOverride,
} from "../../features/settings/model/settings";
import {
  APP_COMMANDS,
  commandShortcutLabel,
  createCommandDebounce,
  HELP_URLS,
  MENUS,
  menuItems,
  paletteCommands,
  type CommandHandlers,
} from "./registry";

const noop = () => {};
const translate = (text: string) => text;

function allHandlers(): CommandHandlers {
  return Object.fromEntries(APP_COMMANDS.map((spec) => [spec.id, noop]));
}

beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

describe("command registry", () => {
  it("covers every keybinding row with exactly one command", () => {
    const ids = APP_COMMANDS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of KEYBINDINGS) expect(ids).toContain(row.command);
    expect(ids).not.toContain("App: Toggle Session Sidebar");
  });

  it("only uses native events the macOS menu emits", () => {
    const menu = readFileSync("src-tauri/src/menu.rs", "utf8");
    const dispatch = menu.slice(menu.indexOf("pub fn dispatch"));
    for (const spec of APP_COMMANDS) {
      if (spec.nativeEvent) expect(dispatch).toContain(`"${spec.nativeEvent}"`);
    }
  });

  it("opens the same help links as the native menu", () => {
    const menu = readFileSync("src-tauri/src/menu.rs", "utf8");
    for (const url of Object.values(HELP_URLS)) expect(menu).toContain(url);
  });

  it("translates every command id, title and menu label", () => {
    const dictionary = zhCN as Record<string, string>;
    const missing = [
      ...APP_COMMANDS.flatMap((spec) => [spec.id, spec.title]),
      ...MENUS.map((menu) => menu.label),
    ].filter((text) => !dictionary[text]);
    expect(missing).toEqual([]);
  });
});

describe("menuItems", () => {
  it("separates groups and labels commands with their default shortcut", () => {
    const items = menuItems("file", { handlers: allHandlers(), translate });
    expect(items[0]).toMatchObject({
      kind: "item",
      id: "Tab: New",
      label: "New Tab",
      shortcut: "Ctrl+T",
    });
    expect(items.filter((item) => item.kind === "sep")).toHaveLength(3);
    expect(items.at(-1)).toMatchObject({ id: "Tab: Close All" });
  });

  it("follows a rebound or disabled shortcut", () => {
    saveKeybindingOverride("Tab: New", { shortcut: "Control+Shift+KeyY" });
    saveKeybindingOverride("Pane: Close", { disabled: true });
    const items = menuItems("file", { handlers: allHandlers(), translate });
    expect(
      items.find((item) => "id" in item && item.id === "Tab: New"),
    ).toMatchObject({ shortcut: "Ctrl+Shift+Y" });
    expect(
      items.find((item) => "id" in item && item.id === "Pane: Close"),
    ).toMatchObject({ shortcut: undefined });
    expect(commandShortcutLabel("Pane: Close")).toBeNull();
  });

  it("closes the focused pane, not the whole tab, from Close Pane", () => {
    const items = menuItems("file", { handlers: allHandlers(), translate });
    const close = items.find(
      (item) => item.kind === "item" && item.label === "Close Pane",
    );
    expect(close).toMatchObject({ id: "Pane: Close", shortcut: "Ctrl+W" });
  });

  it("skips commands the window cannot run and drops empty groups", () => {
    const handlers: CommandHandlers = {
      "Tab: New": noop,
      "Pane: Close": noop,
    };
    const items = menuItems("file", { handlers, translate });
    expect(items.map((item) => (item.kind === "sep" ? "-" : item.id))).toEqual([
      "Tab: New",
      "-",
      "Pane: Close",
    ]);
  });

  it("reports checkable state", () => {
    const items = menuItems("file", {
      handlers: allHandlers(),
      checked: (id) => id === "File: Autosave",
      translate,
    });
    expect(
      items.find(
        (item) => item.kind === "item" && item.id === "File: Autosave",
      ),
    ).toMatchObject({ checked: true });
  });

  it("lists terminal commands under Terminal", () => {
    const items = menuItems("terminal", { handlers: allHandlers(), translate });
    expect(items.map((item) => (item.kind === "sep" ? "-" : item.id))).toEqual([
      "Terminal: New",
      "Terminal: Toggle Dock",
      "Terminal: New Tab",
    ]);
  });
});

describe("paletteCommands", () => {
  it("offers runnable commands and hides key-only ones", () => {
    const ids = paletteCommands(allHandlers()).map((spec) => spec.id);
    expect(ids).toContain("Pane: Split Right");
    expect(ids).toContain("Help: Keyboard Shortcuts");
    expect(ids).not.toContain("Tab: Activate 1–8");
    expect(ids).not.toContain("Session: Archive");
    expect(ids).not.toContain("App: Command Palette");
    expect(
      paletteCommands({ "View: Reload": noop }).map((spec) => spec.id),
    ).toEqual(["View: Reload"]);
  });
});

describe("createCommandDebounce", () => {
  it("drops a repeat of the same command within the window only", () => {
    const allow = createCommandDebounce(80);
    expect(allow("Tab: New", 0)).toBe(true);
    expect(allow("Tab: New", 50)).toBe(false);
    expect(allow("Tab: Next", 60)).toBe(true);
    expect(allow("Tab: Next", 200)).toBe(true);
  });
});
