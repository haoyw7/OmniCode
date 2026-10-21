// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { activatePreferenceStore, SharedPreferenceStore, SHARED_PREFERENCES_CHANGED } from "../../settings/model/sharedPreferences";
import { loadProjectChatBackgroundSettings, saveProjectChatBackgroundSettings, subscribeProjectChatBackground, projectChatBackgroundImageRevision } from "./projectChatBackground";

afterEach(() => { activatePreferenceStore(undefined); localStorage.clear(); });

it("publishes one image revision to every subscriber for a shared preference change", () => {
  const first = vi.fn(), second = vi.fn();
  const stops = [subscribeProjectChatBackground(first), subscribeProjectChatBackground(second)];
  const before = projectChatBackgroundImageRevision();
  window.dispatchEvent(new CustomEvent(SHARED_PREFERENCES_CHANGED, { detail: ["omnicode.projectBackgroundAssets"] }));
  expect(projectChatBackgroundImageRevision()).toBe(before + 1);
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  stops.forEach(stop => stop());
});

it("keeps project background references portable and retains the legacy file as recovery data", async () => {
  const legacy = JSON.stringify({ "/repo": { path: "/old/background.png", opacity: 0.2 } });
  localStorage.setItem("omnicode:project-chat-backgrounds", legacy);
  const store = new SharedPreferenceStore("host", localStorage, async () => { throw new Error("offline"); });
  activatePreferenceStore(store);
  const settings = { path: "host-asset:host:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", opacity: 0.2, effect: "none" as const };
  saveProjectChatBackgroundSettings("@project:host:project", settings, true);
  await store.sync();
  expect(loadProjectChatBackgroundSettings("@project:host:project")).toEqual(settings);
  expect(localStorage.getItem("omnicode:project-chat-backgrounds")).toBe(legacy);
  expect(store.getItem("omnicode.projectBackgroundAssets")).not.toContain("/old/background.png");
  expect(() => saveProjectChatBackgroundSettings("@project:host:other", { ...settings, path: "/private/local.png" })).toThrow("Upload the background");
  expect(loadProjectChatBackgroundSettings("@project:host:other")).toBeNull();
});

it("does not borrow project backgrounds from another verified Host", async () => {
  const offline = async <T,>(): Promise<T> => { throw new Error("offline"); };
  const first = new SharedPreferenceStore("host-one", localStorage, offline);
  activatePreferenceStore(first);
  saveProjectChatBackgroundSettings("@project:host-one:project", {
    path: "host-asset:host-one:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", opacity: 0.2, effect: "none",
  });
  await first.sync();
  activatePreferenceStore(new SharedPreferenceStore("host-two", localStorage, offline));
  expect(loadProjectChatBackgroundSettings("@project:host-one:project")).toBeNull();
});
