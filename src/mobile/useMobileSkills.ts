import { useCallback, useEffect, useRef, useState } from "react";
import type { HostSkillCatalog } from "../features/connections/model/protocol";

export type MobileSkillsLoader = (
  refresh?: boolean,
) => Promise<HostSkillCatalog>;
type State = {
  key: string;
  catalog?: HostSkillCatalog;
  loading: boolean;
  error?: string;
  failed?: boolean;
};

type CacheEntry = {
  catalog?: HostSkillCatalog;
  loadedAt: number;
  pending?: Promise<HostSkillCatalog>;
};
// Context keys include the Host, project, provider, session and working directory.
// Retain recent lists across composer remounts without mixing their contexts.
const catalogs = new Map<string, CacheEntry>();
const MAX_CATALOGS = 32;
const FILE_TTL_MS = 5 * 60_000;
const NATIVE_TTL_MS = 30_000;

function fresh(entry: CacheEntry | undefined, native: boolean) {
  return !!entry?.catalog &&
    Date.now() - entry.loadedAt < (native ? NATIVE_TTL_MS : FILE_TTL_MS);
}

function loadCatalog(key: string, load: MobileSkillsLoader, native: boolean, refresh: boolean) {
  let entry = catalogs.get(key);
  if (!entry) entry = { loadedAt: 0 };
  catalogs.delete(key);
  catalogs.set(key, entry);
  if (catalogs.size > MAX_CATALOGS)
    catalogs.delete(catalogs.keys().next().value!);
  if (entry.pending) return entry.pending;
  if (!refresh && fresh(entry, native)) return Promise.resolve(entry.catalog!);
  const owned = entry;
  const pending = Promise.resolve().then(() => load(refresh || !native))
    .then(catalog => {
      owned.catalog = catalog;
      owned.loadedAt = Date.now();
      return catalog;
    }).finally(() => {
      if (owned.pending === pending) owned.pending = undefined;
    });
  owned.pending = pending;
  return pending;
}

/** A context switch hides stale results immediately, before the next request. */
export function useMobileSkills(
  key: string,
  load: MobileSkillsLoader | undefined,
  open: boolean,
  native: boolean,
) {
  const [state, setState] = useState<State>(() => ({
    key, catalog: catalogs.get(key)?.catalog, loading: false,
  }));
  const current = useRef({ key, generation: 0 });
  if (current.current.key !== key)
    current.current = { key, generation: current.current.generation + 1 };
  const reload = useCallback(
    async (refresh = false) => {
      if (!load) return;
      const owner = current.current;
      const generation = ++owner.generation;
      setState((previous) => ({
        key,
        catalog: catalogs.get(key)?.catalog ?? (previous.key === key ? previous.catalog : undefined),
        loading: !fresh(catalogs.get(key), native),
      }));
      try {
        const catalog = await loadCatalog(key, load, native, refresh);
        if (current.current !== owner || generation !== owner.generation)
          return;
        setState({ key, catalog, loading: false });
      } catch (reason) {
        if (current.current !== owner || generation !== owner.generation)
          return;
        setState((previous) => ({
          key,
          catalog: previous.key === key ? previous.catalog : undefined,
          loading: false,
          failed: true,
          error: reason instanceof Error ? reason.message : undefined,
        }));
      }
    },
    [key, load, native],
  );
  useEffect(() => {
    if (open) void reload();
  }, [open, key, reload]);
  useEffect(
    () => () => {
      current.current.generation++;
    },
    [],
  );
  const visible: State = state.key === key ? state : { key, loading: open };
  const catalog = catalogs.get(key)?.catalog ?? visible.catalog;
  // Background refreshes keep the cached rows and never insert a loading row.
  return { ...visible, catalog, loading: visible.loading && !catalog, reload };
}
