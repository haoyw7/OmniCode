import { PROJECT_LIST_PREFERENCES, PROJECT_MAP_PREFERENCES } from "./sharedPreferenceSchema";
import { SHARED_PREFERENCES_CHANGED, SHARED_PREFERENCES_STATUS, type PreferenceCodec, type SharedPreferenceStore } from "./sharedPreferences";
import { encodeProjectPreferenceListPath, parseProjectPreferenceIdentity } from "./projectPreferenceCodec";
import { REMOTE_PROJECTS_CHANGED, parseRemotePath, remoteProjectFor, sharedProjects } from "../../connections/model/remoteProjects";
import { pathKey } from "../../../shared/lib/paths";

type Stores = { primary: SharedPreferenceStore; hosts: ReadonlyMap<string, SharedPreferenceStore> };
let current: Stores | undefined;
let unsubscribe: (() => void) | undefined;
const pendingKey = (hostId: string, key: string) => `omnicode.pending-project-preferences.v1:${encodeURIComponent(hostId)}:${key}`;
const pendingListKey = (hostId: string, key: string) => `omnicode.pending-project-lists.v1:${encodeURIComponent(hostId)}:${key}`;
const object = (raw: string | null): Record<string, unknown> => {
  const value: unknown = JSON.parse(raw ?? "{}");
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};
function staged(key: string): Record<string, unknown> {
  if (!current) return {};
  try { return object(localStorage.getItem(pendingKey(current.primary.hostId, key))); } catch { return {}; }
}
function saveStaged(key: string, values: Record<string, unknown>): void {
  if (!current) return;
  const target = pendingKey(current.primary.hostId, key);
  if (Object.keys(values).length) localStorage.setItem(target, JSON.stringify(values));
  else localStorage.removeItem(target);
  window.dispatchEvent(new Event(SHARED_PREFERENCES_STATUS));
}
function owner(path: string): string | undefined {
  if (!current) return;
  const identity = parseProjectPreferenceIdentity(path);
  if (identity) return identity.environmentId;
  const project = remoteProjectFor(path);
  if (project?.projectId) return project.environmentId;
  const shared = sharedProjects().find((entry) => pathKey(entry.cwd) === pathKey(path));
  if (shared) return shared.environmentId;
  // Global sentinels (for example the unsaved conversation's "~" choice).
  if (!/^(\/|[A-Za-z]:[\\/]|\\\\|remote:\/\/)/.test(path)) return current.primary.hostId;
}

/** Per-Host stores must each own their own codec instance and offline journal. */
export function configureProjectPreferenceStores(
  primary: SharedPreferenceStore | undefined,
  stores: ReadonlyMap<string, SharedPreferenceStore> = new Map(),
  _codec?: PreferenceCodec,
): void {
  unsubscribe?.();
  unsubscribe = undefined;
  current = primary ? { primary, hosts: new Map([...stores, [primary.hostId, primary]]) } : undefined;
  if (!current) return;
  const flush = () => flushProjectPreferenceStaging();
  window.addEventListener(REMOTE_PROJECTS_CHANGED, flush);
  unsubscribe = () => window.removeEventListener(REMOTE_PROJECTS_CHANGED, flush);
  flush();
}

export function routeGet(key: string): string | null | undefined {
  if (current && PROJECT_LIST_PREFERENCES.has(key))
    return localStorage.getItem(pendingListKey(current.primary.hostId, key)) ?? undefined;
  if (!current || !PROJECT_MAP_PREFERENCES.has(key)) return undefined;
  let found = false;
  const merged: Record<string, unknown> = {};
  for (const store of current.hosts.values()) {
    const raw = store.getItem(key);
    if (raw !== null) found = true;
    for (const [path, value] of Object.entries(object(raw))) {
      if (owner(path) === store.hostId) merged[path] = value;
    }
  }
  const pending = staged(key);
  return found || Object.keys(pending).length ? JSON.stringify({ ...merged, ...pending }) : null;
}

export function routeSet(key: string, raw: string | null): boolean {
  if (current && PROJECT_LIST_PREFERENCES.has(key)) {
    const values: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(values)) throw new Error("Invalid project list preference");
    let unresolved = false;
    for (const value of values) {
      const path = typeof value === "string" ? value : typeof value?.path === "string" ? value.path : undefined;
      if (path) try { encodeProjectPreferenceListPath(key, path); } catch { unresolved = true; }
    }
    const target = pendingListKey(current.primary.hostId, key);
    if (unresolved) localStorage.setItem(target, JSON.stringify(values));
    else {
      current.primary.setItem(key, raw);
      localStorage.removeItem(target);
    }
    window.dispatchEvent(new Event(SHARED_PREFERENCES_STATUS));
    window.dispatchEvent(new CustomEvent(SHARED_PREFERENCES_CHANGED, { detail: [key] }));
    return true;
  }
  if (!current || !PROJECT_MAP_PREFERENCES.has(key)) return false;
  const values = object(raw);
  const split = new Map<string, Record<string, unknown>>();
  const pending: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(values)) {
    const environmentId = owner(path);
    if (!environmentId || !current.hosts.has(environmentId)) { pending[path] = value; continue; }
    const partition = split.get(environmentId) ?? {};
    partition[path] = value;
    split.set(environmentId, partition);
  }
  // Keep edits to unregistered/offline projects durable before acknowledging them.
  saveStaged(key, pending);
  for (const [environmentId, store] of current.hosts) {
    store.setItem(key, JSON.stringify(split.get(environmentId) ?? {}));
  }
  window.dispatchEvent(new CustomEvent(SHARED_PREFERENCES_CHANGED, { detail: [key] }));
  return true;
}

export function flushProjectPreferenceStaging(): void {
  if (!current) return;
  for (const key of PROJECT_LIST_PREFERENCES) {
    const target = pendingListKey(current.primary.hostId, key);
    const raw = localStorage.getItem(target);
    if (raw === null) continue;
    try {
      current.primary.setItem(key, raw);
      localStorage.removeItem(target);
      window.dispatchEvent(new Event(SHARED_PREFERENCES_STATUS));
    } catch { /* Wait until every entry has a Host project identity. */ }
  }
  for (const key of PROJECT_MAP_PREFERENCES) {
    const pending = staged(key);
    let changed = false;
    for (const [path, value] of Object.entries(pending)) {
      const environmentId = owner(path);
      const store = environmentId ? current.hosts.get(environmentId) : undefined;
      if (!store) continue;
      try {
        store.setItem(key, JSON.stringify({ ...object(store.getItem(key)), [path]: value }));
        delete pending[path];
        changed = true;
      } catch { /* Registration or durable writes may still be unavailable. */ }
    }
    if (changed) saveStaged(key, pending);
  }
}

export function projectPreferencePending(hostId?: string): boolean {
  if (!current) return false;
  const primaryHostId = current.primary.hostId;
  const includesHost = (id: string) => hostId === undefined || id === hostId;
  return [...PROJECT_MAP_PREFERENCES].some((key) => Object.keys(staged(key)).some((path) =>
    includesHost(owner(path) ?? parseRemotePath(path)?.environmentId ?? primaryHostId)))
    || [...current.hosts.values()].some((store) => includesHost(store.hostId) && store.pendingCount > 0)
    || includesHost(primaryHostId) && [...PROJECT_LIST_PREFERENCES].some((key) =>
      localStorage.getItem(pendingListKey(primaryHostId, key)) !== null);
}

