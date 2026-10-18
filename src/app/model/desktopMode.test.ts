// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newEditorWorkspaceTab, newFileTab, newTab, type WorkspaceTab } from "../../features/workspace/model/layout";
import { activatePreferenceStore, SharedPreferenceStore, type PreferenceRequest } from "../../features/settings/model/sharedPreferences";
import { DEVICE_LOCAL_PREFERENCE_KINDS, SHARED_PREFERENCE_KINDS } from "../../features/settings/model/sharedPreferenceSchema";
import {
  DESKTOP_LOCATIONS_KEY, DESKTOP_MODE_KEY, desktopModeForCwd, desktopModeTarget,
  loadDesktopLocations, loadDesktopMode, saveDesktopMode, type DesktopLocations,
} from "./desktopMode";

const chatCwd = "/home/me/Documents/ohmymonocode/2026-10-13/chat-120000-abcdef";
beforeEach(() => { activatePreferenceStore(undefined); localStorage.clear(); });
afterEach(() => { activatePreferenceStore(undefined); localStorage.clear(); vi.restoreAllMocks(); });

describe("desktop mode grouping", () => {
  it.each(["", "~", "/", "/home/me", "/Users/me", "C:\\Users\\me", "C:\\", chatCwd,
    "C:\\Users\\me\\Documents\\ohmymonocode\\2026-10-13\\chat-120000-abcdef",
    `remote://machine${chatCwd}`])("keeps projectless location %s in Chat", cwd => {
    expect(desktopModeForCwd(cwd)).toBe("chat");
  });
  it.each(["/repo", "/home/me/repo", "C:\\Users\\me\\Repo", "remote://machine/home/me/repo"])("keeps project %s in Code", cwd => {
    expect(desktopModeForCwd(cwd)).toBe("code");
  });
});

describe("desktop mode restoration", () => {
  const sessions = [{ id: "chat", cwd: chatCwd }, { id: "code", cwd: "/repo" }, { id: "second", cwd: "/other" }];
  const chat = { ...newTab("chat"), id: "chat-tab" };
  const code = { ...newTab("code"), id: "code-tab" };
  const second = { ...newTab("second"), id: "second-tab" };
  it("restores the saved conversation from its retained split pane rather than the first project", () => {
    const split: WorkspaceTab = { ...code, layout: { type: "split", id: "split", dir: "right", children: [code.layout, second.layout], sizes: [50, 50] } };
    expect(desktopModeTarget("code", { code: { tabId: code.id, sessionId: "second", cwd: "/other" } }, [chat, split], sessions))
      .toMatchObject({ tabId: code.id, paneId: "second", sessionId: "second", cwd: "/other" });
  });
  it("finds a remembered conversation after it moves to another tab", () => {
    expect(desktopModeTarget("code", { code: { tabId: "closed", sessionId: "second", cwd: "/other" } }, [code, second], sessions))
      .toMatchObject({ tabId: second.id, paneId: "second", sessionId: "second", cwd: "/other" });
  });
  it("ignores stale remembered sessions and uses the first existing target in the requested mode", () => {
    expect(desktopModeTarget("code", { code: { tabId: chat.id, sessionId: "removed", cwd: "/removed" } }, [chat, second, code], sessions))
      .toMatchObject({ tabId: second.id, paneId: "second", sessionId: "second", cwd: "/other" });
    expect(desktopModeTarget("code", {}, [chat], sessions)).toBeUndefined();
  });
  it("keeps the saved standalone editor tab and its retained pane identity", () => {
    const editor = newEditorWorkspaceTab(newFileTab("/repo/file.ts", "/repo"));
    const before = structuredClone(editor);
    expect(desktopModeTarget("code", { code: { tabId: editor.id, paneId: editor.focusedId, cwd: "/repo" } }, [chat, editor], sessions))
      .toMatchObject({ tabId: editor.id, paneId: editor.focusedId, cwd: "/repo" });
    expect(editor).toEqual(before);
  });
});

describe("desktop mode preferences", () => {
  const locations: DesktopLocations = { chat: { tabId: "chat-tab", sessionId: "chat", cwd: chatCwd }, code: { tabId: "code-tab", sessionId: "code", cwd: "/repo" } };
  it("roundtrips local mode targets and rejects malformed or cross-mode locations", () => {
    saveDesktopMode("chat", locations);
    expect(loadDesktopMode()).toBe("chat");
    expect(loadDesktopLocations()).toEqual(locations);
    localStorage.setItem(DESKTOP_LOCATIONS_KEY, JSON.stringify({ chat: { ...locations.code }, code: { tabId: 4, cwd: "/repo" } }));
    expect(loadDesktopLocations()).toEqual({});
    localStorage.setItem(DESKTOP_LOCATIONS_KEY, "broken");
    localStorage.setItem(DESKTOP_MODE_KEY, "broken");
    expect(loadDesktopLocations()).toEqual({});
    expect(loadDesktopMode()).toBe("code");
  });
  it("leaves view navigation usable when preference storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(loadDesktopMode()).toBe("code");
    expect(loadDesktopLocations()).toEqual({});
    expect(() => saveDesktopMode("chat", locations)).not.toThrow();
  });
  it("keeps mode targets local while a Host preference store is active", async () => {
    const request = vi.fn<PreferenceRequest>(async () => ({ revision: 1, imported: true, values: { [DESKTOP_MODE_KEY]: "code" } }) as never);
    const store = new SharedPreferenceStore("desktop-mode-test", localStorage, request);
    await store.sync();
    activatePreferenceStore(store);
    saveDesktopMode("chat", locations);
    await store.sync();
    expect(loadDesktopMode()).toBe("chat");
    expect(loadDesktopLocations()).toEqual(locations);
    expect(store.pendingCount).toBe(0);
    expect(request.mock.calls.every(([method]) => method === "preferences.read")).toBe(true);
    expect(SHARED_PREFERENCE_KINDS[DESKTOP_MODE_KEY]).toBeUndefined();
    expect(SHARED_PREFERENCE_KINDS[DESKTOP_LOCATIONS_KEY]).toBeUndefined();
    expect(DEVICE_LOCAL_PREFERENCE_KINDS[DESKTOP_MODE_KEY]).toBe("string");
    expect(DEVICE_LOCAL_PREFERENCE_KINDS[DESKTOP_LOCATIONS_KEY]).toBe("object");
  });
});
