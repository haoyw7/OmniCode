import { useMemo } from "react";
import { useStore } from "zustand";
import { devicePreferences } from "../shared/lib/persistedPreferences";

export const notificationDefaults = {
  replies: true,
  input: true,
  botReplies: true,
  botInput: true,
  preview: true,
};
export type MobileNotificationPreferences = typeof notificationDefaults;
export type MobileNotificationCategory = Exclude<keyof MobileNotificationPreferences, "preview">;
const KEY = "omnicode.mobile.notificationPreferences";
const ENABLED_KEY = "omnicode.mobileNotifications";

function decode(raw: string | null): MobileNotificationPreferences {
  const next = { ...notificationDefaults };
  try {
    const value = raw ? JSON.parse(raw) : null;
    for (const key of Object.keys(next) as (keyof MobileNotificationPreferences)[])
      if (typeof value?.[key] === "boolean") next[key] = value[key];
  } catch { /* Older or damaged preferences retain notification delivery. */ }
  return next;
}

export function saveMobileNotificationPreferences(value: MobileNotificationPreferences) {
  try { devicePreferences.setItem(KEY, JSON.stringify(value), true); } catch { /* Retain the runtime preference. */ }
}

export function saveMobileNotificationsEnabled(enabled: boolean) {
  try { devicePreferences.setItem(ENABLED_KEY, enabled ? "1" : "0", true); } catch { /* Retain the runtime preference. */ }
}

export function useMobileNotificationPreferences() {
  const raw = useStore(devicePreferences.store(KEY), state => state.value);
  const enabled = useStore(devicePreferences.store(ENABLED_KEY), state => state.value !== "0");
  const preferences = useMemo(() => decode(raw), [raw]);
  return { enabled, preferences };
}
