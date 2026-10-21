import { useMemo } from "react";
import { useStore } from "zustand";
import { devicePreferences } from "../shared/lib/persistedPreferences";

export const CONNECTION_ICONS = [
  "code",
  "terminal",
  "laptop",
  "desktop",
] as const;
export type ConnectionIcon = (typeof CONNECTION_ICONS)[number];
export type ConnectionAppearance = {
  displayName: string;
  icon: ConnectionIcon;
};
const key = (id: string) => `omnicode.mobile.connectionAppearance:${id}`;

/** Device-local presentation only; never contains credentials or changes the Host. */
export function useConnectionAppearance(
  id: string | undefined,
): ConnectionAppearance {
  const raw = useStore(devicePreferences.store(key(id ?? "")), state => id ? state.value : null);
  return useMemo(() => {
    try {
      const value = JSON.parse(raw || "null");
      return {
        displayName:
          typeof value?.displayName === "string" ? value.displayName : "",
        icon: CONNECTION_ICONS.includes(value?.icon) ? value.icon : "laptop",
      };
    } catch {
      return { displayName: "", icon: "laptop" };
    }
  }, [raw]);
}

/** The saved display name outside React, for lists that label many devices. */
export function connectionDisplayName(id: string): string {
  try {
    const value = JSON.parse(devicePreferences.getItem(key(id)) || "null");
    return typeof value?.displayName === "string" ? value.displayName : "";
  } catch {
    return "";
  }
}

export function saveConnectionAppearance(
  id: string,
  value: ConnectionAppearance,
) {
  devicePreferences.setItem(
    key(id),
    JSON.stringify({
      displayName: value.displayName.trim(),
      icon: value.icon,
    }),
  );
}

export function removeConnectionAppearance(id: string) {
  devicePreferences.removeItem(key(id));
}

/** Moves presentation saved under an earlier key (the Host identity) to its connection address. */
export function moveConnectionAppearance(from: string, to: string) {
  try {
    const value = devicePreferences.getItem(key(from));
    if (value === null) return;
    if (devicePreferences.getItem(key(to)) === null) devicePreferences.setItem(key(to), value);
    devicePreferences.removeItem(key(from));
  } catch {
    return;
  }
}
