import { useMemo } from "react";
import { useStore } from "zustand";
import {
  preferenceStorage,
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
const key = "omnicode.editorPreferences";
function decode(raw: string | null): EditorPreferences {
  let value: Partial<EditorPreferences> = {};
  try {
    value = JSON.parse(raw ?? "{}") ?? {};
  } catch {
    /* Use defaults. */
  }
  const result = { ...defaults };
  for (const name of [
    "previewTabs",
    "wordWrap",
    "indentGuides",
    "showWhitespace",
    "scrollPastEnd",
  ] as const) {
    if (typeof value[name] === "boolean") result[name] = value[name];
  }
  if ([2, 4, 8].includes(value.tabSize ?? 0)) result.tabSize = value.tabSize!;
  return result;
}
export function loadEditorPreferences(): EditorPreferences {
  try { return decode(preferenceStorage.getItem(key)); } catch { return defaults; }
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
  return preferenceStorage.subscribe([key], listener);
}
export function useEditorPreferences() {
  const raw = useStore(preferenceStorage.store(key), state => state.value);
  return useMemo(() => decode(raw), [raw]);
}
