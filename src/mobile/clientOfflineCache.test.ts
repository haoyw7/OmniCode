import { afterEach, expect, it, vi } from "vitest";
import { MobileClient, type RpcTransport } from "./client";
import type { HostSession } from "../features/connections/model/protocol";
import type { MobileStorage } from "./storage";
import type { MobileOfflineCache, OfflineCacheEntry } from "./offlineCache";

afterEach(() => { vi.useRealTimers(); });
const snapshot = (id: string, revision = 1): HostSession => ({
  projectId: "p", revision, updatedAt: revision, status: "idle",
  session: { id, title: id, cwd: "/p", harness: "codex", model: "codex:m", modelSettings: {},
    runtimeMode: "supervised", blocks: [{ id: "answer", role: "assistant", text: `revision ${revision}` }] },
});
function setup(cache: MobileOfflineCache, request?: RpcTransport) {
  const values = new Map<string, string>();
  const storage: MobileStorage = {
    get: async key => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async key => { values.delete(key); },
  };
  return new MobileClient(storage, request ?? (async endpoint =>
    ({ protocolVersion: 1, environmentId: endpoint, name: endpoint, providers: ["codex"] })), cache);
}

it("ignores a previous Host's late disk restore after switching", async () => {
  let release!: (entries: OfflineCacheEntry[]) => void;
  const old = new Promise<OfflineCacheEntry[]>(resolve => { release = resolve; });
  const cache: MobileOfflineCache = {
    readHost: vi.fn(host => host === "http://a" ? old : Promise.resolve([
      { kind: "session", id: "b", value: snapshot("b") },
    ])),
    write: vi.fn(async () => {}), removeHost: vi.fn(async () => {}),
  };
  const client = setup(cache);
  const connecting = client.connect("http://a", "token");
  await vi.waitFor(() => expect(cache.readHost).toHaveBeenCalledWith("http://a"));
  await client.connect("http://b", "token");
  release([{ kind: "session", id: "a", value: snapshot("a") }]);
  await connecting;
  expect(client.connection?.environmentId).toBe("http://b");
  expect(client.cachedSession("a")).toBeUndefined();
  expect(client.cachedSession("b")?.session.title).toBe("b");
});

it("coalesces streaming revisions, strips nested attachment bytes, and keeps the cached history's list entry", async () => {
  vi.useFakeTimers();
  const cache: MobileOfflineCache = {
    readHost: async () => [], write: vi.fn(async () => {}), removeHost: async () => {},
  };
  let revision = 1;
  const client = setup(cache, async (endpoint, _token, input) => {
    const { method } = input as { method: string };
    if (method === "environment.describe") return { protocolVersion: 1, environmentId: endpoint, name: "A", providers: ["codex"] };
    if (method === "sessions.list") return Array.from({ length: 150 }, (_, i) => ({
      id: `s${i}`, title: `s${i}`, projectId: "p", revision: 1, status: "idle", updatedAt: 1, harness: "codex",
    }));
    const value = snapshot("s149", revision);
    value.session.blocks.push({ id: "tool", role: "tool", text: "Search", agentRun: {
      name: "Worker", steps: [], transcript: [{ id: "image", role: "image", text: "", attachments: [
        { id: "image", name: "image.png", kind: "image", mimeType: "image/png", size: 3, data: "YWJj", previewUrl: "blob:old" },
      ] }],
    } });
    return { kind: "snapshot", value };
  });
  await client.connect("http://a", "token");
  await client.sessions("p");
  await client.session("s149");
  revision = 2;
  await client.session("s149");
  expect(cache.write).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(cache.write).toHaveBeenCalledTimes(1);
  const writes = vi.mocked(cache.write).mock.calls[0][1];
  const saved = writes.find(row => row.kind === "session")!.value as HostSession;
  expect(saved.revision).toBe(2);
  expect(saved.session.blocks[1].agentRun!.transcript![0].attachments![0]).not.toHaveProperty("data");
  expect(saved.session.blocks[1].agentRun!.transcript![0].attachments![0]).not.toHaveProperty("previewUrl");
  const histories = writes.find(row => row.kind === "summaries")!.value as [string, { id: string }[]][];
  expect(histories[0][1]).toHaveLength(100);
  expect(histories[0][1].some(row => row.id === "s149")).toBe(true);
});

it("ignores malformed cached contents and deletes saved data after a Host identity mismatch", async () => {
  let identity = "http://a";
  const cache: MobileOfflineCache = {
    readHost: async () => [
      { kind: "session", id: "bad", value: { ...snapshot("bad"), session: { ...snapshot("bad").session, blocks: [null] } } },
      { kind: "models", id: "null", value: { models: { codex: [null] }, errors: {} } },
      { kind: "session", id: "good", value: snapshot("good") },
    ],
    write: async () => {}, removeHost: vi.fn(async () => {}),
  };
  const client = setup(cache, async () => ({ protocolVersion: 1, environmentId: identity, name: "Host", providers: ["codex"] }));
  await client.connect("http://a", "token");
  expect(client.cachedSession("bad")).toBeUndefined();
  expect(client.cachedModels()).toBeUndefined();
  expect(client.cachedSession("good")).toBeDefined();
  identity = "replaced-host";
  await expect(client.verify()).rejects.toThrow("identity changed");
  expect(client.cachedSession("good")).toBeUndefined();
  expect(cache.removeHost).toHaveBeenCalledWith("http://a");
});
