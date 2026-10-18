import { preferenceStorage } from "../../features/settings/model/sharedPreferences";
import chinese from "./zh-CN.json";

export type UiLanguage = "en" | "zh-CN";
export type TranslationValues = Record<string, string | number>;

export const UI_LANGUAGE_KEY = "omnicode.uiLanguage";
const translations: Readonly<Record<string, string>> = chinese;
const listeners = new Set<() => void>();
let language: UiLanguage | null = null;

export function resolveUiLanguage(value: unknown): UiLanguage {
  return typeof value === "string" && /^zh(?:[-_]|$)/i.test(value)
    ? "zh-CN"
    : "en";
}

export function loadUiLanguage(): UiLanguage {
  try {
    const saved = preferenceStorage.getItem(UI_LANGUAGE_KEY);
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    // Storage can be unavailable in private windows.
  }
  return resolveUiLanguage(
    typeof navigator === "undefined" ? "en" : navigator.language,
  );
}

export function getUiLanguage(): UiLanguage {
  return (language ??= loadUiLanguage());
}

function applyLanguage(next: UiLanguage) {
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (language === next) return;
  language = next;
  for (const listener of listeners) listener();
}

export function setUiLanguage(next: UiLanguage) {
  if (next !== "en" && next !== "zh-CN") return;
  try {
    preferenceStorage.setItem(UI_LANGUAGE_KEY, next);
  } catch {
    // Keep the selection usable for this window even when saving fails.
  }
  applyLanguage(next);
}

export function refreshUiLanguage() {
  applyLanguage(loadUiLanguage());
}

function onStorage(event: StorageEvent) {
  if (event.key === UI_LANGUAGE_KEY || event.key === null) refreshUiLanguage();
}

export function subscribeUiLanguage(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/** Only application-owned UI strings are translated; unknown text passes through. */
const resourceConflictMessages = new Set([
  "This working copy is being changed or removed. Retry accepting the result when the operation finishes.",
  "Close files and terminals using this worker checkout before cleanup. Its worktree was kept.",
  "Close files and terminals using this working copy before cleanup; it may currently be being removed.",
  "This working copy is receiving an accepted result or an active write. Retry when the operation finishes.",
]);

export function translate(
  text: string,
  values?: TranslationValues,
  locale: UiLanguage = getUiLanguage(),
): string {
  // Only these application-owned error headers are translated; occupant IDs,
  // process IDs and paths on following lines remain literal diagnostic data.
  const newline = text.indexOf("\n");
  if (newline > 0 && resourceConflictMessages.has(text.slice(0, newline)))
    return translate(text.slice(0, newline), values, locale) + text.slice(newline);
  const template =
    locale === "zh-CN" &&
    Object.prototype.hasOwnProperty.call(translations, text)
      ? translations[text]
      : text;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (marker, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : marker,
  );
}
