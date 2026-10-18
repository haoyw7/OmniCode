// @vitest-environment happy-dom
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MOBILE_SKINS,
  MOBILE_SKIN_INFO,
  MOBILE_SKIN_KEY,
  applyMobileSkin,
  loadMobileSkin,
  resolveMobileSkin,
  saveMobileSkin,
} from "./skin";

vi.mock("@capacitor/status-bar", async (importOriginal) => ({
  ...await importOriginal<typeof import("@capacitor/status-bar")>(),
  StatusBar: { setStyle: vi.fn(() => Promise.resolve()) },
}));

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="#171717">';
  document.documentElement.className = "";
  delete document.documentElement.dataset.mobileSkin;
});
afterEach(() => vi.restoreAllMocks());

describe("mobile skin preference", () => {
  it("defaults to the automatic skin and repairs unknown values", () => {
    expect(loadMobileSkin()).toBe("auto");
    localStorage.setItem(MOBILE_SKIN_KEY, "neon");
    expect(loadMobileSkin()).toBe("auto");
    saveMobileSkin("lagoon");
    expect(localStorage.getItem(MOBILE_SKIN_KEY)).toBe("lagoon");
    expect(loadMobileSkin()).toBe("lagoon");
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadMobileSkin()).toBe("auto");
    expect(() => saveMobileSkin("dusk")).not.toThrow();
  });

  it("maps the existing color mode onto Midnight and Daylight", () => {
    expect(resolveMobileSkin("auto", "dark", true)).toBe("midnight");
    expect(resolveMobileSkin("auto", "light", false)).toBe("daylight");
    expect(resolveMobileSkin("auto", "system", true)).toBe("daylight");
    expect(resolveMobileSkin("auto", "system", false)).toBe("midnight");
    // A chosen skin ignores color mode.
    expect(resolveMobileSkin("foundry", "light", true)).toBe("foundry");
  });
});

describe("applying a skin", () => {
  it("sets the skin, the shared light class and the browser theme color", () => {
    expect(applyMobileSkin("atelier", "dark")).toBe("atelier");
    const root = document.documentElement;
    expect(root.dataset.mobileSkin).toBe("atelier");
    expect(root.classList.contains("theme-light")).toBe(true);
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe("#f5f1eb");
    applyMobileSkin("auto", "dark");
    expect(root.dataset.mobileSkin).toBe("midnight");
    expect(root.classList.contains("theme-light")).toBe(false);
  });

  it("matches native status bar icons to the skin", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    applyMobileSkin("meadow", "dark");
    expect(StatusBar.setStyle).toHaveBeenLastCalledWith({ style: Style.Light });
    applyMobileSkin("graphite", "light");
    expect(StatusBar.setStyle).toHaveBeenLastCalledWith({ style: Style.Dark });
  });
});

// WCAG 2.x contrast over the parsed skin blocks, so palette edits are gated.
const css = readFileSync("src/mobile/theme/skins.css", "utf8");
function tokens(skin: string) {
  const block = new RegExp(`\\[data-mobile-skin="${skin}"\\] \\{([^}]*)\\}`).exec(css)![1];
  return Object.fromEntries([...block.matchAll(/--color-m-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
function rgba(hex: string): [number, number, number, number] {
  const h = hex.slice(1);
  const v = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4, 6].map((i) => (i < v.length ? parseInt(v.slice(i, i + 2), 16) : 255)) as [number, number, number, number];
}
function over(fg: string, bg: string): [number, number, number] {
  const [r, g, b, a] = rgba(fg); const [br, bgc, bb] = rgba(bg); const k = a / 255;
  return [r * k + br * (1 - k), g * k + bgc * (1 - k), b * k + bb * (1 - k)];
}
function luminance([r, g, b]: number[]) {
  const c = [r, g, b].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(fg: string, bg: string) {
  const a = luminance(over(fg, bg)); const b = luminance(rgba(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(MOBILE_SKINS)("%s contrast", (skin) => {
  const t = tokens(skin);
  it("declares every token and the scheme the skin reports", () => {
    expect(Object.keys(t)).toHaveLength(26);
    expect(new RegExp(`data-mobile-skin="${skin}"\\] \\{\\s*color-scheme: ${MOBILE_SKIN_INFO[skin].scheme};`).test(css)).toBe(true);
    expect(t.app.toLowerCase()).toBe(MOBILE_SKIN_INFO[skin].app);
  });
  it.each(["app", "panel", "card", "raised", "composer", "inset"])("keeps body and secondary ink at AA on %s", (surface) => {
    expect(contrast(t.ink, t[surface])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["ink-secondary"], t[surface])).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps user bubble text at AA", () => {
    expect(contrast(t["bubble-user-ink"], t["bubble-user"])).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps accent fills legible (AA for icons and bold controls)", () => {
    // Midnight keeps the upstream blue: white measures 3.65:1, which passes the
    // 3:1 non-text/large-text level the filled send and primary controls need.
    expect(contrast(t["accent-ink"], t.accent)).toBeGreaterThanOrEqual(skin === "midnight" ? 3 : 4.5);
  });
});
