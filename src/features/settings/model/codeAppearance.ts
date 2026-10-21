import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { ThemeInput } from "@streamdown/code";
import {
  DEFAULT_CODE_THEMES, codeThemeInput, codeThemePalette, isCodeTheme, loadCodeThemePalette,
  type CodeColorScheme, type CodeThemeId, type CodeThemeSelection,
} from "../../../shared/theme/codeThemes";
import { preferenceStorage } from "./sharedPreferences";

const CHANGE_EVENT = "omnicode:code-themes-changed";
const keyFor = (scheme: CodeColorScheme) => `omnicode.codeTheme.${scheme}`;

export function loadCodeTheme(scheme: CodeColorScheme): CodeThemeId {
  try {
    const value = preferenceStorage.getItem(keyFor(scheme));
    if (isCodeTheme(scheme, value)) return value;
  } catch { /* Use the default when storage is unavailable. */ }
  return DEFAULT_CODE_THEMES[scheme];
}

export function saveCodeTheme(scheme: CodeColorScheme, theme: string) {
  if (!isCodeTheme(scheme, theme)) return;
  preferenceStorage.setItem(keyFor(scheme), theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useCodeThemes(): CodeThemeSelection {
  const light = useStore(preferenceStorage.store(keyFor("light")), state => state.value);
  const dark = useStore(preferenceStorage.store(keyFor("dark")), state => state.value);
  return {
    light: isCodeTheme("light", light) ? light : DEFAULT_CODE_THEMES.light,
    dark: isCodeTheme("dark", dark) ? dark : DEFAULT_CODE_THEMES.dark,
  };
}

export function codeHighlightThemes(): [ThemeInput, ThemeInput] {
  return (["light", "dark"] as const).map((scheme) =>
    codeThemeInput(loadCodeTheme(scheme)),
  ) as [ThemeInput, ThemeInput];
}

export function useCodeThemePalette(id: CodeThemeId) {
  const [loaded, setLoaded] = useState({ id, palette: codeThemePalette(id) });
  useEffect(() => {
    let current = true;
    if (id.startsWith("claude-")) return;
    void loadCodeThemePalette(id).then((palette) => {
      if (current) setLoaded({ id, palette });
    }).catch(() => { /* Keep the readable fallback palette. */ });
    return () => { current = false; };
  }, [id]);
  return loaded.id === id ? loaded.palette : codeThemePalette(id);
}
