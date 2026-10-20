/** IndexedDB holds transcript-sized data without synchronous localStorage writes. */
export type OfflineCacheKind = "session" | "models" | "projects" | "summaries";
export type OfflineCacheEntry = { kind: OfflineCacheKind; id: string; value: unknown };
export type OfflineCacheWrite = Omit<OfflineCacheEntry, "value"> & { value?: unknown };
export interface MobileOfflineCache {
  readHost(host: string): Promise<OfflineCacheEntry[]>;
  write(host: string, entries: OfflineCacheWrite[]): Promise<void>;
  removeHost(host: string): Promise<void>;
}
type Metadata = { key: string; host: string; kind: OfflineCacheKind; id: string; used: number; bytes: number };
export const OFFLINE_SESSION_LIMIT = 12;
const limits: Record<OfflineCacheKind, number> = { session: OFFLINE_SESSION_LIMIT, models: 8, projects: 1, summaries: 1 };
export const OFFLINE_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 256;

export class IndexedDbMobileOfflineCache implements MobileOfflineCache {
  private opening?: Promise<IDBDatabase>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly name = "omnicode-mobile-offline-v1", private readonly maxBytes = OFFLINE_CACHE_BYTES) {}

  private database() {
    return this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore("data");
        request.result.createObjectStore("lru", { keyPath: "key" });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error("Offline cache is blocked")); };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); this.opening = undefined; };
        resolve(request.result);
      };
    }).catch(error => { this.opening = undefined; throw error; });
  }

  /** Storage denial/quota/corruption must never prevent online use. Keep operations ordered. */
  private run<T>(fallback: T, task: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (typeof indexedDB === "undefined") return fallback;
      try { return await task(await this.database()); } catch { return fallback; }
    });
    this.queue = next;
    return next;
  }

  readHost(host: string) {
    return this.run<OfflineCacheEntry[]>([], db => new Promise((resolve, reject) => {
      const tx = db.transaction(["data", "lru"], "readonly");
      const entries: OfflineCacheEntry[] = [];
      const request = tx.objectStore("lru").getAll();
      request.onsuccess = () => {
        for (const meta of (request.result as Metadata[]).filter(item => item.host === host).sort((a, b) => a.used - b.used)) {
          const read = tx.objectStore("data").get(meta.key);
          read.onsuccess = () => {
            if (read.result !== undefined) entries.push({ kind: meta.kind, id: meta.id, value: read.result });
          };
        }
      };
      tx.oncomplete = () => resolve(entries);
      tx.onerror = tx.onabort = () => reject(tx.error);
    }));
  }

  write(host: string, entries: OfflineCacheWrite[]) {
    // Encode once per coalesced update, outside the transaction. Metadata-only touches
    // never serialize the transcript; eviction only reads small metadata records.
    return this.run(undefined, db => new Promise<void>((resolve, reject) => {
      const updates = entries.map(entry => ({
        ...entry, key: JSON.stringify([host, entry.kind, entry.id]),
        bytes: entry.value === undefined ? undefined : JSON.stringify(entry.value).length * 2,
      }));
      const tx = db.transaction(["data", "lru"], "readwrite");
      const data = tx.objectStore("data"), lru = tx.objectStore("lru");
      const request = lru.getAll();
      request.onsuccess = () => {
        const records = new Map((request.result as Metadata[]).map(item => [item.key, item]));
        let used = Math.max(Date.now(), ...[...records.values()].map(item => item.used));
        for (const update of updates) {
          const previous = records.get(update.key);
          if (update.bytes === undefined && !previous) continue;
          // An oversized replacement must not leave an obsolete snapshot behind.
          if ((update.bytes ?? 0) > this.maxBytes) {
            data.delete(update.key); lru.delete(update.key); records.delete(update.key); continue;
          }
          if (update.value !== undefined) data.put(update.value, update.key);
          const meta = { key: update.key, host, kind: update.kind, id: update.id, used: ++used, bytes: update.bytes ?? previous!.bytes };
          records.set(update.key, meta);
          lru.put(meta);
        }
        const newest = [...records.values()].sort((a, b) => b.used - a.used);
        const counts = new Map<string, number>();
        let bytes = 0, count = 0;
        for (const item of newest) {
          const group = JSON.stringify([item.host, item.kind]);
          const retained = counts.get(group) ?? 0;
          if (retained >= limits[item.kind] || count >= MAX_ENTRIES || bytes + item.bytes > this.maxBytes) {
            data.delete(item.key); lru.delete(item.key);
          } else {
            counts.set(group, retained + 1); bytes += item.bytes; count++;
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    }));
  }

  removeHost(host: string) {
    return this.run(undefined, db => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["data", "lru"], "readwrite");
      const request = tx.objectStore("lru").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value.host === host) { tx.objectStore("data").delete(cursor.key); cursor.delete(); }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    }));
  }
}

export const mobileOfflineCache = new IndexedDbMobileOfflineCache();
