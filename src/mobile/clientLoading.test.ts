import { describe, expect, it, vi } from "vitest";
import { HostRequestError, MobileClient, type RpcTransport } from "./client";
import type { MobileStorage } from "./storage";
import type { HostSession } from "../features/connections/model/protocol";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function snapshot(revision = 1, id = "session"): HostSession {
  return {
    projectId: "project", revision, status: "idle", updatedAt: revision,
    session: {
      id, title: "Conversation", cwd: "/project", harness: "codex",
      model: "codex:test", modelSettings: {}, runtimeMode: "supervised",
      blocks: [{ id: "prompt", role: "user", text: "Visible text", attachments: [
        { id: "image", name: "photo.png", kind: "image", mimeType: "image/png", size: 3 },
      ] }],
    },
  };
}
async function setup(handler: (method: string, params: any) => unknown) {
  const values = new Map<string, string>();
  const storage: MobileStorage = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
  const rpc: RpcTransport = vi.fn(async (endpoint, _token, request) => {
    const { method, params } = request as { method: string; params: any };
    return method === "environment.describe"
      ? { protocolVersion: 1, environmentId: endpoint, name: "Host", providers: ["codex"] }
      : handler(method, params);
  });
  const client = new MobileClient(storage, rpc);
  await client.connect("http://first-host", "123");
  return { client, rpc };
}

describe("mobile loading critical path", () => {
  it("loads a global catalog without a project and keeps its cache separate", async () => {
    const { client, rpc } = await setup((_method, params) => ({ models: {}, errors: params.projectId ? { codex: params.projectId } : {} }));
    const global = await client.models();
    expect(await client.models()).toBe(global);
    await client.models("project");
    expect(client.cachedModels()).toBe(global);
    expect(client.cachedModels("project")?.errors.codex).toBe("project");
    const calls = (rpc as ReturnType<typeof vi.fn>).mock.calls.filter((call) => (call[2] as any).method === "models.list");
    expect(calls.map((call) => (call[2] as any).params)).toEqual([{}, { projectId: "project" }]);
    await client.models(undefined, true);
    expect(client.cachedModels()).not.toBe(global);
  });

  it("distinguishes an old Host's missing account method from network and authentication errors", async () => {
    const { client } = await setup(() => { throw new HostRequestError("Unsupported host method", 400); });
    expect(await client.providerAccounts()).toBeNull();
    const offline = await setup(() => { throw new Error("Network offline"); });
    await expect(offline.client.providerAccounts()).rejects.toThrow("Network offline");
    const denied = await setup(() => { throw new HostRequestError("Unauthorized", 401); });
    await expect(denied.client.providerAccounts()).rejects.toThrow("Unauthorized");
  });

  it.each(["switch", "disconnect", "reconnect"])("rejects late account and global model responses after %s", async (action) => {
    const late = deferred<any>();
    const { client } = await setup(() => late.promise);
    const accounts = client.providerAccounts();
    const models = client.models();
    if (action === "switch") await client.connect("http://second-host", "123");
    else if (action === "disconnect") await client.disconnect();
    else await client.reconnect();
    late.resolve({ models: {}, errors: {} });
    await expect(accounts).rejects.toThrow("Host connection changed.");
    await expect(models).rejects.toThrow("Host connection changed.");
    expect(client.cachedModels()).toBeUndefined();
  });
  it("returns text while an image download is unresolved", async () => {
    const image = deferred<any>();
    const { client } = await setup((method) => method === "attachments.read"
      ? image.promise : { kind: "snapshot", value: snapshot() });
    let result: HostSession | undefined;
    const read = client.session("session").then((value) => { result = value; });
    await vi.waitFor(() => expect(result?.session.blocks[0].text).toBe("Visible text"));
    expect(result?.session.blocks[0].attachments?.[0].data).toBeUndefined();
    const hydration = client.sessionPreviews("session");
    image.resolve({ data: "YWJj", size: 3, offset: 3 });
    await read;
    expect((await hydration)?.session.blocks[0].attachments?.[0].data).toBe("YWJj");
  });

  it("shares concurrent navigation and poll reads with one delta base", async () => {
    const sync = deferred<any>();
    const { client, rpc } = await setup(() => sync.promise);
    const first = client.session("session");
    const second = client.session("session");
    sync.resolve({ kind: "snapshot", value: snapshot() });
    expect(await first).toBe(await second);
    expect((rpc as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      (call[2] as any).method === "sessions.sync")).toHaveLength(1);
    expect(client.cachedSession("session")).toBe(await first);
  });

  it("keeps two conversations' image bytes while retaining older text and rehydrating on return", async () => {
    const { client, rpc } = await setup((method, params) => {
      if (method === "attachments.read") return { data: "YWJj", size: 3, offset: 3 };
      const value = snapshot(1, params.sessionId);
      // Nested agent output needs the same memory budget as top-level images.
      value.session.blocks.push({ id: "agent", role: "tool", text: "Explore", agentRun: {
        name: "Explore", steps: [], transcript: [{ ...value.session.blocks[0], id: "nested" }],
      } });
      return { kind: "snapshot", value };
    });
    await client.session("first");
    const retained = await client.sessionPreviews("first");
    for (const id of ["second", "third"]) {
      await client.session(id);
      await client.sessionPreviews(id);
    }
    expect(client.cachedSession("second")?.session.blocks[0].attachments?.[0].data).toBe("YWJj");
    expect(client.cachedSession("third")?.session.blocks[0].attachments?.[0].data).toBe("YWJj");
    const older = client.cachedSession("first")!;
    expect(older.session.blocks[0].text).toBe("Visible text");
    expect(older.session.blocks[0].attachments?.[0]).toEqual(snapshot().session.blocks[0].attachments?.[0]);
    expect(older.session.blocks[1].agentRun?.transcript?.[0].attachments?.[0].data).toBeUndefined();
    // Stripping the cache never mutates a departing page's retained snapshot.
    expect(retained?.session.blocks[0].attachments?.[0].data).toBe("YWJj");
    expect((await client.sessionPreviews("first"))?.session.blocks[0].attachments?.[0].data).toBe("YWJj");
    const images = (rpc as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      (call[2] as any).method === "attachments.read");
    expect(images).toHaveLength(4);
  });

  it("does not restore evicted preview bytes when an old image transfer completes", async () => {
    const image = deferred<any>();
    const { client } = await setup((method, params) => method === "attachments.read"
      ? image.promise : { kind: "snapshot", value: snapshot(1, params.sessionId) });
    await client.session("first");
    const pending = client.sessionPreviews("first");
    await client.session("second");
    await client.session("third");
    image.resolve({ data: "YWJj", size: 3, offset: 3 });
    expect(await pending).toBeUndefined();
    expect(client.cachedSession("first")?.session.blocks[0].attachments?.[0].data).toBeUndefined();
    expect((await client.sessionPreviews("first"))?.session.blocks[0].attachments?.[0].data).toBe("YWJj");
  });

  it("does not reuse completed image data when another Host has the same session and attachment IDs", async () => {
    let data = "YWJj";
    const { client, rpc } = await setup((method, params) => method === "attachments.read"
      ? { data, size: 3, offset: 3 } : { kind: "snapshot", value: snapshot(1, params.sessionId) });
    await client.session("session");
    await client.sessionPreviews("session");
    await client.connect("http://second-host", "123");
    data = "ZGVm";
    expect((await client.session("session")).session.blocks[0].attachments?.[0].data).toBeUndefined();
    expect((await client.sessionPreviews("session"))?.session.blocks[0].attachments?.[0].data).toBe("ZGVm");
    const images = (rpc as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      (call[2] as any).method === "attachments.read");
    expect(images).toHaveLength(2);
  });

  it("merges late image bytes into the newest revision without restoring removed blocks", async () => {
    const image = deferred<any>();
    let value = snapshot();
    const { client } = await setup((method) => method === "attachments.read"
      ? image.promise : { kind: "snapshot", value });
    await client.session("session");
    const hydration = client.sessionPreviews("session");
    value = snapshot(2);
    value.session.blocks[0].text = "Newer text";
    value.session.blocks.push({ id: "reply", role: "assistant", text: "New reply" });
    await client.session("session");
    image.resolve({ data: "YWJj", size: 3, offset: 3 });
    const hydrated = await hydration;
    expect(hydrated?.revision).toBe(2);
    expect(hydrated?.session.blocks.map((block) => block.text)).toEqual(["Newer text", "New reply"]);
    expect(hydrated?.session.blocks[0].attachments?.[0].data).toBe("YWJj");
    value = snapshot(3);
    value.session.blocks = [];
    await client.session("session");
    expect(client.cachedSession("session")?.session.blocks).toEqual([]);
  });

  it.each(["disconnect", "switch", "delete"] as const)("invalidates late session writes after %s", async (action) => {
    const sync = deferred<any>();
    const { client } = await setup((method) => method === "sessions.delete" ? {} : sync.promise);
    const pending = client.session("session");
    if (action === "disconnect") await client.disconnect();
    if (action === "switch") await client.connect("http://second-host", "123");
    if (action === "delete") await client.deleteSession("project", "session");
    sync.resolve({ kind: "snapshot", value: snapshot() });
    await expect(pending).rejects.toThrow();
    expect(client.cachedSession("session")).toBeUndefined();
  });

  it.each(["disconnect", "switch", "delete"] as const)("discards late image hydration after %s", async (action) => {
    const image = deferred<any>();
    const { client } = await setup((method) => method === "attachments.read" ? image.promise
      : method === "sessions.delete" ? {} : { kind: "snapshot", value: snapshot() });
    await client.session("session");
    const pending = client.sessionPreviews("session");
    if (action === "disconnect") await client.disconnect();
    if (action === "switch") await client.connect("http://second-host", "123");
    if (action === "delete") await client.deleteSession("project", "session");
    image.resolve({ data: "YWJj", size: 3, offset: 3 });
    expect(await pending).toBeUndefined();
    expect(client.cachedSession("session")).toBeUndefined();
  });

  it("reads at least the command receipt revision when an older poll is still in flight", async () => {
    const old = deferred<any>();
    let requests = 0;
    const { client } = await setup(() => ++requests === 1 ? old.promise
      : { kind: "snapshot", value: snapshot(2) });
    const poll = client.session("session");
    const afterCommand = client.session("session", 2);
    old.resolve({ kind: "snapshot", value: snapshot() });
    expect((await poll).revision).toBe(1);
    expect((await afterCommand).revision).toBe(2);
    expect(requests).toBe(2);
  });

  it("keeps frequently read sessions and evicts the least recently read snapshot", async () => {
    const { client } = await setup((_method, params) => ({ kind: "snapshot", value: snapshot(1, params.sessionId) }));
    for (let index = 0; index < 8; index++) await client.session(`session-${index}`);
    expect(client.cachedSession("session-0")).toBeDefined();
    await client.session("session-8");
    expect(client.cachedSession("session-0")).toBeDefined();
    expect(client.cachedSession("session-1")).toBeUndefined();
  });

  it("deduplicates project model discovery and reuses the catalog", async () => {
    const catalog = deferred<any>();
    const { client, rpc } = await setup(() => catalog.promise);
    const first = client.models("project");
    const second = client.models("project");
    const value = { models: {}, errors: {} };
    catalog.resolve(value);
    expect(await first).toBe(await second);
    expect(await client.models("project")).toBe(value);
    expect(client.cachedModels("project")).toBe(value);
    expect((rpc as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      (call[2] as any).method === "models.list")).toHaveLength(1);
  });

  it("keeps stale catalogs visible and retries provider errors sooner", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      let requests = 0;
      let errors = true;
      const { client } = await setup(() => {
        requests++;
        return { models: {}, errors: errors ? { codex: "Not signed in" } : {} };
      });
      await client.models("project");
      expect(client.cachedModels("project")?.errors).toEqual({ codex: "Not signed in" });
      await client.models("project");
      expect(requests).toBe(1);
      errors = false;
      now.mockReturnValue(16_000);
      await client.models("project");
      expect(requests).toBe(2);
      now.mockReturnValue(61_000);
      expect(client.cachedModels("project")).toBeDefined();
      await client.models("project");
      expect(requests).toBe(2);
      now.mockReturnValue(317_000);
      expect(client.cachedModels("project")).toBeDefined();
      await client.models("project");
      expect(requests).toBe(3);
    } finally { now.mockRestore(); }
  });

  it("does not reuse a warmed catalog across Hosts or retain its late response", async () => {
    const late = deferred<any>();
    const value = { models: {}, errors: {} };
    const { client } = await setup((_method, params) =>
      params.projectId === "pending-project" ? late.promise : value);
    await client.models("project");
    const pending = client.models("pending-project");
    await client.connect("http://second-host", "123");
    expect(client.cachedModels("project")).toBeUndefined();
    late.resolve(value);
    await expect(pending).rejects.toThrow("Host connection changed.");
    expect(client.cachedModels("pending-project")).toBeUndefined();
  });
});
