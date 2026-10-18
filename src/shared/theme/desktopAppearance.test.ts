// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyThemePreference, loadThemePreference, saveThemePreference } from "../../features/settings/model/appearance";
import { DESKTOP_APPEARANCE_BACKUP_KEY, DESKTOP_SCHEME_KEY, LEGACY_SKIN_SCHEMES } from "./desktopAppearance";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  delete document.documentElement.dataset.mobileSkin;
});
afterEach(() => { vi.restoreAllMocks(); delete document.documentElement.dataset.mobileSkin; });

describe("desktop appearance migration", () => {
  it.each(Object.entries(LEGACY_SKIN_SCHEMES))("migrates %s without changing shared/mobile theme", (skin, scheme) => {
    localStorage.setItem("monocode.desktopSkin", skin);
    localStorage.setItem("monocode.colorScheme", "system");
    localStorage.setItem("monocode.themeHue", "173");
    expect(loadThemePreference()).toBe(scheme);
    expect(localStorage.getItem("monocode.colorScheme")).toBe("system");
    expect(localStorage.getItem("monocode.themeHue")).toBe("173");
    const backup = localStorage.getItem(DESKTOP_APPEARANCE_BACKUP_KEY)!;
    expect(JSON.parse(backup)).toMatchObject({ desktopSkin: skin, colorScheme: "system", themeHue: "173" });
    saveThemePreference("system");
    expect(loadThemePreference()).toBe("system");
    expect(localStorage.getItem(DESKTOP_APPEARANCE_BACKUP_KEY)).toBe(backup);
    applyThemePreference(scheme);
    expect(document.documentElement.dataset.skin).toBe(skin);
  });

  it.each(["classic", "auto"])("preserves %s mode and font/scale preferences", skin => {
    localStorage.setItem("monocode.desktopSkin", skin);
    localStorage.setItem("monocode.colorScheme", "system");
    localStorage.setItem("monocode.uiFontSize", "18");
    localStorage.setItem("monocode.uiScale", "1.25");
    expect(loadThemePreference()).toBe("system");
    expect(localStorage.getItem("monocode.uiFontSize")).toBe("18");
    expect(localStorage.getItem("monocode.uiScale")).toBe("1.25");
  });

  it("uses dark for invalid values without replaying a previous skin", () => {
    localStorage.setItem("monocode.desktopSkin", "broken");
    localStorage.setItem("monocode.colorScheme", "light");
    expect(loadThemePreference()).toBe("dark");
    localStorage.setItem(DESKTOP_SCHEME_KEY, "broken");
    localStorage.setItem("monocode.desktopSkin", "meadow");
    expect(loadThemePreference()).toBe("dark");
  });

  it("applies the resolved mode when persistence fails", () => {
    localStorage.setItem("monocode.desktopSkin", "atelier");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(loadThemePreference()).toBe("light");
  });

  it("does not migrate or write desktop preferences on mobile", () => {
    localStorage.setItem("monocode.desktopSkin", "atelier");
    localStorage.setItem("monocode.colorScheme", "dark");
    document.documentElement.dataset.mobileSkin = "midnight";
    expect(loadThemePreference()).toBe("dark");
    saveThemePreference("light");
    expect(localStorage.getItem("monocode.colorScheme")).toBe("light");
    expect(localStorage.getItem(DESKTOP_SCHEME_KEY)).toBeNull();
    expect(localStorage.getItem(DESKTOP_APPEARANCE_BACKUP_KEY)).toBeNull();
  });

  it("boot palette agrees with runtime migration for every legacy input", () => {
    const boot = readFileSync("index.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)![1];
    for (const skin of [...Object.keys(LEGACY_SKIN_SCHEMES), "classic", "auto", "invalid"]) {
      for (const scheme of ["light", "dark", "system", "invalid"]) {
        for (const migrated of [false, true]) {
          localStorage.clear();
          localStorage.setItem("monocode.desktopSkin", skin);
          localStorage.setItem("monocode.colorScheme", scheme);
          if (migrated) localStorage.setItem(DESKTOP_SCHEME_KEY, scheme);
          new Function(boot)();
          const first = document.documentElement.dataset.skin;
          applyThemePreference(loadThemePreference());
          expect(document.documentElement.dataset.skin, `${skin}/${scheme}`).toBe(first);
        }
      }
    }
  });
});
