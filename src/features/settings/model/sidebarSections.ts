import { preferenceStorage } from "./sharedPreferences";
const KEY = "monocode.sidebarSectionsCollapsed.v1";
const CHANGED = "monocode:sidebar-sections-collapsed-changed";
const SECTIONS = ["pinned", "recent", "workflows", "groups", "projects", "remote-control"] as const;

export type SidebarSectionId = (typeof SECTIONS)[number];

function isSection(value: unknown): value is SidebarSectionId {
  return SECTIONS.includes(value as SidebarSectionId);
}

/** All sections start expanded; store only explicit folds by stable section id. */
export function loadSidebarSectionsCollapsed(): ReadonlySet<SidebarSectionId> {
  try {
    const parsed: unknown = JSON.parse(preferenceStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter(isSection) : []);
  } catch {
    return new Set();
  }
}

export function saveSidebarSectionsCollapsed(
  sections: Iterable<SidebarSectionId>,
): void {
  try {
    preferenceStorage.setItem(KEY, JSON.stringify([...new Set(sections)]));
  } catch {
    // Keep the current view usable when storage is unavailable.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

export function subscribeSidebarSectionsCollapsed(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let previous = [...loadSidebarSectionsCollapsed()].sort().join("\0");
  const notify = () => {
    const next = [...loadSidebarSectionsCollapsed()].sort().join("\0");
    if (next === previous) return;
    previous = next;
    onChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) notify();
  };
  window.addEventListener(CHANGED, notify);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, notify);
    window.removeEventListener("storage", onStorage);
  };
}
