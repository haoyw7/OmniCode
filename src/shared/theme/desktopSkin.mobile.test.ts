// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { applyThemePreference } from "../../features/settings/model/appearance";
import { saveDesktopSkin } from "./desktopSkin";

const root = document.documentElement;
beforeEach(() => {
  localStorage.clear();
  root.className = "";
  root.removeAttribute("style");
  delete root.dataset.skin;
  delete root.dataset.mobileSkin;
});
afterEach(() => {
  localStorage.clear();
  root.className = "";
  root.removeAttribute("style");
  delete root.dataset.skin;
  delete root.dataset.mobileSkin;
});

it("keeps the default desktop Auto skin out of a mobile document", () => {
  // applyMobileSkin marks the document before calling the shared theme API.
  root.dataset.mobileSkin = "atelier";
  expect(applyThemePreference("light")).toBe("light");
  expect(root.classList.contains("theme-light")).toBe(true);
  expect(root.dataset.skin).toBeUndefined();
  expect(root.style.colorScheme).toBe("");
});

it("preserves each mobile skin's scheme and clears stale desktop skin overrides", () => {
  saveDesktopSkin("foundry");
  for (const [skin, scheme] of [["atelier", "light"], ["graphite", "dark"]] as const) {
    root.dataset.mobileSkin = skin;
    root.dataset.skin = "foundry";
    root.style.colorScheme = "dark";
    expect(applyThemePreference(scheme)).toBe(scheme);
    expect(root.dataset.mobileSkin).toBe(skin);
    expect(root.classList.contains("theme-light")).toBe(scheme === "light");
    expect(root.dataset.skin).toBeUndefined();
    expect(root.style.colorScheme).toBe("");
  }
});
