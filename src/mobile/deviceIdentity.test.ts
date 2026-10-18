import { expect, it, vi } from "vitest";
import { readMobileInstallationId } from "./deviceIdentity";
import type { MobileStorage, StorageKey } from "./storage";

function memory(): MobileStorage {
  const values = new Map<StorageKey, string>();
  return {
    get: vi.fn(async key => values.get(key) ?? null),
    set: vi.fn(async (key, value) => { values.set(key, value); }),
    remove: vi.fn(async key => { values.delete(key); }),
  };
}

it("creates once for concurrent connections and restores after app restart", async () => {
  const storage = memory();
  const ids = await Promise.all(Array.from({ length: 4 }, () => readMobileInstallationId(storage)));
  expect(new Set(ids).size).toBe(1);
  expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(storage.set).toHaveBeenCalledTimes(1);
  expect(await readMobileInstallationId({ ...storage })).toBe(ids[0]);
  expect(await readMobileInstallationId(memory())).not.toBe(ids[0]);
});

it("does not expose an identity until storage succeeds and retries failed writes", async () => {
  const storage = memory();
  vi.mocked(storage.set).mockRejectedValueOnce(new Error("Storage write failed"));
  await expect(readMobileInstallationId(storage)).rejects.toThrow("Storage write failed");
  const id = await readMobileInstallationId(storage);
  expect(await storage.get("installationId")).toBe(id);
});

it("retains legacy native shell pairing when the new storage key is unavailable", async () => {
  const storage = memory();
  vi.mocked(storage.get).mockRejectedValueOnce(new Error("Invalid storage key"));
  expect(await readMobileInstallationId(storage)).toBeUndefined();
  expect(storage.set).not.toHaveBeenCalled();
  expect(await readMobileInstallationId(storage)).toEqual(expect.any(String));
});

it("replaces malformed stored identities instead of sending them to Hosts", async () => {
  const storage = memory();
  await storage.set("installationId", "bad");
  const id = await readMobileInstallationId(storage);
  expect(id).not.toBe("bad");
  expect(await storage.get("installationId")).toBe(id);
});
