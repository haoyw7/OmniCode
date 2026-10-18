import { useSyncExternalStore } from "react";
import {
  preferenceStorage,
  subscribeSharedPreferences,
} from "../../settings/model/sharedPreferences";

export const STATUS_CARD_IDS = [
  "environment",
  "changes",
  "tasks",
  "plans",
  "subagents",
  "background",
  "context",
] as const;

export type StatusCardId = (typeof STATUS_CARD_IDS)[number];

const KEY = "monocode.statusCardOrder";

const isStatusCardId = (value: unknown): value is StatusCardId =>
  STATUS_CARD_IDS.includes(value as StatusCardId);

/** The saved card order, with cards added since it was saved appended. */
export function loadStatusCardOrder(): StatusCardId[] {
  try {
    const raw = preferenceStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [...STATUS_CARD_IDS];
    const order = [...new Set(parsed.filter(isStatusCardId))];
    for (const id of STATUS_CARD_IDS) if (!order.includes(id)) order.push(id);
    return order;
  } catch {
    return [...STATUS_CARD_IDS];
  }
}

export function saveStatusCardOrder(order: readonly StatusCardId[]) {
  try {
    preferenceStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // private mode / quota
  }
}

const VISIBLE_KEY = "monocode.statusCardsVisible";
const visibilityListeners = new Set<() => void>();

/** Whether the session status cards show beside the conversation; on by default. */
export function loadStatusCardsVisible(): boolean {
  try {
    return preferenceStorage.getItem(VISIBLE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveStatusCardsVisible(visible: boolean) {
  try {
    preferenceStorage.setItem(VISIBLE_KEY, String(visible));
  } catch {
    // private mode / quota
  }
  for (const listener of visibilityListeners) listener();
}

export function subscribeStatusCardsVisible(listener: () => void) {
  visibilityListeners.add(listener);
  const unsubscribeShared = subscribeSharedPreferences(listener);
  return () => {
    visibilityListeners.delete(listener);
    unsubscribeShared();
  };
}

export function useStatusCardsVisible(): boolean {
  return useSyncExternalStore(subscribeStatusCardsVisible, loadStatusCardsVisible, () => true);
}
