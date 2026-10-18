import { useSyncExternalStore } from "react";
import {
  preferenceStorage,
  subscribeSharedPreferences,
  SHARED_PREFERENCES_CHANGED,
} from "../../../settings/model/sharedPreferences";

export type EditorPreferences = {
  previewTabs: boolean;
  wordWrap: boolean;
  indentGuides: boolean;
  showWhitespace: boolean;
  scrollPastEnd: boolean;
  tabSize: number;
};
const defaults: EditorPreferences = {
  previewTabs: true,
  wordWrap: true,
  indentGuides: true,
  showWhitespace: false,
  scrollPastEnd: false,
  tabSize: 4,
};
const key = "monocode.editorPreferences";
let cachedRaw: string | null | undefined;
let cached = defaults;
export function loadEditorPreferences(): EditorPreferences {
  let raw: string | null = null;
  try {
    raw = preferenceStorage.getItem(key);
  } catch {
    /* Use defaults. */
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  let value: Partial<EditorPreferences> = {};
  try {
    value = JSON.parse(raw ?? "{}") ?? {};
  } catch {
    /* Use defaults. */
  }
  cached = { ...defaults };
  for (const name of [
    "previewTabs",
    "wordWrap",
    "indentGuides",
    "showWhitespace",
    "scrollPastEnd",
  ] as const) {
    if (typeof value[name] === "boolean") cached[name] = value[name];
  }
  if ([2, 4, 8].includes(value.tabSize ?? 0)) cached.tabSize = value.tabSize!;
  return cached;
}
export function saveEditorPreferences(patch: Partial<EditorPreferences>) {
  try {
    preferenceStorage.setItem(
      key,
      JSON.stringify({ ...loadEditorPreferences(), ...patch }),
    );
  } catch {
    return;
  }
  window.dispatchEvent(new Event(SHARED_PREFERENCES_CHANGED));
}
export function subscribeEditorPreferences(listener: () => void) {
  const stop = subscribeSharedPreferences(listener);
  window.addEventListener("storage", listener);
  return () => {
    stop();
    window.removeEventListener("storage", listener);
  };
}
export function useEditorPreferences() {
  return useSyncExternalStore(
    subscribeEditorPreferences,
    loadEditorPreferences,
    loadEditorPreferences,
  );
}
