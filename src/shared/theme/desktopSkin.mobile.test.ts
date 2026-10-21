// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "../../../tests/helpers/themeRoot";
import { applyThemePreference } from "../../features/settings/model/appearance";
import { saveDesktopSkin } from "./desktopSkin";

const root = document.documentElement;
let reactRoot: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  root.className = "";
  root.removeAttribute("style");
  delete root.dataset.skin;
  root.dataset.mobileSkin = "midnight";
  container = document.createElement("div");
  document.body.append(container);
  reactRoot = createRoot(container, true);
  await act(async () => reactRoot.render(null));
});
afterEach(() => {
  act(() => reactRoot.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
  root.className = "";
  root.removeAttribute("style");
  delete root.dataset.skin;
  delete root.dataset.mobileSkin;
});

it("keeps the default desktop Auto skin out of a mobile document", async () => {
  // applyMobileSkin marks the document before calling the shared theme API.
  root.dataset.mobileSkin = "atelier";
  await act(async () => { expect(applyThemePreference("light")).toBe("light"); });
  expect(root.classList.contains("theme-light")).toBe(true);
  expect(root.dataset.skin).toBeUndefined();
  expect(root.style.colorScheme).toBe("light");
});

it("preserves each mobile skin's scheme and clears stale desktop skin overrides", async () => {
  await act(async () => saveDesktopSkin("foundry"));
  for (const [skin, scheme] of [["atelier", "light"], ["graphite", "dark"]] as const) {
    root.dataset.mobileSkin = skin;
    root.dataset.skin = "foundry";
    root.style.colorScheme = "dark";
    await act(async () => { expect(applyThemePreference(scheme)).toBe(scheme); });
    expect(root.dataset.mobileSkin).toBe(skin);
    expect(root.classList.contains("theme-light")).toBe(scheme === "light");
    expect(root.dataset.skin).toBeUndefined();
    expect(root.style.colorScheme).toBe(scheme);
  }
});
