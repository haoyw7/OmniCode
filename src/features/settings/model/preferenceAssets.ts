import type { PreferenceRequest } from "./sharedPreferences";
import { activePreferenceStore, preferenceStorage, SHARED_PREFERENCES_STATUS } from "./sharedPreferences";

const PREFIX = "host-asset:";
export const PREFERENCE_ASSET_READY = "monocode:preference-asset-ready";
const MAX_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 512 * 1024;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export type PreferenceAsset = { key: string; hostId: string; id: string; blob: Blob; pending: boolean };
export interface PreferenceAssetCache {
  get(key: string): Promise<PreferenceAsset | undefined>;
  pending(hostId: string): Promise<PreferenceAsset[]>;
  put(asset: PreferenceAsset): Promise<void>;
}
let dbPromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  return dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open("monocode-host-assets", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("assets", { keyPath: "key" }); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); dbPromise = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { dbPromise = undefined; reject(request.error); };
    request.onblocked = () => { blocked = true; reject(new Error("Close another app window to update the background cache.")); };
  }).catch(error => { dbPromise = undefined; throw error; });
}
const cache: PreferenceAssetCache = {
  async get(key) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("assets", "readonly");
      const request = transaction.objectStore("assets").get(key);
      request.onsuccess = () => resolve(request.result as PreferenceAsset | undefined);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  async pending(hostId) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("assets", "readonly");
      const request = transaction.objectStore("assets").openCursor();
      const result: PreferenceAsset[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(result); return; }
        const asset = cursor.value as PreferenceAsset;
        if (asset.hostId === hostId && asset.pending) result.push(asset);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  async put(asset) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("assets", "readwrite");
      transaction.objectStore("assets").put(asset);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  },
};
export function parsePreferenceAsset(reference: string): { hostId: string; id: string } | undefined {
  if (!reference.startsWith(PREFIX)) return;
  const parts = reference.slice(PREFIX.length).split(":");
  if (parts.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[1])) return;
  try {
    const hostId = decodeURIComponent(parts[0]);
    return hostId && !hostId.includes("\0") ? { hostId, id: parts[1] } : undefined;
  } catch { return; }
}
function imageMime(bytes: Uint8Array): string | undefined {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(text(0, 6))) return "image/gif";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
}
function encode(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function notify(name: string) { if (typeof window !== "undefined") window.dispatchEvent(new Event(name)); }

/** Blob durability and transport are separate, so a preference never references an unsaved local image. */
export class PreferenceAssets {
  private requests = new Map<string, PreferenceRequest>();
  private urls = new Map<string, string>();
  private wanted = new Set<string>();
  private loading = new Map<string, Promise<string>>();
  private uploads = new Map<string, Promise<void>>();
  constructor(private readonly cache: PreferenceAssetCache) {}
  register(hostId: string, request: PreferenceRequest): () => void {
    this.requests.set(hostId, request);
    this.retry(hostId);
    return () => { if (this.requests.get(hostId) === request) this.requests.delete(hostId); };
  }
  async queue(blob: Blob, hostId: string): Promise<string> {
    if (!hostId) throw new Error("Connect to the Host before choosing a background.");
    if (!blob.size || blob.size > MAX_BYTES || !MIME_TYPES.has(blob.type)
      || imageMime(new Uint8Array(await blob.slice(0, 16).arrayBuffer())) !== blob.type)
      throw new Error("Background must be a PNG, JPG, GIF, or WebP image (maximum 25 MB).");
    const id = crypto.randomUUID();
    const key = `${PREFIX}${encodeURIComponent(hostId)}:${id}`;
    await this.cache.put({ key, hostId, id, blob, pending: true });
    this.urls.set(key, URL.createObjectURL(blob));
    return key;
  }
  async flush(hostId: string, request: PreferenceRequest): Promise<void> {
    const running = this.uploads.get(hostId);
    if (running) { await running; return this.flush(hostId, request); }
    const work = (async () => {
      for (;;) {
        const pending = await this.cache.pending(hostId);
        if (!pending.length) return;
        for (const asset of pending) {
          for (let offset = 0; offset < asset.blob.size; offset += CHUNK_BYTES) {
            const bytes = new Uint8Array(await asset.blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
            const result = await request<{ offset: number }>("preferences.assets.upload", {
              id: asset.id, offset, size: asset.blob.size, mimeType: asset.blob.type, data: encode(bytes),
            });
            if (result.offset !== offset + bytes.length) throw new Error("Invalid background upload acknowledgement.");
          }
          await this.cache.put({ ...asset, pending: false });
        }
      }
    })();
    this.uploads.set(hostId, work);
    try { await work; } finally { if (this.uploads.get(hostId) === work) this.uploads.delete(hostId); }
  }
  retry(hostId?: string) {
    for (const reference of this.wanted) if (!hostId || parsePreferenceAsset(reference)?.hostId === hostId) this.url(reference);
  }
  url(reference: string): string | undefined {
    if (!parsePreferenceAsset(reference)) return;
    this.wanted.add(reference);
    const cached = this.urls.get(reference);
    if (cached) return cached;
    void this.load(reference).catch(() => undefined);
  }
  load(reference: string): Promise<string> {
    const cached = this.urls.get(reference);
    if (cached) return Promise.resolve(cached);
    const running = this.loading.get(reference);
    if (running) return running;
    const work = this.download(reference).catch(error => {
      if (activePreferenceStore()?.hostId === parsePreferenceAsset(reference)?.hostId) activePreferenceStore()!.error = error instanceof Error ? error.message : String(error);
      notify(SHARED_PREFERENCES_STATUS);
      throw error;
    }).finally(() => this.loading.delete(reference));
    this.loading.set(reference, work);
    return work;
  }
  private async download(reference: string): Promise<string> {
    const identity = parsePreferenceAsset(reference);
    if (!identity) throw new Error("Invalid background resource.");
    let blob = (await this.cache.get(reference))?.blob;
    if (!blob) {
      const request = this.requests.get(identity.hostId);
      if (!request) throw new Error("Connect to the Host to load this background.");
      const chunks: Uint8Array[] = [];
      let offset = 0, size = 0, mime = "";
      do {
        const chunk = await request<{ offset: number; data: string; size: number; mimeType: string }>("preferences.assets.read", { id: identity.id, offset });
        if (!Number.isSafeInteger(chunk.size) || chunk.size <= 0 || chunk.size > MAX_BYTES
          || !Number.isSafeInteger(chunk.offset) || chunk.offset <= offset || chunk.offset > chunk.size
          || !MIME_TYPES.has(chunk.mimeType) || (size && (size !== chunk.size || mime !== chunk.mimeType))
          || typeof chunk.data !== "string" || chunk.data.length > Math.ceil(CHUNK_BYTES / 3) * 4
          || chunk.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data) || chunks.length >= 1024)
          throw new Error("Invalid background resource.");
        const bytes = Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0));
        if (bytes.length !== chunk.offset - offset || encode(bytes) !== chunk.data) throw new Error("Invalid background resource.");
        chunks.push(bytes); mime = chunk.mimeType; size = chunk.size; offset = chunk.offset;
      } while (offset < size);
      blob = new Blob(chunks as BlobPart[], { type: mime });
      if (imageMime(new Uint8Array(await blob.slice(0, 16).arrayBuffer())) !== mime) throw new Error("Invalid background resource.");
      await this.cache.put({ key: reference, ...identity, blob, pending: false });
    }
    const url = URL.createObjectURL(blob);
    this.urls.set(reference, url);
    notify(PREFERENCE_ASSET_READY);
    return url;
  }
}
const assets = new PreferenceAssets(cache);
export const registerPreferenceAssetHost = (hostId: string, request: PreferenceRequest) => assets.register(hostId, request);
export const queuePreferenceAsset = (blob: Blob, hostId = activePreferenceStore()?.hostId) => assets.queue(blob, hostId ?? "");
export const preferenceAssetUrl = (reference: string) => assets.url(reference);
export function flushPreferenceAssets(hostId: string, request: PreferenceRequest): Promise<void> {
  return typeof indexedDB === "undefined" ? Promise.resolve() : assets.flush(hostId, request);
}
export async function uploadPreferenceBackground(path: string, hostId?: string): Promise<string> {
  const existing = parsePreferenceAsset(path);
  if (existing) {
    if (hostId && existing.hostId !== hostId) throw new Error("Background belongs to another Host.");
    return path;
  }
  const { readBinaryFile } = await import("../../../platform/tauri/fs");
  const bytes = new Uint8Array(await readBinaryFile(path));
  const mime = imageMime(bytes);
  return queuePreferenceAsset(new Blob([bytes], { type: mime ?? "" }), hostId);
}
/** Release imports legacy images without rewriting or deleting its recovery source. */
export async function migrateLegacyPreferenceBackgrounds(): Promise<void> {
  const hostId = activePreferenceStore()?.hostId;
  if (!hostId) return;
  const { remoteProjectFor, parseRemotePath } = await import("../../connections/model/remoteProjects");
  const global = localStorage.getItem("monocode.chatBackgroundPath")?.trim();
  if (global) preferenceStorage.setItem("monocode.chatBackgroundAsset", await uploadPreferenceBackground(global, hostId));
  const raw = localStorage.getItem("monocode:project-chat-backgrounds");
  if (!raw) return;
  const previous: unknown = JSON.parse(raw);
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return;
  const projects: Record<string, unknown> = {};
  for (const [project, value] of Object.entries(previous)) {
    if (!value || typeof value !== "object" || !("path" in value) || typeof value.path !== "string" || !value.path.trim()) continue;
    const owner = remoteProjectFor(project)?.environmentId ?? parseRemotePath(project)?.environmentId ?? hostId;
    projects[project] = { ...value, path: await uploadPreferenceBackground(value.path, owner) };
  }
  if (Object.keys(projects).length) preferenceStorage.setItem("monocode.projectBackgroundAssets", JSON.stringify(projects));
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => assets.retry());
  window.addEventListener("focus", () => assets.retry());
}
