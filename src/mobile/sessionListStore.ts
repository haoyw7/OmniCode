import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { HostSessionSummary } from "../features/connections/model/protocol";

export interface MobileProjectHistory {
  sessions?: HostSessionSummary[];
  loading: boolean;
  failed: boolean;
  error?: unknown;
}
type LoadSessions = (projectId: string) => Promise<HostSessionSummary[]>;
type CachedSessions = (projectId: string) => HostSessionSummary[] | undefined;
interface Subscription { ids: readonly string[]; changed: () => void; fast: boolean; seen: Map<string, MobileProjectHistory | undefined> }
interface Entry { settledAt: number; generation: number; pending?: Promise<void> }

/** One scheduler per Host-scoped loader, shared by all visible list surfaces. */
export function createSessionListStore(load: LoadSessions) {
  let histories: Record<string, MobileProjectHistory> = {};
  const entries = new Map<string, Entry>();
  const subscriptions = new Set<Subscription>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let notification: ReturnType<typeof setTimeout> | undefined;
  const publish = (partial = false) => {
    if (partial) { clearTimeout(notification); notification = undefined; }
    let waiting = false;
    for (const item of subscriptions) {
      if (!item.ids.some((id) => item.seen.get(id) !== histories[id])) continue;
      // Fast project subscribers can paint immediately. A large surface groups
      // partial replies for at most one frame, even if another project hangs.
      if (!partial && item.ids.some((id) => entries.get(id)?.pending)) { waiting = true; continue; }
      item.seen = new Map(item.ids.map((id) => [id, histories[id]]));
      item.changed();
    }
    if (waiting && notification === undefined) notification = setTimeout(() => publish(true), 16);
    if (!waiting) { clearTimeout(notification); notification = undefined; }
  };
  const entryFor = (id: string) => {
    let entry = entries.get(id);
    if (!entry) { entry = { settledAt: -Infinity, generation: 0 }; entries.set(id, entry); }
    return entry;
  };
  const intervals = () => {
    const result = new Map<string, number>();
    for (const item of subscriptions) for (const id of item.ids) {
      const interval = item.fast && histories[id]?.sessions?.some((row) => row.status === "running") ? 750 : 3_000;
      result.set(id, Math.min(result.get(id) ?? Infinity, interval));
    }
    return result;
  };
  const remember = (id: string, next: MobileProjectHistory) => {
    const previous = histories[id];
    if (previous?.sessions === next.sessions && previous?.loading === next.loading &&
      previous?.failed === next.failed && previous?.error === next.error) return;
    histories = { ...histories, [id]: next };
  };
  const request = (id: string) => {
    const entry = entryFor(id);
    if (entry.pending) return entry.pending;
    let generation = entry.generation;
    entry.pending = Promise.resolve().then(() => {
      generation = entry.generation;
      return load(id);
    }).then((sessions) => {
      if (generation === entry.generation) remember(id, { sessions, loading: false, failed: false });
    }, (error: unknown) => {
      if (generation === entry.generation)
        remember(id, { sessions: histories[id]?.sessions, loading: false, failed: true, error });
    }).finally(() => {
      entry.settledAt = generation === entry.generation ? Date.now() : -Infinity;
      entry.pending = undefined;
      publish();
      schedule();
    });
    return entry.pending;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!subscriptions.size) return;
    const active = intervals();
    let delay = Infinity;
    for (const [id, interval] of active) {
      const entry = entryFor(id);
      if (entry.pending) continue;
      const remaining = entry.settledAt + interval - Date.now();
      if (remaining <= 0) void request(id);
      else delay = Math.min(delay, remaining);
    }
    if (Number.isFinite(delay)) timer = setTimeout(schedule, delay);
  };
  return {
    getSnapshot: () => histories,
    seed(ids: readonly string[], cached?: CachedSessions, overwrite = false) {
      const before = histories;
      for (const id of ids) {
        const sessions = cached?.(id);
        if (sessions && (overwrite || !histories[id]?.sessions) && sessions !== histories[id]?.sessions)
          remember(id, { sessions, loading: false, failed: histories[id]?.failed ?? false, error: histories[id]?.error });
      }
      if (histories !== before) publish();
    },
    subscribe(ids: readonly string[], changed: () => void, fast = false) {
      const subscription: Subscription = { ids, changed, fast, seen: new Map(ids.map((id) => [id, histories[id]])) };
      subscriptions.add(subscription);
      schedule();
      return () => {
        subscriptions.delete(subscription);
        if (!subscriptions.size) { clearTimeout(notification); notification = undefined; }
        schedule();
      };
    },
    refresh(ids: readonly string[]) {
      for (const id of ids) {
        const entry = entryFor(id);
        entry.settledAt = -Infinity;
        entry.generation += 1;
        if (!histories[id]?.sessions) remember(id, { loading: true, failed: false });
      }
      publish();
      schedule();
    },
  };
}
export type SessionListStore = ReturnType<typeof createSessionListStore>;
const stores = new WeakMap<LoadSessions, SessionListStore>();
export function sessionListStore(load: LoadSessions) {
  let store = stores.get(load);
  if (!store) { store = createSessionListStore(load); stores.set(load, store); }
  return store;
}

export function useMobileSessionLists({ idsKey, enabled, visible = enabled, loadSessions, cachedSessions, refreshKey = 0 }: {
  idsKey: string;
  enabled: boolean;
  visible?: boolean;
  loadSessions: LoadSessions;
  cachedSessions?: CachedSessions;
  refreshKey?: number;
}) {
  const ids = useMemo<readonly string[]>(() => JSON.parse(idsKey), [idsKey]);
  const store = useMemo(() => sessionListStore(loadSessions), [loadSessions]);
  const subscribe = useCallback((changed: () => void) => enabled ? store.subscribe(ids, changed) : () => {}, [store, ids, enabled]);
  const histories = useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
  const previousSeed = useRef({ store, enabled, visible, refreshKey });
  useLayoutEffect(() => {
    const previous = previousSeed.current;
    store.seed(ids, cachedSessions, previous.store === store &&
      ((!previous.enabled && enabled) || (!previous.visible && visible) || previous.refreshKey !== refreshKey));
    previousSeed.current = { store, enabled, visible, refreshKey };
  }, [store, ids, enabled, visible, cachedSessions, refreshKey]);
  const previousRefresh = useRef({ store, refreshKey });
  useEffect(() => {
    if (previousRefresh.current.store === store && previousRefresh.current.refreshKey !== refreshKey) store.refresh(ids);
    previousRefresh.current = { store, refreshKey };
  }, [store, ids, refreshKey]);
  const refresh = useCallback((projectIds: readonly string[] = ids) => store.refresh(projectIds), [store, ids]);
  return { histories, refresh };
}
