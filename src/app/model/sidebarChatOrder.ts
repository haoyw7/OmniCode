import { mergeOrderedSubset, orderByIds } from "../../shared/lib/reorder";

// Device-local: chat ids embed this machine's folder paths.
const KEY = "omnicode.sidebarChatOrder.v1";
const CHANGED = "omnicode:sidebar-chat-order-changed";
// Deleted chats leave their ids behind; keep the list bounded.
const LIMIT = 1000;

/** Chats without a saved slot are new and lead, in their incoming (recency) order. */
export function orderSidebarChats<T extends { id: string }>(
  items: T[],
  order: string[],
): T[] {
  const saved = new Set(order);
  return [
    ...items.filter((item) => !saved.has(item.id)),
    ...orderByIds(
      items.filter((item) => saved.has(item.id)),
      order,
    ),
  ];
}

/**
 * Save every listed chat, not just the visible slice, so rows beyond the
 * preview keep their slots instead of returning as "new". Filtered or
 * not-yet-loaded chats keep their saved slots.
 */
export function reorderSidebarChats(
  order: string[],
  listed: string[],
  visible: string[],
): string[] {
  const saved = new Set(order);
  const all = [...listed.filter((id) => !saved.has(id)), ...order];
  return mergeOrderedSubset(
    all.map((id) => ({ id })),
    visible.map((id) => ({ id })),
  )
    .map(({ id }) => id)
    .slice(0, LIMIT);
}

export function loadSidebarChatOrder(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string"))]
      : [];
  } catch {
    return [];
  }
}

export function saveSidebarChatOrder(order: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // The current view still supports sorting when storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function subscribeSidebarChatOrder(onChange: () => void): () => void {
  const stored = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", stored);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", stored);
  };
}
