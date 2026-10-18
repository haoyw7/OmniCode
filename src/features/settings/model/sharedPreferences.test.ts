import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../../../../host/store";
import { HostClientState } from "../../../../host/client-state";
import { activatePreferenceStore, adoptDeviceLocalPreferences, preferenceStorage, SharedPreferenceStore, type PreferenceRequest } from "./sharedPreferences";

class MemoryStorage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); });
function fixture() {
  const store = new HostStore(":memory:");
  cleanups.push(() => store.close());
  const host = new HostClientState(store);
  let online = true;
  let loseNextResponse = false;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const request: PreferenceRequest = async <T>(method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (!online) throw new Error("offline");
    const result = method === "preferences.read" ? host.preferencesRead(params) : host.preferencesPatch(params);
    if (method === "preferences.patch" && loseNextResponse) { loseNextResponse = false; throw new Error("response lost"); }
    return result as T;
  };
  const disk = new MemoryStorage();
  return { host, request, disk, calls,
    client: (storage = disk, hostId = "host-a") => new SharedPreferenceStore(hostId, storage, request),
    offline: () => { online = false; }, online: () => { online = true; }, loseResponse: () => { loseNextResponse = true; } };
}

it("merges offline edits to different project fields across desktop and phone", async () => {
  const s = fixture();
  const desktop = s.client();
  const phone = s.client(new MemoryStorage());
  await desktop.sync(); await phone.sync();
  s.offline();
  desktop.setItem("monocode.projectProviderSettings.v1", JSON.stringify({ project: { defaultHarness: "codex" } }));
  phone.setItem("monocode.projectProviderSettings.v1", JSON.stringify({ project: { defaultModel: "model-a" } }));
  await desktop.sync(); await phone.sync();
  expect(desktop.pendingCount).toBe(1); expect(phone.pendingCount).toBe(1);
  s.online();
  await desktop.sync(); await phone.sync(); await desktop.sync();
  const expected = { project: { defaultHarness: "codex", defaultModel: "model-a" } };
  expect(JSON.parse(desktop.getItem("monocode.projectProviderSettings.v1")!)).toEqual(expected);
  expect(JSON.parse(phone.getItem("monocode.projectProviderSettings.v1")!)).toEqual(expected);
  expect(desktop.pendingCount).toBe(0); expect(phone.pendingCount).toBe(0);
});

it("retries a persisted lost acknowledgement without replacing a newer Host value", async () => {
  const s = fixture();
  const first = s.client();
  await first.sync();
  s.loseResponse();
  first.setItem("monocode.colorScheme", "dark");
  await first.sync();
  expect(first.error).toBe("response lost");
  expect(first.pendingCount).toBe(1);
  const second = s.client(new MemoryStorage());
  await second.sync();
  second.setItem("monocode.colorScheme", "light");
  await second.sync();
  const restarted = s.client();
  await restarted.sync();
  expect(restarted.getItem("monocode.colorScheme")).toBe("light");
  expect(restarted.revision).toBe(2);
  expect(restarted.pendingCount).toBe(0);
  const firstId = s.calls.find(call => call.method === "preferences.patch")!.params.operationId;
  expect(s.calls.filter(call => call.method === "preferences.patch" && call.params.operationId === firstId)).toHaveLength(2);
  expect(s.host.preferencesRead()!.revision).toBe(2);
});

it("keeps unsent changes durable and isolated by verified Host identity", async () => {
  const s = fixture();
  const client = s.client();
  await client.sync();
  s.offline();
  client.setItem("monocode.uiLanguage", "zh-CN");
  await client.sync();
  expect(client.error).toBe("offline");
  const restarted = s.client();
  expect(restarted.getItem("monocode.uiLanguage")).toBe("zh-CN");
  expect(restarted.pendingCount).toBe(1);
  expect(s.client(s.disk, "host-b").getItem("monocode.uiLanguage")).toBeNull();
  s.online();
  await restarted.sync();
  expect(restarted.pendingCount).toBe(0);
  expect(restarted.error).toBeUndefined();
  expect(s.host.preferencesRead()!.values["monocode.uiLanguage"]).toBe("zh-CN");
});

it("restores same-field offline edits in enqueue order regardless of storage enumeration or clock changes", async () => {
  class ReversedStorage extends MemoryStorage {
    override key(index: number) { return super.key(this.length - index - 1); }
  }
  const s = fixture();
  const disk = new ReversedStorage();
  const first = s.client(disk);
  await first.sync();
  s.offline();
  const now = vi.spyOn(Date, "now").mockReturnValue(100);
  first.setItem("monocode.colorScheme", "dark");
  await first.sync();
  first.setItem("monocode.colorScheme", "light");
  await first.sync();
  now.mockReturnValue(50);
  first.setItem("monocode.colorScheme", "system");
  await first.sync();

  const restarted = s.client(disk);
  expect(restarted.getItem("monocode.colorScheme")).toBe("system");
  expect(restarted.pendingCount).toBe(3);
  s.online();
  await restarted.sync();
  expect(restarted.pendingCount).toBe(0);
  expect(s.host.preferencesRead()!.values["monocode.colorScheme"]).toBe("system");
  const patches = s.calls.filter(call => call.method === "preferences.patch");
  expect(patches.map(call => (call.params.changes as Record<string, string>)["monocode.colorScheme"])).toEqual(["dark", "light", "system"]);
  expect(patches.every(call => !Object.hasOwn(call.params, "queuedAt"))).toBe(true);
});

it.each(["preferences.read", "preferences.patch"])("drains edits made while %s is in flight in the same synchronization", async heldMethod => {
  const s = fixture();
  let hold = false;
  let started!: () => void;
  let release!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const request: PreferenceRequest = async <T>(method: string, params: Record<string, unknown>) => {
    if (hold && method === heldMethod) {
      hold = false;
      started();
      await released;
    }
    return s.request<T>(method, params);
  };
  const client = new SharedPreferenceStore("host-a", s.disk, request);
  await client.sync();
  hold = true;
  client.setItem("monocode.colorScheme", "dark");
  await requestStarted;
  client.setItem("monocode.colorScheme", "light");
  const synchronization = client.sync();
  release();
  await synchronization;
  expect(client.pendingCount).toBe(0);
  expect(client.error).toBeUndefined();
  expect(s.host.preferencesRead()).toMatchObject({ revision: 2, values: { "monocode.colorScheme": "light" } });
});

it("notifies remote edits without creating another upload and imports release settings once", async () => {
  const s = fixture();
  const client = s.client();
  const changes = vi.fn(); client.subscribe(changes);
  const legacy = new MemoryStorage();
  legacy.setItem("monocode.colorScheme", "light"); legacy.setItem("monocode.deviceToken", "private-token");
  await client.importRelease(key => legacy.getItem(key));
  expect(s.host.preferencesRead()).toMatchObject({ imported: true, values: { "monocode.colorScheme": "light" } });
  expect(JSON.stringify(s.host.preferencesRead())).not.toContain("private-token");
  s.host.preferencesPatch({ operationId: "other-client", changes: { "monocode.colorScheme": "dark" } });
  const patchCount = () => s.calls.filter(call => call.method === "preferences.patch").length;
  const before = patchCount();
  await client.sync();
  expect(changes).toHaveBeenCalledWith(["monocode.colorScheme"]);
  expect(client.getItem("monocode.colorScheme")).toBe("dark");
  await client.importRelease(key => legacy.getItem(key));
  expect(patchCount()).toBe(before);
  expect(client.getItem("monocode.colorScheme")).toBe("dark");
});

it("keeps unsupported Host failures visible and never silently discards pending edits", async () => {
  const disk = new MemoryStorage();
  const request: PreferenceRequest = async () => { throw new Error("Unsupported host method"); };
  const client = new SharedPreferenceStore("old-host", disk, request);
  client.setItem("monocode.colorScheme", "light");
  await client.sync();
  expect(client.error).toBe("Unsupported host method");
  expect(client.pendingCount).toBe(1);
  expect(new SharedPreferenceStore("old-host", disk, request).getItem("monocode.colorScheme")).toBe("light");
});

it("does not acknowledge an edit that could not be persisted", async () => {
  const s = fixture();
  const client = s.client();
  await client.sync();
  vi.spyOn(s.disk, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
  expect(() => client.setItem("monocode.colorScheme", "light")).toThrow("quota exceeded");
  expect(client.getItem("monocode.colorScheme")).toBeNull();
  expect(client.pendingCount).toBe(0);
  expect(client.error).toBe("Could not save pending settings.");
});

it("keeps view state on each device while still accepting it from older clients", async () => {
  const s = fixture();
  const local = new MemoryStorage();
  vi.stubGlobal("localStorage", local);
  cleanups.push(() => { activatePreferenceStore(undefined); vi.unstubAllGlobals(); });
  // An older client still journals the formerly shared key; the Host must not reject it.
  s.host.preferencesPatch({ operationId: "older-client", changes: { "monocode.sidebarWidth": "320", "monocode.themeHue": "40" } });
  const store = s.client();
  await store.sync();
  activatePreferenceStore(store);
  adoptDeviceLocalPreferences(store, false);
  expect(local.getItem("monocode.sidebarWidth")).toBe("320");

  preferenceStorage.setItem("monocode.sidebarWidth", "280");
  preferenceStorage.setItem("monocode.themeHue", "90");
  await store.sync();
  expect(s.host.preferencesRead()!.values).toMatchObject({ "monocode.sidebarWidth": "320", "monocode.themeHue": "90" });
  expect(preferenceStorage.getItem("monocode.sidebarWidth")).toBe("280");

  // Adoption runs once; later Host copies never overwrite this device again.
  local.removeItem("monocode.sidebarWidth");
  adoptDeviceLocalPreferences(store, false);
  expect(local.getItem("monocode.sidebarWidth")).toBeNull();
});
