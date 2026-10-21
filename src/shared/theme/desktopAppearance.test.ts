// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadThemePreference, resolveColorScheme, saveThemePreference } from "../../features/settings/model/appearance";
import { DESKTOP_APPEARANCE_BACKUP_KEY, DESKTOP_SCHEME_KEY, LEGACY_SKIN_SCHEMES } from "./desktopAppearance";
import { DESKTOP_SKIN_INFO, loadDesktopSkin, resolveDesktopSkin } from "./desktopSkin";
import { themeBootstrap } from "../../../scripts/theme-bootstrap.mjs";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  delete document.documentElement.dataset.mobileSkin;
});
afterEach(() => { vi.restoreAllMocks(); delete document.documentElement.dataset.mobileSkin; });

describe("desktop appearance migration", () => {
  it.each(Object.entries(LEGACY_SKIN_SCHEMES))("migrates %s without changing shared/mobile theme", (skin, scheme) => {
    localStorage.setItem("omnicode.desktopSkin", skin);
    localStorage.setItem("omnicode.colorScheme", "system");
    localStorage.setItem("omnicode.themeHue", "173");
    expect(loadThemePreference()).toBe(scheme);
    expect(localStorage.getItem("omnicode.colorScheme")).toBe("system");
    expect(localStorage.getItem("omnicode.themeHue")).toBe("173");
    const backup = localStorage.getItem(DESKTOP_APPEARANCE_BACKUP_KEY)!;
    expect(JSON.parse(backup)).toMatchObject({ desktopSkin: skin, colorScheme: "system", themeHue: "173" });
    saveThemePreference("system");
    expect(loadThemePreference()).toBe("system");
    expect(localStorage.getItem(DESKTOP_APPEARANCE_BACKUP_KEY)).toBe(backup);
    expect(loadDesktopSkin()).toBe(skin);
  });

  it.each(["classic", "auto"])("preserves %s mode and font/scale preferences", skin => {
    localStorage.setItem("omnicode.desktopSkin", skin);
    localStorage.setItem("omnicode.colorScheme", "system");
    localStorage.setItem("omnicode.uiFontSize", "18");
    localStorage.setItem("omnicode.uiScale", "1.25");
    expect(loadThemePreference()).toBe("system");
    expect(localStorage.getItem("omnicode.uiFontSize")).toBe("18");
    expect(localStorage.getItem("omnicode.uiScale")).toBe("1.25");
  });

  it("uses dark for invalid values without replaying a previous skin", () => {
    localStorage.setItem("omnicode.desktopSkin", "broken");
    localStorage.setItem("omnicode.colorScheme", "light");
    expect(loadThemePreference()).toBe("dark");
    localStorage.setItem(DESKTOP_SCHEME_KEY, "broken");
    localStorage.setItem("omnicode.desktopSkin", "meadow");
    expect(loadThemePreference()).toBe("dark");
  });

  it("applies the resolved mode when persistence fails", () => {
    localStorage.setItem("omnicode.desktopSkin", "atelier");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(loadThemePreference()).toBe("light");
  });

  it("does not migrate or write desktop preferences on mobile", () => {
    localStorage.setItem("omnicode.desktopSkin", "atelier");
    localStorage.setItem("omnicode.colorScheme", "dark");
    document.documentElement.dataset.mobileSkin = "midnight";
    expect(loadThemePreference()).toBe("dark");
    saveThemePreference("light");
    expect(localStorage.getItem("omnicode.colorScheme")).toBe("light");
    expect(localStorage.getItem(DESKTOP_SCHEME_KEY)).toBeNull();
    expect(localStorage.getItem(DESKTOP_APPEARANCE_BACKUP_KEY)).toBeNull();
  });

  it("boot palette agrees with runtime migration for every legacy input", () => {
    const boot = readFileSync("index.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)![1];
    const themeBoot = themeBootstrap();
    for (const skin of [...Object.keys(LEGACY_SKIN_SCHEMES), "classic", "auto", "invalid"]) {
      for (const scheme of ["light", "dark", "system", "invalid"]) {
        for (const migrated of [false, true]) {
          localStorage.clear();
          delete document.documentElement.dataset.skin;
          localStorage.setItem("omnicode.desktopSkin", skin);
          localStorage.setItem("omnicode.colorScheme", scheme);
          if (migrated) localStorage.setItem(DESKTOP_SCHEME_KEY, scheme);
          new Function(themeBoot)();
          new Function(boot)();
          const first = document.documentElement.dataset.skin;
          const runtime = resolveDesktopSkin(loadDesktopSkin(), resolveColorScheme(loadThemePreference()) === "light");
          expect(runtime, `${skin}/${scheme}`).toBe(first);
          expect(document.documentElement.classList.contains(`theme-${DESKTOP_SKIN_INFO[runtime].scheme}`)).toBe(true);
        }
      }
    }
  });
});
