import { queryClient } from "../../../shared/lib/queryClient";
import type { Session } from "../model/session";

/** Closed chats stay here so clicking a session card can paint without disk. */
export const SESSION_LOAD_CACHE_LIMIT = 12;
export const SESSION_LOAD_CACHE_MAX_BYTES = 32 * 1024 * 1024;

const estimatedBytes = new WeakMap<object, number>();

/** Conservative retained-size estimate without allocating a serialized copy. */
export function estimateSessionCacheBytes(session: Session): number {
  const known = estimatedBytes.get(session);
  if (known != null) return known;

  let bytes = 0;
  const seen = new WeakSet<object>();
  const pending: unknown[] = [session];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      bytes += value.length * 2;
      continue;
    }
    if (typeof value === "number") {
      bytes += 8;
      continue;
    }
    if (typeof value === "boolean") {
      bytes += 4;
      continue;
    }
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      bytes += 24 + value.length * 8;
      for (const item of value) pending.push(item);
      continue;
    }

    const values = Object.values(value);
    bytes += 32 + values.length * 8;
    for (const item of values) pending.push(item);
  }

  estimatedBytes.set(session, bytes);
  return bytes;
}

let retainedVisit = 0;
export function rememberLoadedSession(scope: readonly unknown[], session: Session, limit = SESSION_LOAD_CACHE_LIMIT, maxBytes = SESSION_LOAD_CACHE_MAX_BYTES) {
  const key = [...scope, session.id];
  queryClient.removeQueries({ queryKey: key, exact: true });
  if (limit <= 0 || estimateSessionCacheBytes(session) > maxBytes) return;
  queryClient.getQueryCache().build(queryClient, { queryKey: key, structuralSharing: false, meta: { visited: ++retainedVisit } });
  queryClient.setQueryData(key, session);
  const entries = queryClient.getQueryCache().findAll({ queryKey: scope })
    .filter(query => query.state.data)
    .sort((a, b) => Number(a.meta?.visited ?? 0) - Number(b.meta?.visited ?? 0));
  let bytes = entries.reduce((total, query) => total + estimateSessionCacheBytes(query.state.data as Session), 0), count = entries.length;
  for (const query of entries) {
    if (count <= limit && bytes <= maxBytes) break;
    bytes -= estimateSessionCacheBytes(query.state.data as Session); count--;
    queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
  }
}
