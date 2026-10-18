import { afterEach, expect, it, vi } from "vitest";
import { PreferenceAssets, parsePreferenceAsset, type PreferenceAsset, type PreferenceAssetCache } from "./preferenceAssets";
import type { PreferenceRequest } from "./sharedPreferences";

const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"));
const picture = () => new Blob([png], { type: "image/png" });
class MemoryCache implements PreferenceAssetCache {
  readonly records = new Map<string, PreferenceAsset>();
  async get(key: string) { return this.records.get(key); }
  async pending(hostId: string) { return [...this.records.values()].filter(asset => asset.hostId === hostId && asset.pending); }
  async put(asset: PreferenceAsset) { this.records.set(asset.key, asset); }
}
afterEach(() => vi.restoreAllMocks());

it("requires durable blob storage before returning a portable reference", async () => {
  const cache = new MemoryCache();
  const assets = new PreferenceAssets(cache);
  const url = vi.spyOn(URL, "createObjectURL");
  vi.spyOn(cache, "put").mockRejectedValueOnce(new Error("quota exceeded"));
  await expect(assets.queue(picture(), "host")).rejects.toThrow("quota exceeded");
  expect(url).not.toHaveBeenCalled();
  const ref = await assets.queue(picture(), "host");
  expect(parsePreferenceAsset(ref)).toMatchObject({ hostId: "host" });
  expect(cache.records.get(ref)?.pending).toBe(true);
  expect(assets.url(ref)).toMatch(/^blob:/);
  await expect(assets.queue(new Blob(["not an image"], { type: "image/png" }), "host")).rejects.toThrow("PNG");
});

it("replays lost upload acknowledgements with the same resource identity after restart", async () => {
  const cache = new MemoryCache();
  const ref = await new PreferenceAssets(cache).queue(picture(), "host");
  let fail = true;
  const calls: Record<string, unknown>[] = [];
  const request: PreferenceRequest = async <T>(_method: string, params: Record<string, unknown>) => {
    calls.push(params);
    if (fail) throw new Error("response lost");
    return { offset: Number(params.offset) + Buffer.from(String(params.data), "base64").length } as T;
  };
  await expect(new PreferenceAssets(cache).flush("host", request)).rejects.toThrow("response lost");
  expect(cache.records.get(ref)?.pending).toBe(true);
  fail = false;
  await new PreferenceAssets(cache).flush("host", request);
  expect(calls[0]).toEqual(calls[1]);
  expect(cache.records.get(ref)?.pending).toBe(false);
});

it("drains images queued during an upload before allowing the dependent preferences patch", async () => {
  const cache = new MemoryCache();
  const assets = new PreferenceAssets(cache);
  await assets.queue(picture(), "host");
  let complete!: () => void;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { complete = resolve; });
  const ids: unknown[] = [];
  const request: PreferenceRequest = async <T>(_method: string, params: Record<string, unknown>) => {
    ids.push(params.id);
    if (ids.length === 1) { started(); await wait; }
    return { offset: Number(params.offset) + Buffer.from(String(params.data), "base64").length } as T;
  };
  const flushing = assets.flush("host", request);
  await start;
  await assets.queue(picture(), "host");
  const concurrent = assets.flush("host", request);
  complete();
  await Promise.all([flushing, concurrent]);
  expect(new Set(ids).size).toBe(2);
  expect(ids).toHaveLength(2);
  expect(await cache.pending("host")).toEqual([]);
});

it("downloads from the resource's Host once and caches validated bytes for offline reuse", async () => {
  const cache = new MemoryCache();
  const assets = new PreferenceAssets(cache);
  const ref = "host-asset:host:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const calls: number[] = [];
  assets.register("host", async <T>(_method: string, params: Record<string, unknown>) => {
    const offset = Number(params.offset); calls.push(offset);
    const end = offset === 0 ? 8 : png.length;
    return { data: Buffer.from(png.subarray(offset, end)).toString("base64"), offset: end, size: png.length, mimeType: "image/png" } as T;
  });
  const [first, second] = await Promise.all([assets.load(ref), assets.load(ref)]);
  expect(first).toBe(second);
  expect(calls).toEqual([0, 8]);
  expect(new Uint8Array(await cache.records.get(ref)!.blob.arrayBuffer())).toEqual(png);
  expect(cache.records.get(ref)?.pending).toBe(false);
  expect(await new PreferenceAssets(cache).load(ref)).toMatch(/^blob:/);
});

it("rejects inconsistent download metadata and incorrect upload acknowledgements", async () => {
  const cache = new MemoryCache();
  const assets = new PreferenceAssets(cache);
  const ref = "host-asset:host:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assets.register("host", async <T>(_method: string, params: Record<string, unknown>) => {
    const offset = Number(params.offset), end = offset === 0 ? 8 : png.length;
    return { data: Buffer.from(png.subarray(offset, end)).toString("base64"), offset: end, size: png.length + (offset ? 1 : 0), mimeType: "image/png" } as T;
  });
  await expect(assets.load(ref)).rejects.toThrow("Invalid background");
  expect(cache.records.has(ref)).toBe(false);
  const queued = await assets.queue(picture(), "host");
  await expect(assets.flush("host", async <T>() => ({ offset: 0 }) as T)).rejects.toThrow("acknowledgement");
  expect(cache.records.get(queued)?.pending).toBe(true);
});

it("never sends one Host's pending image through another Host's transport", async () => {
  const cache = new MemoryCache();
  const assets = new PreferenceAssets(cache);
  const a = await assets.queue(picture(), "host-a"), b = await assets.queue(picture(), "host-b");
  const request = vi.fn(async (_method, params) => ({ offset: Number(params.offset) + Buffer.from(String(params.data), "base64").length })) as PreferenceRequest;
  await assets.flush("host-a", request);
  expect(cache.records.get(a)?.pending).toBe(false);
  expect(cache.records.get(b)?.pending).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("preferences.assets.upload", expect.objectContaining({ id: parsePreferenceAsset(a)!.id }));
});
