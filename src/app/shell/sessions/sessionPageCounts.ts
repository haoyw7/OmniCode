import { createContext, useContext, useRef } from "react";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";

export type SessionPageCounts = ReadonlyMap<string, number>;

/** Chats sharing one workspace page, keyed by each chat; single-chat pages are absent. */
export function sessionPageCounts(tabs: readonly WorkspaceTab[]): SessionPageCounts {
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    const tools = new Set(
      [...tab.editorPanes, ...(tab.terminalPanes ?? [])].map((pane) => pane.id),
    );
    const chats = leafIds(tab.layout).filter((id) => !tools.has(id));
    if (chats.length < 2) continue;
    for (const id of chats) counts.set(id, chats.length);
  }
  return counts;
}

/** Keeps the previous map while its counts are unchanged, so rows do not re-render. */
export function useSessionPageCounts(tabs: readonly WorkspaceTab[]): SessionPageCounts {
  const previous = useRef<SessionPageCounts>(new Map());
  const next = sessionPageCounts(tabs);
  const same =
    next.size === previous.current.size &&
    [...next].every(([id, count]) => previous.current.get(id) === count);
  if (!same) previous.current = next;
  return previous.current;
}

export const SessionPageCountsContext = createContext<SessionPageCounts>(new Map());

export function useSessionPageCount(sessionId: string): number | undefined {
  return useContext(SessionPageCountsContext).get(sessionId);
}
