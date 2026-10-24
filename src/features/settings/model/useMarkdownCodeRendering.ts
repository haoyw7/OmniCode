import { useMemo } from "react";
import { boundedCode } from "../../connections/files/editor/codeHighlightPlugin";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { useCodeThemePalette, useCodeThemes } from "./codeAppearance";
import type { MarkdownRendering } from "../../../shared/ui/markdown/MarkdownRendering";

/** Preferences remain owned by settings; shared Markdown receives resolved values. */
export function useMarkdownCodeRendering(): MarkdownRendering {
  const themes = useCodeThemes();
  const colorScheme = useColorScheme();
  const palette = useCodeThemePalette(themes[colorScheme]);
  return useMemo(() => ({
    code: boundedCode,
    codeThemeKey: `${themes.light}:${themes.dark}`,
    codePalette: palette,
  }), [themes.light, themes.dark, palette]);
}
