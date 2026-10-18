import { mergeOrderedSubset } from "../../../shared/lib/reorder";
import { preferenceStorage } from "./sharedPreferences";

const KEY = "monocode.sidebarSectionOrder.v1";
const CHANGED = "monocode:sidebar-section-order-changed";
export const DEFAULT_SIDEBAR_SECTION_ORDER = [
  "pinned",
  "chats",
  "workflows",
  "groups",
  "projects",
  "remote-control",
] as const;
export type SidebarOrderedSectionId =
  (typeof DEFAULT_SIDEBAR_SECTION_ORDER)[number];

export function loadSidebarSectionOrder(): SidebarOrderedSectionId[] {
  try {
    const value: unknown = JSON.parse(preferenceStorage.getItem(KEY) ?? "[]");
    const saved = Array.isArray(value)
      ? value.filter((id): id is SidebarOrderedSectionId =>
          DEFAULT_SIDEBAR_SECTION_ORDER.includes(id),
        )
      : [];
    return [...new Set([...saved, ...DEFAULT_SIDEBAR_SECTION_ORDER])];
  } catch {
    return [...DEFAULT_SIDEBAR_SECTION_ORDER];
  }
}

/** Keep hidden sections in their slots when the visible subset is reordered. */
export function reorderSidebarSections(
  order: SidebarOrderedSectionId[],
  visible: SidebarOrderedSectionId[],
): SidebarOrderedSectionId[] {
  return mergeOrderedSubset(
    order.map((id) => ({ id })),
    visible.map((id) => ({ id })),
  ).map(({ id }) => id);
}

export function saveSidebarSectionOrder(
  order: SidebarOrderedSectionId[],
): void {
  try {
    preferenceStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // Keep the current view sortable when storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function subscribeSidebarSectionOrder(onChange: () => void): () => void {
  let previous = JSON.stringify(loadSidebarSectionOrder());
  const notify = () => {
    const next = JSON.stringify(loadSidebarSectionOrder());
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
