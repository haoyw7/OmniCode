// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as settings from "./settings";
import * as appearance from "./appearance";

const platform = vi.hoisted(() => ({ isWindows: true, isLinux: false }));
vi.mock("../../../platform/tauri/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/platform")>()),
  get IS_WIN() {
    return platform.isWindows;
  },
  get IS_LINUX() {
    return platform.isLinux;
  },
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  platform.isWindows = true;
  platform.isLinux = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  [
    "omnicode.tabAnimationsEnabled",
    settings.loadTabAnimationsEnabled,
    settings.saveTabAnimationsEnabled,
    true,
    undefined,
  ],
  [
    "omnicode.notesEnabled",
    settings.loadNotesEnabled,
    settings.saveNotesEnabled,
    true,
    "omnicode:notes-enabled-change",
  ],
  [
    "omnicode.liveAgentsEnabled",
    settings.loadLiveAgentsEnabled,
    settings.saveLiveAgentsEnabled,
    true,
    "omnicode:live-agents-enabled-change",
  ],
  [
    "omnicode.closeToTray",
    settings.loadCloseToTray,
    settings.saveCloseToTray,
    true,
    undefined,
  ],
  [
    "omnicode.claudeHooks",
    settings.loadClaudeHooks,
    settings.saveClaudeHooks,
    true,
    undefined,
  ],
  [
    "omnicode.bodyGlass",
    appearance.loadBodyGlass,
    appearance.saveBodyGlass,
    appearance.BODY_GLASS_DEFAULT,
    undefined,
  ],
  [
    "omnicode.projectRailOpen",
    appearance.loadProjectRailOpen,
    appearance.saveProjectRailOpen,
    true,
    undefined,
  ],
  [
    "omnicode.sessionSidebarOpen",
    appearance.loadSessionSidebarOpen,
    appearance.saveSessionSidebarOpen,
    true,
    undefined,
  ],
  [
    "omnicode.transcriptAnchor",
    appearance.loadTranscriptAnchor,
    appearance.saveTranscriptAnchor,
    true,
    "omnicode:transcriptanchorchange",
  ],
] as const)("%s", (key, load, save, fallback, eventName) => {
  it("uses its default when unset or unreadable", () => {
    expect(load()).toBe(fallback);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(load()).toBe(fallback);
  });

  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["false", false],
    ["", false],
    ["TRUE", false],
    [" true ", false],
    ["invalid", false],
  ] as const)("reads %j as %s", (stored, expected) => {
    localStorage.setItem(key, stored);
    expect(load()).toBe(expected);
  });

  it.each([false, true])("persists %s before notifying listeners", (value) => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const listener = vi.fn((event: Event) => {
      expect((event as CustomEvent<boolean>).detail).toBe(value);
      expect(load()).toBe(value);
    });
    if (eventName) window.addEventListener(eventName, listener);
    try {
      save(value);
      expect(localStorage.getItem(key)).toBe(value ? "1" : "0");
      expect(localStorage.length).toBe(1);
      expect(load()).toBe(value);
      expect(dispatch).toHaveBeenCalledTimes(eventName ? 1 : 0);
      expect(listener).toHaveBeenCalledTimes(eventName ? 1 : 0);
    } finally {
      if (eventName) window.removeEventListener(eventName, listener);
    }
  });

  it("still emits its change event when writing fails", () => {
    const value = !fallback;
    const dispatch = vi.spyOn(window, "dispatchEvent");
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage quota exceeded");
    });

    expect(() => save(value)).not.toThrow();
    expect(load()).toBe(fallback);
    expect(dispatch).toHaveBeenCalledTimes(eventName ? 1 : 0);
    if (eventName) {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: eventName, detail: value }),
      );
    }
  });

  it("tolerates unavailable storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(load()).toBe(fallback);
    expect(() => save(!fallback)).not.toThrow();
  });

  it("can persist without a window", () => {
    vi.stubGlobal("window", undefined);
    save(!fallback);
    expect(load()).toBe(!fallback);
  });
});

it("disables close-to-tray outside Windows and Linux without consulting storage", () => {
  platform.isWindows = false;
  settings.saveCloseToTray(true);
  const read = vi.spyOn(localStorage, "getItem");

  expect(settings.loadCloseToTray()).toBe(false);
  expect(read).not.toHaveBeenCalled();
});
