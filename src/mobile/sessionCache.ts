import {
  REMOTE_PROVIDERS,
  type HostSessionSummary,
} from "../features/connections/model/protocol";
import { sortMobileSessions } from "./sessionList";
import { sessionRecencyAt } from "../features/sessions/model/sessionActivity";

// One envelope keeps storage bounded even after pairing with several Hosts.
// Conversation contents and credentials never enter this cache.
export const SESSION_CACHE_KEY = "monocode-mobile-summaries";
export const SESSION_CACHE_PROJECT_LIMIT = 64;
export const SESSION_CACHE_SESSION_LIMIT = 100;
export const SESSION_CACHE_SIZE_LIMIT = 256 * 1024;

function summary(value: unknown, projectId: string): HostSessionSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<HostSessionSummary>;
  if (
    typeof item.id !== "string" || !item.id ||
    item.projectId !== projectId || typeof item.title !== "string" ||
    !REMOTE_PROVIDERS.includes(item.harness!) ||
    !["idle", "running", "interrupted"].includes(item.status!) ||
    !Number.isSafeInteger(item.revision) || item.revision! < 0 ||
    typeof item.updatedAt !== "number" || !Number.isFinite(new Date(item.updatedAt).getTime()) ||
    (item.pinned !== undefined && typeof item.pinned !== "boolean") ||
    (item.archived !== undefined && typeof item.archived !== "boolean") ||
    (item.activityAt !== undefined && item.activityAt !== null &&
      (typeof item.activityAt !== "number" || !Number.isFinite(item.activityAt))) ||
    (item.lastUserMessageAt !== undefined && item.lastUserMessageAt !== null &&
      (typeof item.lastUserMessageAt !== "number" || !Number.isFinite(item.lastUserMessageAt)))
  ) return undefined;
  return {
    id: item.id, projectId, title: item.title, harness: item.harness!,
    status: item.status!, revision: item.revision!, updatedAt: item.updatedAt,
    ...(item.pinned !== undefined ? { pinned: item.pinned } : {}),
    ...(item.archived !== undefined ? { archived: item.archived } : {}),
    ...(item.lastUserMessageAt !== undefined ? { lastUserMessageAt: item.lastUserMessageAt } : {}),
    ...(item.activityAt !== undefined ? { activityAt: item.activityAt } : {}),
  };
}

export function readSessionCache(environmentId: string): Map<string, HostSessionSummary[]> {
  const histories = new Map<string, HostSessionSummary[]>();
  try {
    const serialized = localStorage.getItem(SESSION_CACHE_KEY);
    if (!serialized || serialized.length > SESSION_CACHE_SIZE_LIMIT) return histories;
    const value = JSON.parse(serialized);
    if (value?.environmentId !== environmentId || !Array.isArray(value.projects)) return histories;
    for (const entry of value.projects.slice(0, SESSION_CACHE_PROJECT_LIMIT)) {
      if (!entry || typeof entry.projectId !== "string" || !Array.isArray(entry.sessions) ||
        entry.sessions.length > SESSION_CACHE_SESSION_LIMIT) continue;
      const sessions = entry.sessions.map((item: unknown) => summary(item, entry.projectId));
      if (sessions.every((item: HostSessionSummary | undefined) => item !== undefined))
        histories.set(entry.projectId, sessions);
    }
  } catch {
    // Missing, corrupt or restricted storage only loses the initial list preview.
  }
  return histories;
}

export function saveSessionCache(environmentId: string, histories: ReadonlyMap<string, HostSessionSummary[]>) {
  try {
    const projects: { projectId: string; sessions: HostSessionSummary[] }[] = [];
    let size = JSON.stringify({ environmentId, projects }).length;
    // Most recently read projects get the storage budget first.
    for (const [projectId, sessions] of [...histories].reverse().slice(0, SESSION_CACHE_PROJECT_LIMIT)) {
      const recent = [...sessions].sort((a, b) => sessionRecencyAt(b) - sessionRecencyAt(a));
      // Preserve activity ordering even when more than 100 old conversations are pinned.
      const newest = recent.find((item) => !item.archived);
      const candidates = [...(newest ? [newest] : []), ...sortMobileSessions(sessions), ...recent];
      const seen = new Set<string>();
      const kept: HostSessionSummary[] = [];
      let entrySize = JSON.stringify({ projectId, sessions: [] }).length + 1;
      if (size + entrySize > SESSION_CACHE_SIZE_LIMIT) break;
      for (const candidate of candidates) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        const item = summary(candidate, projectId);
        if (!item) continue;
        const itemSize = JSON.stringify(item).length + 1;
        if (size + entrySize + itemSize > SESSION_CACHE_SIZE_LIMIT) break;
        kept.push(item);
        entrySize += itemSize;
        if (kept.length === SESSION_CACHE_SESSION_LIMIT) break;
      }
      // Do not misrepresent a project whose first summary did not fit as empty.
      if (sessions.length && !kept.length) continue;
      projects.push({ projectId, sessions: kept });
      size += entrySize;
    }
    // Restore insertion order so the client's LRU remains consistent after launch.
    projects.reverse();
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ environmentId, projects }));
  } catch {
    // Live summaries remain available when storage is full or disabled.
  }
}

export function removeSessionCache() {
  try { localStorage.removeItem(SESSION_CACHE_KEY); } catch { /* Storage can be disabled. */ }
}
