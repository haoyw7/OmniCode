import { useMemo, useSyncExternalStore } from "react";

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
const EVENT = "monocode-connection-appearance";
const key = (id: string) => `monocode.mobile.connectionAppearance:${id}`;

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** Device-local presentation only; never contains credentials or changes the Host. */
export function useConnectionAppearance(
  id: string | undefined,
): ConnectionAppearance {
  const raw = useSyncExternalStore(subscribe, () => {
    try {
      return id ? localStorage.getItem(key(id)) : null;
    } catch {
      return null;
    }
  });
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
    const value = JSON.parse(localStorage.getItem(key(id)) || "null");
    return typeof value?.displayName === "string" ? value.displayName : "";
  } catch {
    return "";
  }
}

export function saveConnectionAppearance(
  id: string,
  value: ConnectionAppearance,
) {
  localStorage.setItem(
    key(id),
    JSON.stringify({
      displayName: value.displayName.trim(),
      icon: value.icon,
    }),
  );
  window.dispatchEvent(new Event(EVENT));
}

export function removeConnectionAppearance(id: string) {
  localStorage.removeItem(key(id));
  window.dispatchEvent(new Event(EVENT));
}

/** Moves presentation saved under an earlier key (the Host identity) to its connection address. */
export function moveConnectionAppearance(from: string, to: string) {
  try {
    const value = localStorage.getItem(key(from));
    if (value === null) return;
    if (localStorage.getItem(key(to)) === null) localStorage.setItem(key(to), value);
    localStorage.removeItem(key(from));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}
