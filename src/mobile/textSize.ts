import { useStore } from "zustand";
import { devicePreferences } from "../shared/lib/persistedPreferences";
import {
  FONT_SIZE_LIMITS,
  loadFontSize,
  type FontSizeKind,
} from "../features/settings/model/typography";

const KEY = "omnicode.mobile.textSize";
export const MOBILE_TEXT_SIZE = {
  min: 80,
  max: 150,
  step: 5,
  default: 100,
} as const;

export function normalizeMobileTextSize(value: unknown): number {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : NaN;
  if (value === "" || !Number.isFinite(parsed)) return MOBILE_TEXT_SIZE.default;
  return Math.min(
    MOBILE_TEXT_SIZE.max,
    Math.max(
      MOBILE_TEXT_SIZE.min,
      Math.round(parsed / MOBILE_TEXT_SIZE.step) * MOBILE_TEXT_SIZE.step,
    ),
  );
}

export function loadMobileTextSize() {
  try {
    return normalizeMobileTextSize(devicePreferences.getItem(KEY));
  } catch {
    return MOBILE_TEXT_SIZE.default;
  }
}

/** Scale this device's UI, prose and code while preserving the shared font choices. */
export function applyMobileTextSize() {
  const scale = loadMobileTextSize() / 100;
  for (const kind of ["ui", "content", "code"] as FontSizeKind[]) {
    const baseScale = loadFontSize(kind) / FONT_SIZE_LIMITS[kind].base;
    document.documentElement.style.setProperty(
      `--${kind}-font-scale`,
      String(Number((baseScale * scale).toFixed(4))),
    );
  }
}

export function saveMobileTextSize(value: number) {
  try {
    devicePreferences.setItem(
      KEY,
      String(normalizeMobileTextSize(value)),
      true,
    );
  } catch {
    /* Retain the in-memory preference when device storage is unavailable. */
  }
  applyMobileTextSize();
}

export function subscribeMobileTextSize(listener: () => void) {
  return devicePreferences.subscribe([KEY], listener);
}

export function useMobileTextSize() {
  return useStore(devicePreferences.store(KEY), (state) =>
    normalizeMobileTextSize(state.value),
  );
}
