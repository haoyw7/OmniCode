// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppearanceThemeProvider } from "./AppearanceThemeProvider";
import { applyThemePreference, loadThemePreference, saveThemePreference } from "./appearance";
import { activatePreferenceStore, adoptDeviceLocalPreferences, SharedPreferenceStore, subscribeSharedPreferences } from "./sharedPreferences";
import { DEVICE_LOCAL_PREFERENCE_KINDS, SHARED_PREFERENCE_KINDS } from "./sharedPreferenceSchema";
import { DESKTOP_SKIN_KEY, saveDesktopSkin } from "../../../shared/theme/desktopSkin";
import { DESKTOP_THEME_STORAGE_KEY, MOBILE_THEME_STORAGE_KEY, type ColorScheme } from "../../../shared/theme/themeConfig";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { applyMobileSkin, loadMobileSkin, MOBILE_SKIN_KEY, paintMobileSkin, resolveMobileSkin } from "../../../mobile/theme/skin";
import { themeBootstrap } from "../../../../scripts/theme-bootstrap.mjs";

let root: Root;
let container: HTMLDivElement;
const syncMobile = () => { applyMobileSkin(loadMobileSkin(), loadThemePreference()); };
const paintMobile = (scheme: ColorScheme) => paintMobileSkin(resolveMobileSkin(loadMobileSkin(), scheme));
function Probe() { return createElement("output", null, useColorScheme()); }
async function mount(mobile = false) {
  await act(async () => root.render(createElement(AppearanceThemeProvider, {
    storageKey: mobile ? MOBILE_THEME_STORAGE_KEY : DESKTOP_THEME_STORAGE_KEY,
    ...(mobile ? { syncPreference: syncMobile, applySkin: paintMobile, skinStorageKey: MOBILE_SKIN_KEY } : {}),
    children: createElement(Probe),
  })));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  document.documentElement.className = "";
  for (const key of ["skin", "mobileSkin", "desktopVisual"]) delete document.documentElement.dataset[key];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  activatePreferenceStore(undefined);
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps pre-paint and mounted themes identical, with skin independent of preference", async () => {
  localStorage.setItem(DESKTOP_THEME_STORAGE_KEY, "dark");
  localStorage.setItem(DESKTOP_SKIN_KEY, "lagoon");
  new Function(themeBootstrap())();
  expect(document.documentElement.classList.contains("theme-light")).toBe(true);
  await mount();
  expect(container.querySelector("output")!.textContent).toBe("light");
  expect(localStorage.getItem(DESKTOP_THEME_STORAGE_KEY)).toBe("dark");
  await act(async () => saveDesktopSkin("foundry"));
  expect(document.documentElement.dataset.skin).toBe("foundry");
  expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
  await act(async () => {
    saveDesktopSkin("auto");
    applyThemePreference("light");
    saveThemePreference("light");
  });
  expect(document.documentElement.dataset.skin).toBe("daylight");
  expect(document.documentElement.classList.contains("theme-dark")).toBe(false);
});

it("receives desktop skin changes from another window", async () => {
  await mount();
  await act(async () => {
    localStorage.setItem(DESKTOP_SKIN_KEY, "atelier");
    window.dispatchEvent(new StorageEvent("storage", { key: DESKTOP_SKIN_KEY, newValue: "atelier" }));
  });
  expect(document.documentElement.dataset.skin).toBe("atelier");
  expect(container.querySelector("output")!.textContent).toBe("light");
});

it("preserves an adopted desktop theme instead of treating its synthetic storage event as deletion", async () => {
  await mount();
  const store = new SharedPreferenceStore("adopt-theme", localStorage, async <T>() => ({
    revision: 1, imported: true, values: { [DESKTOP_THEME_STORAGE_KEY]: "light" },
  }) as T);
  await act(async () => {
    await store.sync();
    adoptDeviceLocalPreferences(store, true);
  });
  expect(localStorage.getItem(DESKTOP_THEME_STORAGE_KEY)).toBe("light");
  expect(container.querySelector("output")!.textContent).toBe("light");
});

it("bridges Host colorScheme into mobile next-themes without journaling an echo or changing desktop", async () => {
  localStorage.setItem(DESKTOP_THEME_STORAGE_KEY, "dark");
  document.documentElement.dataset.mobileSkin = "midnight";
  let revision = 0;
  let preference = "light";
  const request = vi.fn(async () => ({ revision, imported: true, values: { "omnicode.colorScheme": preference } }));
  const store = new SharedPreferenceStore("theme-test", localStorage, request);
  activatePreferenceStore(store);
  const unsubscribe = subscribeSharedPreferences(syncMobile);
  try {
    await mount(true);
    await act(async () => { await store.sync(); });
    expect(container.querySelector("output")!.textContent).toBe("light");
    expect(document.documentElement.dataset.mobileSkin).toBe("daylight");
    expect(localStorage.getItem(MOBILE_THEME_STORAGE_KEY)).toBe("light");
    preference = "dark";
    revision++;
    await act(async () => { await store.sync(); });
    expect(document.documentElement.dataset.mobileSkin).toBe("midnight");
    expect(localStorage.getItem(DESKTOP_THEME_STORAGE_KEY)).toBe("dark");
    expect(store.pendingCount).toBe(0);
    expect(request.mock.calls.every(([method]) => method === "preferences.read")).toBe(true);
    expect(SHARED_PREFERENCE_KINDS[MOBILE_THEME_STORAGE_KEY]).toBeUndefined();
    expect(DEVICE_LOCAL_PREFERENCE_KINDS[MOBILE_THEME_STORAGE_KEY]).toBe("string");
  } finally { unsubscribe(); }
});
