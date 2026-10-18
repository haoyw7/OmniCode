// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { activatePreferenceStore, SharedPreferenceStore } from "../../settings/model/sharedPreferences";
import { loadProjectChatBackgroundSettings, saveProjectChatBackgroundSettings } from "./projectChatBackground";

afterEach(() => { activatePreferenceStore(undefined); localStorage.clear(); });

it("keeps project background references portable and retains the legacy file as recovery data", async () => {
  const legacy = JSON.stringify({ "/repo": { path: "/old/background.png", opacity: 0.2 } });
  localStorage.setItem("monocode:project-chat-backgrounds", legacy);
  const store = new SharedPreferenceStore("host", localStorage, async () => { throw new Error("offline"); });
  activatePreferenceStore(store);
  const settings = { path: "host-asset:host:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", emptyOpacity: 0.2, sessionOpacity: 0.3, scope: "all" as const, effect: "none" as const };
  saveProjectChatBackgroundSettings("@project:host:project", settings, true);
  await store.sync();
  expect(loadProjectChatBackgroundSettings("@project:host:project")).toEqual(settings);
  expect(localStorage.getItem("monocode:project-chat-backgrounds")).toBe(legacy);
  expect(store.getItem("monocode.projectBackgroundAssets")).not.toContain("/old/background.png");
  expect(() => saveProjectChatBackgroundSettings("@project:host:other", { ...settings, path: "/private/local.png" })).toThrow("Upload the background");
  expect(loadProjectChatBackgroundSettings("@project:host:other")).toBeNull();
});

it("does not borrow project backgrounds from another verified Host", async () => {
  const offline = async <T,>(): Promise<T> => { throw new Error("offline"); };
  const first = new SharedPreferenceStore("host-one", localStorage, offline);
  activatePreferenceStore(first);
  saveProjectChatBackgroundSettings("@project:host-one:project", {
    path: "host-asset:host-one:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", emptyOpacity: 0.2, sessionOpacity: 0.3, scope: "all", effect: "none",
  });
  await first.sync();
  activatePreferenceStore(new SharedPreferenceStore("host-two", localStorage, offline));
  expect(loadProjectChatBackgroundSettings("@project:host-one:project")).toBeNull();
});
