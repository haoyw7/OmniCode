import { useSyncExternalStore } from "react";

export type HapticPreferences = {
  interactions: boolean;
  output: boolean;
  strength: "gentle" | "standard";
};
const KEY = "monocode.mobile.haptics";
const EVENT = "monocode:haptics-change";
const defaults: HapticPreferences = { interactions: true, output: true, strength: "gentle" };
let cachedRaw: string | null | undefined;
let cached = defaults;

/** Motor preferences belong to this device, not the shared Host workspace. */
export function loadHapticPreferences(): HapticPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      const value = raw ? JSON.parse(raw) : {};
      cached = {
        interactions: typeof value?.interactions === "boolean" ? value.interactions : true,
        output: typeof value?.output === "boolean" ? value.output : true,
        strength: value?.strength === "standard" ? "standard" : "gentle",
      };
    }
  } catch { /* Keep working if device storage is unavailable. */ }
  return cached;
}

export function saveHapticPreferences(value: HapticPreferences) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* optional */ }
  cached = value;
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeHapticPreferences(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}
export function useHapticPreferences() {
  return useSyncExternalStore(subscribeHapticPreferences, loadHapticPreferences, () => defaults);
}
