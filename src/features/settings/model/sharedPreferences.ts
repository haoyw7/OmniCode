import {
  DEVICE_LOCAL_PREFERENCE_KINDS, DEVICE_LOCAL_PROJECT_LIST_PREFERENCES, DEVICE_LOCAL_PROJECT_MAP_PREFERENCES,
  preferenceField, preferenceKind, SHARED_PREFERENCE_KINDS, validateSharedPreferenceValue,
} from "./sharedPreferenceSchema";

export type PreferenceValues = Record<string, string>;
export type PreferenceSnapshot = { revision: number; imported: boolean; values: PreferenceValues };
export type PreferenceRequest = <T>(method: string, params: Record<string, unknown>) => Promise<T>;
type Operation = { operationId: string; changes: Record<string, string | null>; importRelease?: true };
type JournalOperation = Operation & { queuedAt: number };
type Cache = PreferenceSnapshot;
export type PreferenceCodec = { encode(key: string, value: unknown): unknown; decode(key: string, value: unknown): unknown };
const identity: PreferenceCodec = { encode: (_, v) => v, decode: (_, v) => v };
export const SHARED_PREFERENCES_CHANGED = "monocode:shared-preferences-changed";
export const SHARED_PREFERENCES_STATUS = "monocode:shared-preferences-status";
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** The same store serves desktop and mobile. Only an explicit edit enters the journal. */
export class SharedPreferenceStore {
  private snapshot: Cache = { revision: -1, imported: false, values: {} };
  private pending = new Map<string, JournalOperation>();
  private lastQueuedAt = 0;
  private running?: Promise<void>;
  private listeners = new Set<(keys: string[]) => void>();
  error?: string;
  readonly cacheKey: string;
  readonly journalPrefix: string;
  constructor(readonly hostId: string, private disk: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">, private request: PreferenceRequest, readonly codec: PreferenceCodec = identity) {
    this.cacheKey = `monocode.hostPreferences.v1:${hostId}`;
    this.journalPrefix = `${this.cacheKey}:pending:`;
    try {
      const cache = JSON.parse(disk.getItem(this.cacheKey) ?? "null") as Cache | null;
      if (cache && Number.isSafeInteger(cache.revision) && cache.values) this.snapshot = { ...cache, values: this.validValues(cache.values) };
      this.reloadJournal();
    } catch { this.error = "Could not read pending settings."; }
  }
  private validValues(values: PreferenceValues): PreferenceValues {
    return Object.fromEntries(Object.entries(values).filter(([key, value]) => typeof value === "string" && validateSharedPreferenceValue(key, value)));
  }
  private reloadJournal() {
    for (let i = 0; i < this.disk.length; i++) {
      const key = this.disk.key(i);
      if (!key?.startsWith(this.journalPrefix)) continue;
      try {
        const op = JSON.parse(this.disk.getItem(key) ?? "null") as Partial<JournalOperation> | null;
        if (typeof op?.operationId === "string" && key === `${this.journalPrefix}${op.operationId}` && op.changes && Object.entries(op.changes).every(([k, v]) => validateSharedPreferenceValue(k, v))) {
          // Older journals have no ordering metadata. Keep them before newly queued edits.
          const queuedAt = Number.isSafeInteger(op.queuedAt) && op.queuedAt! >= 0 ? op.queuedAt! : 0;
          this.lastQueuedAt = Math.max(this.lastQueuedAt, queuedAt);
          this.pending.set(op.operationId, {
            operationId: op.operationId, changes: op.changes, queuedAt,
            ...(op.importRelease === true ? { importRelease: true } : {}),
          });
        }
      } catch { /* Keep malformed records on disk for recovery, never transmit. */ }
    }
    // Storage enumeration order is unspecified, including across browser restarts.
    this.pending = new Map([...this.pending].sort(([, a], [, b]) => a.queuedAt - b.queuedAt || a.operationId.localeCompare(b.operationId)));
  }
  subscribe(listener: (keys: string[]) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  get pendingCount() { return this.pending.size; }
  get imported() { return this.snapshot.imported; }
  get revision() { return this.snapshot.revision; }
  private values(): PreferenceValues {
    const values = { ...this.snapshot.values };
    for (const op of this.pending.values()) for (const [key, value] of Object.entries(op.changes)) {
      if (value === null) delete values[key]; else values[key] = value;
    }
    return values;
  }
  getItem(key: string): string | null {
    const values = this.values();
    const kind = preferenceKind(key);
    if (kind !== "object") {
      const raw = values[key];
      if (raw === undefined) return null;
      if (kind === "array") return JSON.stringify(this.codec.decode(key, JSON.parse(raw)));
      return raw;
    }
    const fields = Object.entries(values).filter(([field]) => field === key || field.startsWith(`${key}::`));
    if (!fields.length) return null;
    let object: Record<string, unknown> = {};
    for (const [field, value] of fields.sort(([a], [b]) => a.length - b.length)) {
      const path = preferenceField(field)!.path;
      if (!path.length) { object = JSON.parse(value); continue; }
      let target = object;
      for (const part of path.slice(0, -1)) {
        if (!own(target, part) || typeof target[part] !== "object" || target[part] === null || Array.isArray(target[part])) target[part] = {};
        target = target[part] as Record<string, unknown>;
      }
      target[path.at(-1)!] = JSON.parse(value);
    }
    return JSON.stringify(this.codec.decode(key, object));
  }
  private fields(key: string, raw: string | null): PreferenceValues {
    if (raw === null) return {};
    const kind = preferenceKind(key);
    if (!validateSharedPreferenceValue(key, raw)) throw new Error("Invalid shared preference.");
    if (kind !== "object") return { [key]: kind === "array" ? JSON.stringify(this.codec.encode(key, JSON.parse(raw))) : raw };
    const result: PreferenceValues = {};
    const flatten = (value: unknown, path: string[]) => {
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
        for (const [part, child] of Object.entries(value)) flatten(child, [...path, part]);
      } else {
        const field = path.length ? `${key}::${JSON.stringify(path)}` : key;
        const encoded = JSON.stringify(value);
        if (!validateSharedPreferenceValue(field, encoded)) throw new Error("Invalid shared preference field.");
        result[field] = encoded;
      }
    };
    flatten(this.codec.encode(key, JSON.parse(raw)), []);
    return result;
  }
  setItem(key: string, raw: string | null) {
    const before = this.values();
    const after = this.fields(key, raw);
    const changes: Record<string, string | null> = {};
    for (const field of new Set([...Object.keys(before).filter(f => f === key || f.startsWith(`${key}::`)), ...Object.keys(after)])) {
      if (before[field] !== after[field]) changes[field] = after[field] ?? null;
    }
    if (!Object.keys(changes).length) return;
    this.enqueue({ operationId: crypto.randomUUID(), changes });
    this.notify([key]);
    void this.sync();
  }
  private enqueue(op: Operation) {
    const entry: JournalOperation = { ...op, queuedAt: Math.max(Date.now(), this.lastQueuedAt + 1) };
    // Durability before optimistic acknowledgement. Failure remains visible to the UI.
    try { this.disk.setItem(`${this.journalPrefix}${op.operationId}`, JSON.stringify(entry)); }
    catch (error) { this.error = "Could not save pending settings."; this.status(); throw error; }
    this.lastQueuedAt = entry.queuedAt;
    this.pending.set(op.operationId, entry);
    this.status();
  }
  private notify(keys: string[]) { for (const listener of this.listeners) listener(keys); this.status(); }
  private status() { if (typeof window !== "undefined") window.dispatchEvent(new Event(SHARED_PREFERENCES_STATUS)); }
  async importRelease(read: (key: string) => string | null) {
    await this.sync();
    if (this.snapshot.revision < 0 || this.snapshot.imported) return;
    const changes: PreferenceValues = {};
    for (const key of Object.keys(SHARED_PREFERENCE_KINDS)) {
      const value = read(key);
      if (value !== null) try { Object.assign(changes, this.fields(key, value)); } catch { /* Invalid legacy preference uses default. */ }
    }
    this.enqueue({ operationId: crypto.randomUUID(), changes, importRelease: true });
    await this.sync();
  }
  sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.synchronize().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async synchronize() {
    const before = Object.fromEntries(Object.keys(SHARED_PREFERENCE_KINDS).map(k => [k, this.getItem(k)]));
    try {
      this.reloadJournal();
      const snapshot = await this.request<PreferenceSnapshot | null>("preferences.read", { revision: this.snapshot.revision });
      if (snapshot) this.snapshot = { ...snapshot, values: this.validValues(snapshot.values) };
      while (this.pending.size) {
        const op = this.pending.values().next().value!;
        // queuedAt belongs to the device journal, never the Host operation signature.
        const payload: Operation = { operationId: op.operationId, changes: op.changes, ...(op.importRelease ? { importRelease: true } : {}) };
        const result = await this.request<PreferenceSnapshot>("preferences.patch", payload);
        // A duplicate receipt may predate a newer read; never move the cache backwards.
        if (result.revision >= this.snapshot.revision) this.snapshot = { ...result, values: this.validValues(result.values) };
        this.disk.removeItem(`${this.journalPrefix}${op.operationId}`);
        this.pending.delete(op.operationId);
      }
      this.disk.setItem(this.cacheKey, JSON.stringify(this.snapshot));
      this.error = undefined;
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    const changed = Object.keys(before).filter(k => before[k] !== this.getItem(k));
    if (changed.length) this.notify(changed); else this.status();
  }
}

let active: SharedPreferenceStore | undefined;
let stopActive: (() => void) | undefined;
export const activePreferenceStore = () => active;
export function activatePreferenceStore(store: SharedPreferenceStore | undefined) {
  stopActive?.(); active = store;
  stopActive = store?.subscribe(announcePreferenceChange);
  announcePreferenceChange(Object.keys(SHARED_PREFERENCE_KINDS));
}
const DEVICE_LOCAL_ADOPTED = "monocode.deviceLocalPreferencesAdopted.v1";
/**
 * One-time copy of the last Host-shared view state into this device, so moving
 * those keys out of the Host does not reset them. Project-keyed values need the
 * project codec to resolve identities into local paths.
 */
export function adoptDeviceLocalPreferences(store: SharedPreferenceStore, resolvesProjects: boolean) {
  if (store.revision < 0 || localStorage.getItem(DEVICE_LOCAL_ADOPTED) !== null) return;
  const adopted: string[] = [];
  for (const key of Object.keys(DEVICE_LOCAL_PREFERENCE_KINDS)) {
    if (!resolvesProjects && (DEVICE_LOCAL_PROJECT_MAP_PREFERENCES.has(key) || DEVICE_LOCAL_PROJECT_LIST_PREFERENCES.has(key))) continue;
    try {
      const value = store.getItem(key);
      if (value === null || !validateSharedPreferenceValue(key, value)) continue;
      localStorage.setItem(key, value);
      adopted.push(key);
    } catch { /* Keep this device's own value. */ }
  }
  try { localStorage.setItem(DEVICE_LOCAL_ADOPTED, "1"); } catch { /* Retried on the next connection. */ }
  if (adopted.length) announcePreferenceChange(adopted);
}
function announcePreferenceChange(keys: string[]) {
  if (typeof window === "undefined") return;
  for (const key of keys) window.dispatchEvent(new StorageEvent("storage", { key }));
  window.dispatchEvent(new CustomEvent(SHARED_PREFERENCES_CHANGED, { detail: keys }));
}
/** Explicit adapter, never a monkey-patch of browser storage. Non-preference caches stay local. */
let preferenceRouting: { get(key: string): string | null | undefined; set(key: string, raw: string | null): boolean } | undefined;
export function setPreferenceRouting(routing: typeof preferenceRouting) { preferenceRouting = routing; }
export const preferenceStorage = {
  getItem(key: string): string | null {
    const routed = preferenceRouting?.get(key);
    if (routed !== undefined) return routed;
    if (!active || !own(SHARED_PREFERENCE_KINDS, key)) return localStorage.getItem(key);
    const value = active.getItem(key);
    // A Host that never answered (older, or not reached yet) must not blank
    // this device's own settings; edits made meanwhile are still journaled.
    return value === null && active.revision < 0 ? localStorage.getItem(key) : value;
  },
  setItem(key: string, value: string) {
    if (preferenceRouting?.set(key, value)) return;
    if (active && own(SHARED_PREFERENCE_KINDS, key)) active.setItem(key, value); else localStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (preferenceRouting?.set(key, null)) return;
    if (active && own(SHARED_PREFERENCE_KINDS, key)) active.setItem(key, null); else localStorage.removeItem(key);
  },
};
export function subscribeSharedPreferences(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SHARED_PREFERENCES_CHANGED, listener);
  return () => window.removeEventListener(SHARED_PREFERENCES_CHANGED, listener);
}
