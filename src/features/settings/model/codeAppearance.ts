import { useEffect, useState, useSyncExternalStore } from "react";
import type { ThemeInput } from "@streamdown/code";
import { DEFAULT_CODE_THEMES, codeThemeInput, codeThemePalette, isCodeTheme, loadCodeThemePalette, type CodeColorScheme, type CodeThemeId, type CodeThemeSelection } from "../../../shared/theme/codeThemes";
import { preferenceStorage, subscribeSharedPreferences } from "./sharedPreferences";

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

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === keyFor("light") || event.key === keyFor("dark")) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  const stop = subscribeSharedPreferences(listener);
  return () => {
    stop();
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

const snapshot = () => `${loadCodeTheme("light")}:${loadCodeTheme("dark")}`;

export function useCodeThemes(): CodeThemeSelection {
  const value = useSyncExternalStore(subscribe, snapshot, () => "claude-light:claude-dark");
  const [light, dark] = value.split(":") as [CodeThemeId, CodeThemeId];
  return { light, dark };
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
