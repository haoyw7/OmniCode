// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { CODE_THEMES, codeThemeInput, codeThemeName, loadCodeThemePalette } from "../../../shared/theme/codeThemes";
import { codeHighlightThemes, loadCodeTheme, saveCodeTheme } from "./codeAppearance";
import { validateSharedPreferenceValue } from "../../../domain/sharedPreferenceSchema";

beforeEach(() => localStorage.clear());

it("stores independent light and dark selections and rejects themes for the wrong mode", () => {
  expect(loadCodeTheme("light")).toBe("claude-light");
  expect(loadCodeTheme("dark")).toBe("claude-dark");
  saveCodeTheme("light", "catppuccin-latte");
  saveCodeTheme("dark", "nord");
  expect(codeHighlightThemes()).toEqual(["catppuccin-latte", "nord"]);
  saveCodeTheme("light", "nord");
  expect(loadCodeTheme("light")).toBe("catppuccin-latte");
  localStorage.setItem("omnicode.codeTheme.dark", "removed-theme");
  expect(loadCodeTheme("dark")).toBe("claude-dark");
  expect(validateSharedPreferenceValue("omnicode.codeTheme.light", "pierre-light")).toBe(true);
  expect(validateSharedPreferenceValue("omnicode.codeTheme.dark", "pierre-dark")).toBe(true);
});

it("loads and highlights every selectable theme with the advertised color mode and palette", async () => {
  const highlighter = await createHighlighter({ themes: [], langs: ["typescript"], engine: createJavaScriptRegexEngine() });
  try {
    for (const scheme of ["light", "dark"] as const) {
      for (const option of CODE_THEMES[scheme]) {
        await highlighter.loadTheme(codeThemeInput(option.value));
        const name = codeThemeName(option.value);
        expect(highlighter.getTheme(name).type, option.label).toBe(scheme);
        const code = 'function greet(name: string) { return `Hello, ${name}!`; }';
        const result = highlighter.codeToTokens(code, { lang: "typescript", theme: name });
        expect(result.tokens.flat().map((token) => token.content).join(""), option.label).toBe(code);
        expect(new Set(result.tokens.flat().map((token) => token.color)).size, option.label).toBeGreaterThan(1);
        const palette = await loadCodeThemePalette(option.value);
        expect(palette.background.toLowerCase(), option.label).toBe(result.bg?.toLowerCase());
        expect(palette.foreground.toLowerCase(), option.label).toBe(result.fg?.toLowerCase());
      }
    }
  } finally { highlighter.dispose(); }
});
