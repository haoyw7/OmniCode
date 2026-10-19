import type { BundledTheme, ThemeRegistration } from "shiki";
import pierreLight from "@pierre/theme/pierre-light";
import pierreDark from "@pierre/theme/pierre-dark";

export type CodeColorScheme = "light" | "dark";
export const CODE_THEMES = {
  light: [
    { value: "claude-light", label: "Claude Light" },
    { value: "github-light", label: "GitHub Light" },
    { value: "pierre-light", label: "Pierre Light" },
    { value: "one-light", label: "One Light" },
    { value: "catppuccin-latte", label: "Catppuccin Latte" },
    { value: "solarized-light", label: "Solarized Light" },
    { value: "vitesse-light", label: "Vitesse Light" },
    { value: "min-light", label: "Min Light" },
    { value: "rose-pine-dawn", label: "Rosé Pine Dawn" },
    { value: "slack-ochin", label: "Slack Ochin" },
  ],
  dark: [
    { value: "claude-dark", label: "Claude Dark" },
    { value: "github-dark", label: "GitHub Dark" },
    { value: "pierre-dark", label: "Pierre Dark" },
    { value: "one-dark-pro", label: "One Dark Pro" },
    { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
    { value: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
    { value: "catppuccin-frappe", label: "Catppuccin Frappé" },
    { value: "solarized-dark", label: "Solarized Dark" },
    { value: "vitesse-dark", label: "Vitesse Dark" },
    { value: "min-dark", label: "Min Dark" },
    { value: "rose-pine", label: "Rosé Pine" },
    { value: "rose-pine-moon", label: "Rosé Pine Moon" },
    { value: "slack-dark", label: "Slack Dark" },
    { value: "nord", label: "Nord" },
    { value: "dracula", label: "Dracula" },
    { value: "tokyo-night", label: "Tokyo Night" },
  ],
} as const;
export type CodeThemeId = (typeof CODE_THEMES)[CodeColorScheme][number]["value"];
export type CodeThemeSelection = Record<CodeColorScheme, CodeThemeId>;
export const DEFAULT_CODE_THEMES: CodeThemeSelection = { light: "claude-light", dark: "claude-dark" };

export function isCodeTheme(scheme: CodeColorScheme, value: unknown): value is CodeThemeId {
  return CODE_THEMES[scheme].some((theme) => theme.value === value);
}

export const CODE_PALETTES = {
  claude: {
    light: { background: "#ffffff", foreground: "#30302e", keyword: "#e65b00", callable: "#0086ff", string: "#00a52f", type: "#9868ff", number: "#9868ff", comment: "#898781", property: "#30302e", meta: "#898781", invalid: "#e60035", addition: "#e6f3e7", deletion: "#fce6e9", additionWord: "#c5e8c8", deletionWord: "#f7c9d0", added: "#00a52f", removed: "#ed0038" },
    dark: { background: "#1a1a19", foreground: "#c9c9c5", keyword: "#da7bff", callable: "#68b5ff", string: "#a5df58", type: "#ffa83e", number: "#ffa83e", comment: "#898781", property: "#c9c9c5", meta: "#898781", invalid: "#ff5376", addition: "#253c24", deletion: "#492626", additionWord: "#315b29", deletionWord: "#71383c", added: "#00c638", removed: "#ff174d" },
  },
  github: {
    light: { background: "#ffffff", foreground: "#24292e", keyword: "#d73a49", callable: "#6f42c1", string: "#032f62", type: "#005cc5", number: "#005cc5", comment: "#6a737d", property: "#24292e", meta: "#6a737d", invalid: "#b31d28", addition: "#e6ffed", deletion: "#ffeef0", additionWord: "#acf2bd", deletionWord: "#fdb8c0", added: "#22863a", removed: "#cb2431" },
    dark: { background: "#24292e", foreground: "#e1e4e8", keyword: "#f97583", callable: "#b392f0", string: "#9ecbff", type: "#79b8ff", number: "#79b8ff", comment: "#6a737d", property: "#e1e4e8", meta: "#6a737d", invalid: "#f97583", addition: "#183c2a", deletion: "#4a252b", additionWord: "#24643c", deletionWord: "#7c303b", added: "#85e89d", removed: "#f97583" },
  },
} as const;

export function codeThemeName(id: CodeThemeId) {
  return id.startsWith("claude-") ? `omnicode-${id}` : id;
}

/** TextMate scopes share the preview/editor palette; Shiki owns tokenization. */
export function claudeCodeTheme(scheme: CodeColorScheme): ThemeRegistration {
  const palette = CODE_PALETTES.claude[scheme];
  return {
    name: codeThemeName(`claude-${scheme}`),
    displayName: scheme === "light" ? "Claude Light" : "Claude Dark",
    type: scheme,
    colors: { "editor.background": palette.background, "editor.foreground": palette.foreground },
    tokenColors: [
      { scope: ["keyword", "storage", "constant.language"], settings: { foreground: palette.keyword } },
      { scope: ["entity.name.function", "support.function"], settings: { foreground: palette.callable } },
      { scope: ["string", "markup.inline.raw"], settings: { foreground: palette.string } },
      { scope: ["entity.name.type", "support.type", "support.class", "storage.type.primitive"], settings: { foreground: palette.type } },
      { scope: "constant.numeric", settings: { foreground: palette.number } },
      { scope: "comment", settings: { foreground: palette.comment } },
      { scope: ["variable", "punctuation"], settings: { foreground: palette.foreground } },
      { scope: "variable.parameter", settings: { foreground: scheme === "dark" ? palette.type : palette.foreground } },
      { scope: ["meta.template.expression", "punctuation.definition.template-expression"], settings: { foreground: palette.foreground } },
      { scope: "invalid", settings: { foreground: palette.invalid } },
    ],
  };
}

export function codeThemeInput(id: CodeThemeId): BundledTheme | ThemeRegistration {
  if (id === "claude-light" || id === "claude-dark") return claudeCodeTheme(id === "claude-light" ? "light" : "dark");
  if (id === "pierre-light") return { ...pierreLight, name: id } as ThemeRegistration;
  if (id === "pierre-dark") return { ...pierreDark, name: id } as ThemeRegistration;
  return id;
}

export type CodePalette = { [Key in keyof typeof CODE_PALETTES.claude.light]: string };
const palettes = new Map<CodeThemeId, CodePalette>();
const pendingPalettes = new Map<CodeThemeId, Promise<CodePalette>>();

export function codeThemePalette(id: CodeThemeId): CodePalette {
  const scheme = CODE_THEMES.light.some((theme) => theme.value === id) ? "light" : "dark";
  return palettes.get(id) ?? CODE_PALETTES[id.startsWith("github-") ? "github" : "claude"][scheme];
}

/** Resolve bundled palettes lazily so the menu does not preload every theme. */
export function loadCodeThemePalette(id: CodeThemeId): Promise<CodePalette> {
  const cached = pendingPalettes.get(id);
  if (cached) return cached;
  const pending = (async () => {
    const { bundledThemes, normalizeTheme } = await import("shiki");
    const input = codeThemeInput(id);
    const theme = typeof input === "string"
      ? (await bundledThemes[input]()).default
      : input as ThemeRegistration;
    const normalized = normalizeTheme(theme);
    const fallback = codeThemePalette(id);
    const rules = [...(theme.tokenColors ?? theme.settings ?? [])].reverse();
    const color = (scope: RegExp, otherwise: string) => rules.find((rule) => {
      const scopes = typeof rule.scope === "string" ? [rule.scope] : rule.scope ?? [];
      return rule.settings.foreground && scopes.some((entry) => scope.test(entry));
    })?.settings.foreground ?? otherwise;
    const palette: CodePalette = {
      ...fallback,
      background: normalized.bg,
      foreground: normalized.fg,
      keyword: color(/^keyword$|^keyword.control|^storage.type$/, fallback.keyword),
      callable: color(/^entity.name.function|^support.function$/, fallback.callable),
      string: color(/^string$|^string.quoted$/, fallback.string),
      type: color(/^entity.name.type|^support.type|^support.class/, fallback.type),
      number: color(/^constant.numeric/, fallback.number),
      comment: color(/^comment/, fallback.comment),
      property: color(/^variable.other.property|^variable.other.object.property/, fallback.property),
    };
    palettes.set(id, palette);
    return palette;
  })();
  pendingPalettes.set(id, pending);
  pending.catch(() => pendingPalettes.delete(id));
  return pending;
}
