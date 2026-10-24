import { pathKey } from "../../shared/lib/paths";
import { isChatFolder } from "../../domain/chatFolderPath";
import { sessionRecencyAt } from "../../domain/sessionActivity";
import { loadSessionSidebarOrder, saveSessionSidebarOrder } from "../../features/sessions/model/sessionFolders";
import { loadSidebarChatOrder, saveSidebarChatOrder } from "./sidebarChatOrder";
import { loadSidebarPinnedOrder, saveSidebarPinnedOrder } from "./sidebarPinnedOrder";

export type SessionCompletionRow = {
  id: string;
  cwd: string;
  source?: string;
  updatedAt: number;
  activityAt?: number | null;
  running: boolean;
  needsInput?: boolean;
  completedRunId?: string | null;
  revision?: number;
  pinned?: boolean;
  archived?: boolean;
  orchestrationLeadId?: string;
  workflowParentId?: string;
  assistantOwnerId?: string | null;
};

function promote(
  order: string[],
  incoming: string[],
  finished: string[],
  save: (order: string[]) => void,
) {
  // With no manual order, the list already follows message activity.
  if (!order.length || !finished.length) return;
  const saved = new Set(order);
  const moved = new Set(finished);
  const all = [...incoming.filter((id) => !saved.has(id)), ...order];
  const next = [...finished, ...all.filter((id) => !moved.has(id))];
  if (next.length !== order.length || next.some((id, index) => id !== order[index])) save(next);
}

/** Observe all sidebar summaries, including folded and filtered projects. */
export class SessionCompletionOrder {
  private previous = new Map<string, SessionCompletionRow>();

  observe(rows: readonly SessionCompletionRow[]) {
    const next = new Map<string, SessionCompletionRow>();
    const finished: SessionCompletionRow[] = [];
    for (const row of rows) {
      if (row.archived || row.orchestrationLeadId || row.workflowParentId || row.assistantOwnerId) continue;
      const key = JSON.stringify([row.source ?? "local", pathKey(row.cwd), row.id]);
      const previous = this.previous.get(key);
      if (previous?.revision != null && row.revision != null && row.revision < previous.revision) {
        next.set(key, previous);
        continue;
      }
      next.set(key, { ...row });
      if (previous && (
        (row.completedRunId && row.completedRunId !== previous.completedRunId) ||
        (!row.running && !row.needsInput && (
          previous.running ||
          (row.activityAt != null && previous.activityAt != null && row.activityAt > previous.activityAt)
        ))
      )) finished.push(row);
    }
    this.previous = next;
    if (!finished.length) return;
    const byActivity = (a: SessionCompletionRow, b: SessionCompletionRow) =>
      sessionRecencyAt(b) - sessionRecencyAt(a) || a.id.localeCompare(b.id);
    finished.sort(byActivity);
    const current = [...next.values()].sort(byActivity);
    // pathKey is only a comparison identity. Preference keys and change events
    // retain the project's spelling, including Windows drive/directory case.
    const projects = new Map(finished.map((row) => [pathKey(row.cwd), row.cwd]));
    for (const [key, cwd] of projects) {
      promote(
        loadSessionSidebarOrder(cwd),
        current.filter((row) => pathKey(row.cwd) === key).map((row) => row.id),
        finished.filter((row) => pathKey(row.cwd) === key).map((row) => row.id),
        (order) => saveSessionSidebarOrder(cwd, order),
      );
    }
    const chatId = (row: SessionCompletionRow) => `chat:${pathKey(row.cwd)}:${row.id}`;
    const isChat = (row: SessionCompletionRow) => !row.pinned && (row.cwd === "~" || isChatFolder(row.cwd));
    promote(loadSidebarChatOrder(), current.filter(isChat).map(chatId), finished.filter(isChat).map(chatId), saveSidebarChatOrder);
    const pinId = (row: SessionCompletionRow) => `session:${JSON.stringify([pathKey(row.cwd), row.id])}`;
    promote(loadSidebarPinnedOrder(), current.filter((row) => row.pinned).map(pinId), finished.filter((row) => row.pinned).map(pinId), saveSidebarPinnedOrder);
  }
}
