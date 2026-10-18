import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESKTOP_SKIN_IDS, DESKTOP_SKIN_INFO } from "./desktopSkin";

// WCAG 2.x contrast over the parsed desktop skin blocks, so palette edits are
// gated. The phone palette is checked separately in src/mobile/theme.
const css = readFileSync("src/styles/desktop-theme.css", "utf8");
function tokens(skin: string) {
  const block = new RegExp(`\\[data-skin="${skin}"\\] \\{([^}]*)\\}`).exec(css)![1];
  return Object.fromEntries(
    [...block.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}
function rgba(hex: string): [number, number, number, number] {
  if (hex.startsWith("color(srgb")) {
    const channels = hex.match(/[\d.]+/g)!.map(Number);
    return [channels[0] * 255, channels[1] * 255, channels[2] * 255, 255];
  }
  const h = hex.slice(1);
  const v = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4, 6].map((i) => (i < v.length ? parseInt(v.slice(i, i + 2), 16) : 255)) as [
    number,
    number,
    number,
    number,
  ];
}
function over(fg: string, bg: string): [number, number, number] {
  const [r, g, b, a] = rgba(fg);
  const [br, bgc, bb] = rgba(bg);
  const k = a / 255;
  return [r * k + br * (1 - k), g * k + bgc * (1 - k), b * k + bb * (1 - k)];
}
function luminance([r, g, b]: number[]) {
  const c = [r, g, b].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(fg: string, bg: string) {
  const a = luminance(over(fg, bg));
  const b = luminance(rgba(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(DESKTOP_SKIN_IDS)("%s desktop skin", (skin) => {
  const t = tokens(skin);
  it("matches the ground the native window and splash paint", () => {
    expect(t.app.toLowerCase()).toBe(DESKTOP_SKIN_INFO[skin].app);
  });
  it.each(["app", "panel", "card", "raised", "composer", "inset"])(
    "keeps body and secondary ink at AA on %s",
    (surface) => {
      const background = "#" + over(t[surface], t.app).map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
      expect(contrast(t.ink, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["ink-secondary"], background)).toBeGreaterThanOrEqual(4.5);
    },
  );
  it("keeps user bubble text at AA", () => {
    expect(contrast(t["bubble-user-ink"], t["bubble-user"])).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps accent fills legible", () => {
    // The measured blue is used for focus and filled control glyphs.
    expect(contrast(t["accent-ink"], t.accent)).toBeGreaterThanOrEqual(3);
  });
});
