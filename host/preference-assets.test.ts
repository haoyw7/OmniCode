import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostPreferenceAssets } from "./preference-assets";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "host-preference-assets-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { assets: new HostPreferenceAssets(store), store };
}

it("resumes an image upload with matching retries and serves path-independent chunks", () => {
  const { assets, store } = setup();
  const chunk = (offset: number, data: Buffer) => ({ id, offset, size: png.length, mimeType: "image/png", data: data.toString("base64") });
  expect(assets.upload(chunk(0, png.subarray(0, 8)))).toEqual({ offset: 8 });
  expect(() => assets.read({ id, offset: 0 })).toThrow("incomplete");
  expect(assets.upload(chunk(0, png.subarray(0, 8)))).toEqual({ offset: 8 });
  expect(() => assets.upload(chunk(0, Buffer.alloc(8)))).toThrow("retry");
  const resumed = new HostPreferenceAssets(store);
  expect(resumed.upload(chunk(8, png.subarray(8)))).toEqual({ offset: png.length });
  expect(resumed.read({ id, offset: 0 })).toEqual({ data: png.toString("base64"), offset: png.length, size: png.length, mimeType: "image/png" });
  expect(() => resumed.upload({ ...chunk(0, png), size: png.length + 1 })).toThrow("metadata");
});

it("bounds uploads and rejects paths, MIME mismatches and invalid base64", () => {
  const { assets } = setup();
  const input = { id, offset: 0, size: png.length, mimeType: "image/png", data: png.toString("base64") };
  expect(() => assets.upload({ ...input, id: "../outside" })).toThrow("ID");
  expect(() => assets.upload({ ...input, size: 25 * 1024 * 1024 + 1 })).toThrow("chunk");
  expect(() => assets.upload({ ...input, mimeType: "image/svg+xml" })).toThrow("chunk");
  expect(() => assets.upload({ ...input, data: "a===" })).toThrow("chunk");
  expect(() => assets.upload({ ...input, mimeType: "image/jpeg" })).toThrow("supported image");
  expect(() => assets.read({ id, offset: 0 })).toThrow("missing");
  assets.upload(input);
  expect(() => assets.read({ id, offset: png.length + 1 })).toThrow("offset");
});
