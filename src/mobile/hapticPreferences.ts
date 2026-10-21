import { useMemo } from "react";
import { useStore } from "zustand";
import { devicePreferences } from "../shared/lib/persistedPreferences";

export type HapticPreferences = {
  interactions: boolean;
  output: boolean;
  strength: "gentle" | "standard";
};
const KEY = "omnicode.mobile.haptics";
const defaults: HapticPreferences = { interactions: true, output: true, strength: "gentle" };
function decode(raw: string | null): HapticPreferences {
  try {
    const value = raw ? JSON.parse(raw) : {};
    return {
      interactions: typeof value?.interactions === "boolean" ? value.interactions : true,
      output: typeof value?.output === "boolean" ? value.output : true,
      strength: value?.strength === "standard" ? "standard" : "gentle",
    };
  } catch { return defaults; }
}

/** Motor preferences belong to this device, not the shared Host workspace. */
export function loadHapticPreferences(): HapticPreferences {
  try {
    return decode(devicePreferences.getItem(KEY));
  } catch { /* Keep working if device storage is unavailable. */ }
  return defaults;
}

export function saveHapticPreferences(value: HapticPreferences) {
  try { devicePreferences.setItem(KEY, JSON.stringify(value), true); } catch { /* Keep this device usable. */ }
}

export function subscribeHapticPreferences(listener: () => void) {
  return devicePreferences.subscribe([KEY], listener);
}
export function useHapticPreferences() {
  const raw = useStore(devicePreferences.store(KEY), state => state.value);
  return useMemo(() => decode(raw), [raw]);
}
