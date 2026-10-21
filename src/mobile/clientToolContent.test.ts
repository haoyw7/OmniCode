import { afterEach, expect, it, vi } from "vitest";
import { HostRequestError, MobileClient, type RpcTransport } from "./client";
import type { MobileOfflineCache, OfflineCacheEntry, OfflineCacheKind } from "./offlineCache";
import { TOOL_CONTENT_CAPABILITY, TOOL_CONTENT_MODE, type ToolContentPage, type ToolContentRequest } from "../integrations/harness/core/toolContent";
import type { HostSession } from "../features/connections/model/protocol";
import { queryClient } from "../shared/lib/queryClient";

afterEach(() => { queryClient.clear(); vi.useRealTimers(); });
const request: ToolContentRequest = { sessionId: "s", blockPath: ["tool"], field: "output", version: "v1", tail: true };
const page: ToolContentPage = { ...request, field: "output", version: "v1", transfer: "transfer", start: 0, end: 6, total: 6, text: "opened", running: true };
const snapshot: HostSession = { contentMode: TOOL_CONTENT_MODE, projectId: "p", revision: 1, updatedAt: 1, status: "idle",
  session: { id: "s", title: "Session", cwd: "/p", harness: "codex", model: "codex:m", modelSettings: {}, runtimeMode: "supervised", blocks: [] } };

function setup() {
  vi.useFakeTimers();
  const entries = new Map<string, OfflineCacheEntry>();
  const key = (host: string, kind: OfflineCacheKind, id: string) => JSON.stringify([host, kind, id]);
  const cache: MobileOfflineCache = {
    readHost: vi.fn(async host => [...entries].filter(([id, value]) => id.startsWith(`[${JSON.stringify(host)},`) && value.kind !== "toolContent").map(([, value]) => value)),
    readEntry: vi.fn(async (host, kind, id) => entries.get(key(host, kind, id))?.value),
    write: vi.fn(async (host, writes) => { for (const entry of writes) if (entry.value !== undefined) entries.set(key(host, entry.kind, entry.id), { ...entry, value: entry.value }); }),
    removeHost: vi.fn(async host => { for (const id of entries.keys()) if (id.startsWith(`[${JSON.stringify(host)},`)) entries.delete(id); }),
    removeEntries: vi.fn(async (host, kind, prefix) => { for (const [id, entry] of entries) if (id.startsWith(`[${JSON.stringify(host)},`) && entry.kind === kind && (kind === "toolContent" ? entry.id.startsWith(prefix) : entry.id === prefix)) entries.delete(id); }),
  };
  let failure: Error | undefined;
  let pending: Promise<ToolContentPage> | undefined;
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const transport: RpcTransport = async (endpoint, _token, input) => {
    const call = input as typeof calls[number]; calls.push(call);
    if (call.method === "environment.describe") return { protocolVersion: 1, environmentId: endpoint, name: "Host", providers: ["codex"], capabilities: [TOOL_CONTENT_CAPABILITY] };
    if (call.method === "sessions.sync") return { kind: "snapshot", contentMode: TOOL_CONTENT_MODE, value: snapshot };
    if (call.method === "sessions.delete") return { deleted: true };
    if (failure) throw failure;
    if (pending) return pending;
    return page;
  };
  const client = () => {
    const values = new Map<string, string>();
    return new MobileClient({ get: async k => values.get(k) ?? null, set: async (k, v) => { values.set(k, v); }, remove: async k => { values.delete(k); } }, transport, cache);
  };
  return { client, cache, calls, entries, fail: (value?: Error) => { failure = value; }, hold: (value: Promise<ToolContentPage>) => { pending = value; } };
}

it("negotiates reference sync and restores only previously opened pages offline", async () => {
  const s = setup(), client = s.client();
  await client.connect("http://a", "token");
  await client.session("s");
  expect(s.calls.find(call => call.method === "sessions.sync")?.params).toMatchObject({ contentMode: TOOL_CONTENT_MODE });
  expect(s.cache.readEntry).not.toHaveBeenCalled();
  const source = client.toolContentSource("s")!;
  expect(await source.read(request)).toEqual(page);
  s.fail(new Error("network offline"));
  // The coalesced write has not reached IndexedDB yet.
  expect(await source.read(request)).toMatchObject({ text: "opened", running: false });
  expect(client.getConnectionStatus().state).toBe("connected");
  await client.flushOfflineCache();
  const reopened = s.client();
  await reopened.connect("http://a", "token");
  const reads = vi.mocked(s.cache.readEntry!).mock.calls.length;
  expect(reopened.cachedSession("s")?.contentMode).toBe(TOOL_CONTENT_MODE);
  expect(vi.mocked(s.cache.readEntry!).mock.calls).toHaveLength(reads);
  expect(await reopened.toolContentSource("s")!.read(request)).toMatchObject({ text: "opened" });
  await expect(reopened.toolContentSource("s")!.read({ ...request, offset: 2, tail: false })).rejects.toThrow("offline");
  await reopened.flushOfflineCache();
});

it("never falls back to cached details on auth failures or across Hosts", async () => {
  const s = setup(), client = s.client();
  await client.connect("http://a", "token");
  const source = client.toolContentSource("s")!;
  await source.read(request); await client.flushOfflineCache();
  s.fail(new HostRequestError("Revoked", 401));
  await expect(source.read(request)).rejects.toThrow("Revoked");
  expect(client.getConnectionStatus().state).toBe("connected");
  await client.connect("http://b", "token");
  await expect(source.read(request)).rejects.toThrow("changed");
  s.fail(new Error("offline"));
  await expect(client.toolContentSource("s")!.read(request)).rejects.toThrow("offline");
});

it("deletes persisted pages and rejects a late response after session deletion", async () => {
  const s = setup(), client = s.client();
  await client.connect("http://a", "token");
  const source = client.toolContentSource("s")!;
  await source.read(request); await client.flushOfflineCache();
  let finish!: (page: ToolContentPage) => void;
  s.hold(new Promise(resolve => { finish = resolve; }));
  const pending = source.read(request);
  const rejected = expect(pending).rejects.toThrow("changed");
  await client.rpc("sessions.delete", { sessionId: "s", projectId: "p" });
  finish(page); await rejected; await client.flushOfflineCache();
  expect([...s.entries.values()].filter(entry => entry.kind === "toolContent")).toHaveLength(0);
  expect(s.cache.removeEntries).toHaveBeenCalledWith("http://a", "toolContent", '"s":');
});
