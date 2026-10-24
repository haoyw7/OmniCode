import { HostRequestError, nativeTransport, type RpcTransport } from "./hostTransport";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readMobileDeviceInfo } from "./deviceInfo";
import { setUiLanguage } from "../shared/i18n/language";
import { MobileClient, normalizeHostUrl } from "./client";
import type { MobileStorage, StorageKey } from "./storage";
import type { HostSession, HostCommand, HostSessionSummary } from "../contracts/protocol";
import { REMOTE_PROVIDERS } from "../contracts/provider";
import { readSessionCache, saveSessionCache, SESSION_CACHE_KEY, SESSION_CACHE_PROJECT_LIMIT, SESSION_CACHE_SESSION_LIMIT, SESSION_CACHE_SIZE_LIMIT } from "./sessionCache";

vi.mock("./deviceInfo", () => ({ readMobileDeviceInfo: vi.fn(async () => undefined) }));
const http = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: http,
}));
const endpoint = "https://my-computer.example.ts.net";
const token = "123";
const descriptor = {
  protocolVersion: 1,
  environmentId: "host-1",
  name: "Computer",
  providers: ["codex"],
};
const receipt = { commandId: "command", sessionId: "session", revision: 1 };
function memory(): MobileStorage {
  const values = new Map<StorageKey, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}

it("migrates the execution directory of a persisted mobile create command", async () => {
  const storage = memory();
  await storage.set("pending", JSON.stringify({ endpoint, environmentId: "host-1", command: {
    type: "create", commandId: "legacy", projectId: "project", harness: "codex", model: "test",
    runtimeMode: "supervised", worktreeCwd: "/project/subdir",
  } }));
  const client = new MobileClient(storage, transport(() => receipt));
  const pending = await client.pending();
  expect(pending?.command).toMatchObject({ executionCwd: "/project/subdir" });
  expect(pending?.command).not.toHaveProperty("worktreeCwd");
});
function snapshot(revision = 1): HostSession {
  return {
    projectId: "project",
    revision,
    status: "running",
    runId: "run",
    updatedAt: 1,
    session: {
      id: "session",
      title: "Conversation",
      cwd: "/project",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [
        { id: "response", role: "assistant", text: "Hello", streaming: true },
      ],
    },
  };
}

it.each([false, true])("only uses sync wait when the Host advertises it (%s)", async (supported) => {
  const requests: object[] = [];
  const client = new MobileClient(memory(), async (_endpoint, _token, request) => {
    const { method, params } = request as { method: string; params: object };
    if (method === "environment.describe") return { ...descriptor, capabilities: supported ? ["sessions.sync.wait.v1"] : [] };
    requests.push(params);
    return { kind: "snapshot", value: snapshot() };
  });
  await client.connect(endpoint, token);
  await client.session("session", undefined, 1_000);
  await client.session("session", undefined, 1_000);
  expect(requests).toEqual([
    { sessionId: "session", revision: undefined },
    { sessionId: "session", revision: 1, ...(supported ? { waitMs: 1_000 } : {}) },
  ]);
});
function transport(
  handler: (
    method: string,
    params: Record<string, any>,
    request: object,
  ) => unknown,
): RpcTransport {
  return async (_endpoint, _token, request) => {
    const { method, params } = request as {
      method: string;
      params: Record<string, any>;
    };
    return method === "environment.describe"
      ? descriptor
      : handler(method, params, request);
  };
}
const send: HostCommand = {
  type: "send",
  commandId: "send-original",
  sessionId: "session",
  text: "Implement this",
};

beforeEach(() => {
  vi.clearAllMocks();
  setUiLanguage("en");
  vi.mocked(readMobileDeviceInfo).mockResolvedValue(undefined);
});
describe("mobile session summary cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
      removeItem: (key: string) => { values.delete(key); },
    });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const summary = (extra: Partial<HostSessionSummary> = {}): HostSessionSummary => ({
    id: "session", title: "Conversation", projectId: "project", harness: "codex",
    revision: 1, status: "idle", updatedAt: 100, ...extra,
  });
  const pageLifecycle = () => {
    const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const browser = new EventTarget();
    vi.stubGlobal("document", page);
    vi.stubGlobal("window", browser);
    return { page, browser };
  };

  it("reuses identical lists and rows without losing metadata updates or rewriting storage", async () => {
    let values = [summary({ nativeStatus: { state: "ready", checkedAt: 1 } }), summary({ id: "other" })];
    const client = new MobileClient(memory(), transport(() => structuredClone(values)));
    await client.connect(endpoint, token);
    const first = await client.sessions("project");
    vi.advanceTimersByTime(1000);
    vi.mocked(localStorage.setItem).mockClear();
    expect(await client.sessions("project")).toBe(first);
    expect(vi.getTimerCount()).toBe(0);
    expect(localStorage.setItem).not.toHaveBeenCalled();

    // Metadata is not covered by the transcript revision, including nested
    // native status fields which may only change while the provider is idle.
    values = [{ ...values[0], pinned: true, title: "Renamed", nativeStatus: { state: "ready", checkedAt: 2 } }, values[1]];
    const updated = await client.sessions("project");
    expect(updated).not.toBe(first);
    expect(updated[0]).toEqual(values[0]);
    expect(updated[1]).toBe(first[1]);
    values = [values[1]];
    const removed = await client.sessions("project");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(first[1]);
  });

  it("reuses project lists until their content or Host changes", async () => {
    let name = "Project";
    const client = new MobileClient(memory(), transport(() => [{ id: "project", name, cwd: "/project" }]));
    await client.connect(endpoint, token);
    const first = await client.projects();
    expect(await client.projects()).toBe(first);
    name = "Renamed";
    expect(await client.projects()).not.toBe(first);
    const changed = await client.projects();
    await client.reconnect();
    expect(await client.projects()).not.toBe(changed);
  });

  it("coalesces streaming revisions into one delayed write while keeping live summaries immediate", async () => {
    let value = snapshot();
    const client = new MobileClient(memory(), transport(() => ({ kind: "snapshot", value })));
    await client.connect(endpoint, token);
    await client.session("session");
    for (let revision = 2; revision <= 5; revision++) {
      vi.advanceTimersByTime(100);
      value = snapshot(revision);
      await client.session("session");
      expect(client.cachedSessions("project")?.[0].revision).toBe(revision);
    }
    expect(vi.getTimerCount()).toBe(1);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(599);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(readSessionCache("host-1").get("project")?.[0].revision).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
    value = snapshot(6);
    await client.session("session");
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(localStorage.setItem).toHaveBeenCalledTimes(2);
    expect(readSessionCache("host-1").get("project")?.[0].revision).toBe(6);
  });

  it.each(["visibilitychange", "pagehide"])("flushes the latest summaries on %s and cleans up pending listeners", async (event) => {
    const { page, browser } = pageLifecycle();
    const addPage = vi.spyOn(page, "addEventListener");
    const removePage = vi.spyOn(page, "removeEventListener");
    const addBrowser = vi.spyOn(browser, "addEventListener");
    const removeBrowser = vi.spyOn(browser, "removeEventListener");
    let live = [summary()];
    const store = memory();
    const client = new MobileClient(store, transport(() => live));
    await client.connect(endpoint, token);
    await client.sessions("project");
    vi.advanceTimersByTime(100);
    live = [summary({ id: "latest", revision: 2, updatedAt: 200 }), summary()];
    await client.sessions("project");
    expect(addPage).toHaveBeenCalledTimes(1);
    expect(addBrowser).toHaveBeenCalledTimes(1);
    page.dispatchEvent(new Event("visibilitychange"));
    expect(localStorage.setItem).not.toHaveBeenCalled();
    if (event === "visibilitychange") {
      page.visibilityState = "hidden";
      page.dispatchEvent(new Event(event));
    } else browser.dispatchEvent(new Event(event));
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(readSessionCache("host-1").get("project")).toEqual(live);
    expect(vi.getTimerCount()).toBe(0);
    expect(removePage).toHaveBeenCalledWith("visibilitychange", addPage.mock.calls[0][1]);
    expect(removeBrowser).toHaveBeenCalledWith("pagehide", addBrowser.mock.calls[0][1]);
    const restored = new MobileClient(store, transport(() => live));
    await restored.restore();
    expect(restored.cachedSessions("project")).toEqual(live);
    vi.advanceTimersByTime(1_000);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    // An unchanged poll needs neither a new persistence timer nor listeners.
    await client.sessions("project");
    expect(addPage).toHaveBeenCalledTimes(1);
    live = live.map((item) => ({ ...item, title: `${item.title} updated` }));
    await client.sessions("project");
    expect(addPage).toHaveBeenCalledTimes(2);
    expect(addBrowser).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_000);
    expect(localStorage.setItem).toHaveBeenCalledTimes(2);
    expect(removePage).toHaveBeenCalledTimes(2);
    expect(removeBrowser).toHaveBeenCalledTimes(2);
  });

  it.each(["disconnect", "identity change", "reconnect"])("cancels pending persistence on %s", async (action) => {
    const { page, browser } = pageLifecycle();
    const removePage = vi.spyOn(page, "removeEventListener");
    const removeBrowser = vi.spyOn(browser, "removeEventListener");
    let host = descriptor;
    let live = [summary()];
    const client = new MobileClient(memory(), async (_endpoint, _token, request) =>
      (request as { method: string }).method === "environment.describe" ? host : live);
    await client.connect(endpoint, token);
    await client.sessions("project");
    vi.advanceTimersByTime(1_000);
    expect(readSessionCache("host-1").get("project")).toEqual(live);
    live = [summary({ revision: 2, updatedAt: 200 })];
    await client.sessions("project");
    if (action === "disconnect") await client.disconnect();
    else if (action === "identity change") {
      host = { ...descriptor, environmentId: "host-2" };
      await expect(client.verify()).rejects.toThrow("Host identity changed");
    } else await client.reconnect();
    expect(vi.getTimerCount()).toBe(0);
    expect(removePage).toHaveBeenCalledTimes(2);
    expect(removeBrowser).toHaveBeenCalledTimes(2);
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    browser.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(1_000);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    if (action === "reconnect") expect(readSessionCache("host-1").get("project")?.[0].revision).toBe(1);
    else expect(localStorage.getItem(SESSION_CACHE_KEY)).toBeNull();
  });

  it("restores lists synchronously for the same Host and replaces saved previews with live data", async () => {
    const store = memory();
    let live = [summary({ pinned: true, status: "running", lastUserMessageAt: 50 }), summary({ id: "archive", archived: true })];
    const rpc = vi.fn(transport(() => live));
    const client = new MobileClient(store, rpc);
    await client.connect(endpoint, token);
    expect(client.cachedSessions("project")).toBeUndefined();
    expect(await client.sessions("project")).toEqual(live);
    expect(client.cachedSessions("project")).toEqual(live);
    vi.advanceTimersByTime(1_000);
    const restored = new MobileClient(store, rpc);
    await restored.restore();
    expect(restored.cachedSessions("project")).toEqual(live);
    expect(rpc.mock.calls.filter((call) => (call[2] as { method: string }).method === "sessions.list")).toHaveLength(1);
    live = [];
    await restored.sessions("project");
    vi.advanceTimersByTime(1_000);
    const empty = new MobileClient(store, rpc);
    await empty.restore();
    expect(empty.cachedSessions("project")).toEqual([]);
    expect(empty.cachedSessions("unknown")).toBeUndefined();
  });

  it("ignores another Host's summaries and invalidates pending requests on connection changes", async () => {
    let host = descriptor;
    let resolve!: (value: HostSessionSummary[]) => void;
    let pending = false;
    const client = new MobileClient(memory(), async (_endpoint, _token, request) =>
      (request as { method: string }).method === "environment.describe" ? host
        : pending ? new Promise<HostSessionSummary[]>((done) => { resolve = done; }) : [summary()]);
    await client.connect(endpoint, token);
    await client.sessions("project");
    vi.advanceTimersByTime(1_000);
    pending = true;
    const request = client.sessions("project");
    host = { ...descriptor, environmentId: "host-2" };
    await client.connect("https://other-computer.example", token);
    expect(client.cachedSessions("project")).toBeUndefined();
    resolve([summary()]);
    await expect(request).rejects.toThrow("Host connection changed");
    expect(client.cachedSessions("project")).toBeUndefined();
  });

  it("coalesces concurrent list reads while allowing a fresh read after metadata mutations", async () => {
    const responses: ((value: HostSessionSummary[]) => void)[] = [];
    const updated = summary({ revision: 2, title: "Renamed", pinned: true, archived: true });
    const client = new MobileClient(memory(), transport((method) => {
      if (method === "sessions.list") return new Promise<HostSessionSummary[]>((done) => { responses.push(done); });
      if (method === "sessions.update") return updated;
      return { deleted: true };
    }));
    await client.connect(endpoint, token);
    const older = client.sessions("project");
    expect(client.sessions("project")).toBe(older);
    expect(responses).toHaveLength(1);
    responses[0]([summary()]);
    expect(await older).toEqual([summary()]);
    const beforeEdit = client.sessions("project");
    await client.updateSession("project", "session", { title: "Renamed", pinned: true, archived: true });
    const afterEdit = client.sessions("project");
    expect(afterEdit).not.toBe(beforeEdit);
    responses[2]([updated]);
    await afterEdit;
    responses[1]([summary()]);
    expect(await beforeEdit).toEqual([updated]);
    vi.advanceTimersByTime(1_000);
    expect(readSessionCache("host-1").get("project")).toEqual([updated]);
  });

  it("coalesces project loads and rejects an old Host response without replacing the new pending load", async () => {
    const responses: ((value: { id: string; name: string; cwd: string }[]) => void)[] = [];
    const client = new MobileClient(memory(), transport(() => new Promise((resolve) => { responses.push(resolve); })));
    await client.connect(endpoint, token);
    const old = client.projects();
    expect(client.projects()).toBe(old);
    expect(responses).toHaveLength(1);
    await client.connect("https://other-computer.example", token);
    const current = client.projects();
    responses[0]([{ id: "old", name: "Old Host", cwd: "/old" }]);
    await expect(old).rejects.toThrow("Host connection changed");
    expect(client.projects()).toBe(current);
    responses[1]([{ id: "new", name: "New Host", cwd: "/new" }]);
    expect(await current).toEqual([{ id: "new", name: "New Host", cwd: "/new" }]);
  });

  it("refreshes after opening a project even if an older project list is still pending", async () => {
    const project = { id: "project", name: "Project", cwd: "/project" };
    const responses: ((value: typeof project[]) => void)[] = [];
    const client = new MobileClient(memory(), transport((method) => method === "projects.open" ? project
      : new Promise((resolve) => { responses.push(resolve); })));
    await client.connect(endpoint, token);
    const beforeOpen = client.projects();
    await client.openProject(project.cwd);
    const afterOpen = client.projects();
    expect(afterOpen).not.toBe(beforeOpen);
    responses[0]([]);
    responses[1]([project]);
    expect(await beforeOpen).toEqual([project]);
    expect(await afterOpen).toEqual([project]);
  });

  it("remembers new and updated conversations from sync before the next list refresh", async () => {
    const value = snapshot();
    value.session.blocks = [{ id: "user", role: "user", text: "Hello", sentAt: 90 }];
    const client = new MobileClient(memory(), transport(() => ({ kind: "snapshot", value })));
    await client.connect(endpoint, token);
    await client.session("session");
    expect(client.cachedSessions("project")).toEqual([summary({ status: "running", updatedAt: 1, lastUserMessageAt: 90, activityAt: 90 })]);
    vi.advanceTimersByTime(1_000);
    expect(readSessionCache("host-1").get("project")).toEqual(client.cachedSessions("project"));
    value.revision = 2;
    value.updatedAt = 200;
    value.status = "idle";
    value.session.blocks.push({ id: "answer", role: "assistant", text: "Done", sentAt: 150 });
    await client.session("session");
    expect(client.cachedSessions("project")?.[0]).toMatchObject({ revision: 2, updatedAt: 200, status: "idle", activityAt: 150 });
    vi.advanceTimersByTime(1_000);
    const restored = new MobileClient(memory(), transport(() => []));
    await restored.connect(endpoint, token);
    expect(restored.cachedSessions("project")?.[0]).toMatchObject({ status: "idle", activityAt: 150 });
  });

  it("keeps a newer live revision when a metadata response arrives late", async () => {
    let resolve!: (value: HostSessionSummary) => void;
    const latest = summary({ revision: 3, pinned: true, title: "Renamed later" });
    const client = new MobileClient(memory(), transport((method) => method === "sessions.update"
      ? new Promise<HostSessionSummary>((done) => { resolve = done; }) : [latest]));
    await client.connect(endpoint, token);
    const edit = client.updateSession("project", "session", { pinned: true });
    await client.sessions("project");
    resolve(summary({ revision: 2, pinned: true }));
    expect(await edit).toEqual(latest);
    expect(client.cachedSessions("project")).toEqual([latest]);
    vi.advanceTimersByTime(1_000);
    expect(readSessionCache("host-1").get("project")).toEqual([latest]);
  });

  it("merges sync updates during a list request without losing other conversations", async () => {
    let resolve!: (value: HostSessionSummary[]) => void;
    const value = snapshot(2);
    const client = new MobileClient(memory(), transport((method) => method === "sessions.list"
      ? new Promise<HostSessionSummary[]>((done) => { resolve = done; }) : { kind: "snapshot", value }));
    await client.connect(endpoint, token);
    const list = client.sessions("project");
    await client.session("session");
    resolve([summary({ id: "other" }), summary()]);
    expect(await list).toEqual([
      summary({ id: "other" }), summary({ revision: 2, status: "running", updatedAt: 1, lastUserMessageAt: null, activityAt: null }),
    ]);
    expect(client.cachedSessions("project")).toHaveLength(2);
  });

  it("bounds stored projects, conversations and payload while retaining each project's newest activity", () => {
    const sessions = Array.from({ length: SESSION_CACHE_SESSION_LIMIT + 10 }, (_, index) =>
      summary({ id: `pin-${index}`, pinned: true, updatedAt: index }));
    sessions.push(summary({ id: "latest", updatedAt: 1000 }));
    saveSessionCache("host-1", new Map([["project", sessions]]));
    const restored = readSessionCache("host-1").get("project")!;
    expect(restored).toHaveLength(SESSION_CACHE_SESSION_LIMIT);
    expect(restored.some((item) => item.id === "latest")).toBe(true);
    saveSessionCache("host-1", new Map(Array.from({ length: SESSION_CACHE_PROJECT_LIMIT + 1 }, (_, i) => [`p${i}`, []])));
    expect(readSessionCache("host-1").size).toBe(SESSION_CACHE_PROJECT_LIMIT);
    expect(readSessionCache("host-1").has("p0")).toBe(false);
    saveSessionCache("host-1", new Map([["project", sessions.map((item) => ({ ...item, title: "x".repeat(16_000) }))]]));
    expect(localStorage.getItem(SESSION_CACHE_KEY)!.length).toBeLessThanOrEqual(SESSION_CACHE_SIZE_LIMIT);
    expect(readSessionCache("host-1").get("project")!.length).toBeGreaterThan(0);
  });

  it("ignores corrupt storage and keeps runtime caching usable when storage throws", async () => {
    for (const value of [
      "{broken",
      ...[summary({ status: "invalid" as "idle" }), summary({ updatedAt: 1e100 })].map((item) =>
        JSON.stringify({ environmentId: "host-1", projects: [{ projectId: "project", sessions: [item] }] })),
      "x".repeat(SESSION_CACHE_SIZE_LIMIT + 1),
    ]) {
      localStorage.setItem(SESSION_CACHE_KEY, value);
      expect(readSessionCache("host-1").size).toBe(0);
    }
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    const client = new MobileClient(memory(), transport(() => [summary()]));
    await client.connect(endpoint, token);
    await client.sessions("project");
    expect(client.cachedSessions("project")).toEqual([summary()]);
    vi.advanceTimersByTime(1_000);
    expect(client.cachedSessions("project")).toEqual([summary()]);
    await client.disconnect();
    expect(client.cachedSessions("project")).toBeUndefined();
  });
});
describe("mobile Host transport", () => {
  it("exchanges a pairing code and restores only its private credential", async () => {
    const store = memory();
    const privateToken = "private-device-credential";
    const rpc = vi.fn<RpcTransport>(async (_endpoint, credential, request) => {
      const input = request as { method: string };
      if (input.method === "devices.pair") {
        expect(credential).toBe("XD5J-2J3U");
        return { id: "phone", token: privateToken, host: descriptor };
      }
      expect(input.method).toBe("environment.describe");
      expect(credential).toBe(privateToken);
      return descriptor;
    });
    const client = new MobileClient(store, rpc);
    await client.connect(endpoint, "XD5J-2J3U");
    expect(client.connection?.token).toBe(privateToken);
    expect(await store.get("connection")).not.toContain("XD5J-2J3U");
    expect(await store.get("connections")).not.toContain("XD5J-2J3U");
    const restored = new MobileClient(store, rpc);
    expect(await restored.restore()).toBe(true);
    expect(rpc.mock.calls.map((call) => (call[2] as { method: string }).method))
      .toEqual(["devices.pair", "environment.describe"]);
  });

  it("preserves a pairing code when a pending request belongs to another Host", async () => {
    const store = memory();
    await store.set("pending", JSON.stringify({ endpoint: "https://previous.example", environmentId: "previous", command: send }));
    const rpc = vi.fn<RpcTransport>();
    const client = new MobileClient(store, rpc);
    await expect(client.connect(endpoint, "XD5J-2J3U")).rejects.toThrow("previous Host");
    expect(rpc).not.toHaveBeenCalled();
    expect(client.connection).toBeUndefined();
  });

  it("checks the pending Host identity before exchanging a code", async () => {
    const store = memory();
    await store.set("pending", JSON.stringify({ endpoint, environmentId: "previous", command: send }));
    const rpc = vi.fn<RpcTransport>(async () => {
      throw new HostRequestError("Host identity changed; reconnect this machine explicitly", 400);
    });
    const client = new MobileClient(store, rpc);
    await expect(client.connect(endpoint, "XD5J-2J3U")).rejects.toThrow("Host identity changed");
    expect(rpc).toHaveBeenCalledExactlyOnceWith(endpoint, "XD5J-2J3U", {
      version: 1, method: "devices.pair", params: { expectedEnvironmentId: "previous", supportedProviders: REMOTE_PROVIDERS,
        deviceInfo: { installationId: await store.get("installationId") } },
    });
    expect(await store.get("connection")).toBeNull();
  });

  it("does not save an invalid pairing response", async () => {
    const store = memory();
    const client = new MobileClient(store, async () => ({ id: "phone" }));
    await expect(client.connect(endpoint, "XD5J-2J3U")).rejects.toThrow("Invalid Host response");
    expect(client.connection).toBeUndefined();
    expect(await store.get("connection")).toBeNull();
  });

  it("uses native POST /rpc without browser Origin, disables redirects, and unwraps the Host envelope", async () => {
    http.post.mockResolvedValue({ status: 200, data: { result: descriptor } });
    expect(
      await nativeTransport(endpoint, token, {
        method: "environment.describe",
      }),
    ).toEqual(descriptor);
    expect(http.post.mock.calls[0][0]).toMatchObject({
      url: `${endpoint}/rpc`,
      disableRedirects: true,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    expect(http.post.mock.calls[0][0].headers).not.toHaveProperty("Origin");
  });
  it("surfaces invalid credentials and malformed responses", async () => {
    http.post.mockResolvedValue({
      status: 401,
      data: { error: "Device credential is invalid or revoked" },
    });
    await expect(nativeTransport(endpoint, token, {})).rejects.toMatchObject({
      status: 401,
    });
    http.post.mockResolvedValue({ status: 200, data: {} });
    await expect(nativeTransport(endpoint, token, {})).rejects.toThrow(
      "Invalid Host response",
    );
  });
  it("accepts HTTP and HTTPS Hosts and rejects credential/path/query URLs", () => {
    expect(normalizeHostUrl(` ${endpoint}/ `)).toBe(endpoint);
    expect(normalizeHostUrl("http://127.0.0.1:3774")).toBe(
      "http://127.0.0.1:3774",
    );
    for (const url of [
      "http://192.168.1.2:3774",
      "http://my-computer.local:3774",
      "http://host.example.com:3774",
      "http://[fd00::1]:3774",
    ])
      expect(normalizeHostUrl(` ${url}/ `)).toBe(url);
    for (const url of [
      "ftp://host",
      `${endpoint}/rpc`,
      `${endpoint}?token=secret`,
      "https://user:password@host",
      `${endpoint}#fragment`,
    ])
      expect(() => normalizeHostUrl(url)).toThrow();
  });
});

describe("mobile client synchronization", () => {
  it("queries native ownership on the paired Host and preserves the native binding through sync", async () => {
    const value = snapshot();
    value.session.nativeSession = { provider: "pi", providerSessionId: "pi-native", path: "/native/pi.jsonl",
      revision: "1", createdAt: 1, updatedAt: 1, blockIds: [] };
    value.session.providerSessionId = "pi-native";
    const rpc = vi.fn(transport((method, params) => {
      if (method === "sessions.nativeAccess") {
        expect(params).toEqual({ sessionId: "session" });
        return { state: "idle", reason: "available", checkedAt: 1, path: "/native/pi.jsonl" };
      }
      return { kind: "snapshot", value };
    }));
    const client = new MobileClient(memory(), rpc);
    await client.connect(endpoint, token);
    expect((await client.session("session")).session.nativeSession).toEqual(value.session.nativeSession);
    expect(await client.nativeAccess("session")).toMatchObject({ state: "idle" });
    expect(rpc.mock.calls.at(-1)![2]).toMatchObject({ environmentId: "host-1", method: "sessions.nativeAccess" });
  });
  it("propagates network and native-access errors", async () => {
    let failure: Error = new Error("Network timeout");
    const client = new MobileClient(memory(), transport(() => { throw failure; }));
    await client.connect(endpoint, token);
    await expect(client.nativeAccess("session")).rejects.toThrow("Network timeout");
    failure = new HostRequestError("Conversation not found", 400);
    await expect(client.nativeAccess("session")).rejects.toThrow("Conversation not found");
  });
  it("discards an ownership response after the Host connection changes", async () => {
    let resolve!: (value: unknown) => void;
    const client = new MobileClient(memory(), transport(() => new Promise((done) => { resolve = done; })));
    await client.connect(endpoint, token);
    const check = client.nativeAccess("session");
    await client.connect("https://other-computer.example", token);
    resolve({ state: "idle", path: "/native/pi.jsonl", checkedAt: 1, reason: "available" });
    await expect(check).rejects.toThrow("Host connection changed");
  });
  it("updates session metadata on its owning project", async () => {
    const requests: Array<{ method: string; params: Record<string, any> }> = [];
    const client = new MobileClient(
      memory(),
      transport((method, params) => {
        requests.push({ method, params });
        if (method === "sessions.sync")
          return { kind: "snapshot", value: snapshot() };
        return {
          id: "session",
          projectId: "project",
          revision: 2,
          pinned: true,
        };
      }),
    );
    await client.connect(endpoint, token);
    await client.session("session");
    await client.updateSession("project", "session", {
      pinned: true,
      title: "Updated",
    });
    expect(requests.at(-1)).toEqual({
      method: "sessions.update",
      params: {
        projectId: "project",
        sessionId: "session",
        pinned: true,
        title: "Updated",
      },
    });
  });
  it("refreshes the saved hostname from the verified Host descriptor", async () => {
    const store = memory();
    let host = { ...descriptor, name: "Old computer name" };
    const client = new MobileClient(store, async () => host);
    await client.connect(endpoint, token);
    host = { ...host, name: "wy-ubuntu" };
    await client.verify();
    expect(client.connection?.name).toBe("wy-ubuntu");
    expect(JSON.parse((await store.get("connection"))!).name).toBe("wy-ubuntu");
    host = { ...host, name: "Different computer", environmentId: "other-host" };
    await expect(client.verify()).rejects.toThrow("Host identity changed");
    expect(client.connection?.name).toBe("wy-ubuntu");
  });
  it("hydrates Host image attachments with the shared desktop preview loader and reuses their bytes", async () => {
    const value = snapshot();
    value.session.blocks[0] = {
      id: "image-prompt",
      role: "user",
      text: "Inspect",
      attachments: [
        {
          id: "image",
          name: "image.png",
          kind: "image",
          mimeType: "image/png",
          size: 3,
          path: "/host/image.png",
        },
      ],
    };
    let imageRequests = 0;
    const client = new MobileClient(
      memory(),
      transport((method, params) => {
        if (method === "attachments.read") {
          imageRequests++;
          expect(params).toEqual({
            sessionId: "session",
            id: "image",
            offset: 0,
          });
          return { data: "QUJD", size: 3, offset: 3 };
        }
        return params.revision === 1
          ? { kind: "unchanged", revision: 1 }
          : { kind: "snapshot", value };
      }),
    );
    await client.connect(endpoint, token);
    await client.session("session");
    expect(imageRequests).toBe(0);
    expect(
      (await client.sessionPreviews("session"))!.session.blocks[0].attachments![0].data,
    ).toBe("QUJD");
    expect((await client.session("session")).session.blocks[0].attachments![0].data).toBe("QUJD");
    await client.sessionPreviews("session");
    expect(imageRequests).toBe(1);
  });
  it.each([undefined, "wsl-project"])("reads image bytes through the Host workspace protocol with project %s", async (projectId) => {
    const rpc = vi.fn(
      transport((method, params) => {
        expect(method).toBe("workspace.run");
        expect(params).toEqual({
          ...(projectId ? { projectId } : {}),
          command: "read_binary_file",
          args: { path: "/project/image.png" },
        });
        return "QUJD";
      }),
    );
    const client = new MobileClient(memory(), rpc);
    await client.connect(endpoint, token);
    expect(
      Array.from(await client.readBinaryFile("/project/image.png", projectId)),
    ).toEqual([65, 66, 67]);
  });
  it("applies streamed deltas without losing existing blocks and preserves unchanged snapshots", async () => {
    let value: any = { kind: "snapshot", value: snapshot() };
    const rpc = vi.fn(transport(() => value));
    const client = new MobileClient(memory(), rpc);
    await client.connect(endpoint, token);
    const first = await client.session("session");
    value = {
      kind: "delta",
      base: 1,
      value: {
        ...snapshot(2),
        session: { ...snapshot(2).session, blocks: undefined },
      },
      blockIds: ["response", "tool"],
      blocks: [{ id: "tool", role: "tool", text: "Read app.ts" }],
    };
    const next = await client.session("session");
    expect(next.session.blocks.map((block) => block.text)).toEqual([
      "Hello",
      "Read app.ts",
    ]);
    expect((rpc.mock.calls.at(-1)![2] as any).params.revision).toBe(
      first.revision,
    );
    value = { kind: "unchanged", revision: 2 };
    expect(await client.session("session")).toBe(next);
  });
  it("recovers from a missing delta base with a fresh snapshot", async () => {
    let requests = 0;
    const client = new MobileClient(
      memory(),
      transport(() =>
        ++requests === 1
          ? { kind: "delta", base: 9, value: {}, blockIds: [], blocks: [] }
          : { kind: "snapshot", value: snapshot(10) },
      ),
    );
    await client.connect(endpoint, token);
    expect((await client.session("session")).revision).toBe(10);
    expect(requests).toBe(2);
  });
  it("assembles bounded chunks and rejects a stalled transfer", async () => {
    const serialized = JSON.stringify({ kind: "snapshot", value: snapshot() });
    let stalled = false;
    const client = new MobileClient(
      memory(),
      transport((method, params) =>
        method === "sessions.sync"
          ? { kind: "chunked", length: serialized.length, transfer: "transfer" }
          : {
              data: stalled
                ? ""
                : serialized.slice(params.offset, params.offset + 25),
            },
      ),
    );
    await client.connect(endpoint, token);
    expect((await client.session("session")).session.blocks[0].text).toBe(
      "Hello",
    );
    stalled = true;
    await expect(client.session("session")).rejects.toThrow("Incomplete");
  });
  it("checks persisted Host identity on reconnect", async () => {
    const store = memory();
    await new MobileClient(
      store,
      transport(() => []),
    ).connect(endpoint, token);
    const other = new MobileClient(store, async () => ({
      ...descriptor,
      environmentId: "replacement-host",
    }));
    await expect(other.restore()).rejects.toThrow("Host identity changed");
  });
});

describe("mobile command journal", () => {
  it("reads the journal from secure storage once and follows its own writes", async () => {
    const store = memory();
    const get = vi.spyOn(store, "get");
    let fail = true;
    const client = new MobileClient(store, transport((_method, params) => {
      if (fail) throw new Error("Connection lost");
      return { ...receipt, commandId: params.commandId };
    }));
    await client.connect(endpoint, token);
    for (let poll = 0; poll < 5; poll += 1) expect(await client.pending()).toBeUndefined();
    expect(get.mock.calls.filter(([key]) => key === "pending")).toHaveLength(1);

    await expect(client.dispatch(send)).rejects.toThrow("Connection lost");
    expect((await client.pending())?.command.commandId).toBe("send-original");
    fail = false;
    await client.retryPending();
    expect(await client.pending()).toBeUndefined();
    expect(get.mock.calls.filter(([key]) => key === "pending")).toHaveLength(1);
  });
  it("retains the same command id after a lost response and restores it after app restart", async () => {
    const store = memory();
    const commands: string[] = [];
    let fail = true;
    const rpc = transport((_method, params) => {
      commands.push(params.commandId);
      if (fail)
        throw new Error("Connection lost after Host accepted the request");
      return { ...receipt, commandId: params.commandId };
    });
    const client = new MobileClient(store, rpc);
    await client.connect(endpoint, token);
    await expect(client.dispatch(send)).rejects.toThrow("Connection lost");
    expect((await client.pending())?.command.commandId).toBe("send-original");
    fail = false;
    const restored = new MobileClient(store, rpc);
    await restored.restore();
    await restored.retryPending();
    expect(commands).toEqual(["send-original", "send-original"]);
    expect(await restored.pending()).toBeUndefined();
  });
  it("journals the first message after creation and retries its receipt rather than creating another session", async () => {
    const store = memory();
    const commands: Record<string, any>[] = [];
    let fail = true;
    const client = new MobileClient(
      store,
      transport((_method, params) => {
        commands.push(params);
        if (params.type === "send" && fail) throw new Error("Lost response");
        return { ...receipt, commandId: params.commandId };
      }),
    );
    await client.connect(endpoint, token);
    await expect(
      client.dispatch(
        {
          type: "create",
          commandId: "create-original",
          projectId: "project",
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
        },
        "First message",
      ),
    ).rejects.toThrow("Lost response");
    expect((await client.pending())?.command.type).toBe("send");
    fail = false;
    await client.retryPending();
    expect(commands.map((command) => command.type)).toEqual([
      "create",
      "send",
      "send",
    ]);
    expect(commands[1]).toEqual(commands[2]);
    expect(commands[2]).toMatchObject({
      sessionId: "session",
      text: "First message",
    });
  });
  it("keeps a created worktree on the journaled first message", async () => {
    const store = memory();
    const commands: Record<string, any>[] = [];
    const client = new MobileClient(
      store,
      transport((_method, params) => {
        commands.push(params);
        return { ...receipt, commandId: params.commandId };
      }),
    );
    await client.connect(endpoint, token);
    const worktreeCreation = { base: "main", path: "/project-worktrees/wt-mc-task", log: [] };
    await client.dispatch(
      {
        type: "create",
        commandId: "create-worktree",
        projectId: "project",
        executionCwd: worktreeCreation.path,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      },
      { text: "First message", worktreeCreation },
    );
    expect(commands[0]).toMatchObject({ type: "create", executionCwd: worktreeCreation.path });
    expect(commands[1]).toMatchObject({ type: "send", sessionId: "session", worktreeCreation });
  });
  it("gives worktree naming and creation longer than an ordinary request", async () => {
    const calls: { method: string; timeoutMs?: number }[] = [];
    const client = new MobileClient(memory(), async (_endpoint, _token, request, options) => {
      const { method } = request as { method: string };
      calls.push({ method, timeoutMs: options?.timeoutMs });
      if (method === "environment.describe") return descriptor;
      return method === "git.worktreeName" ? "mc/task" : { path: "/tree", branch: "mc/task", head: "abc", isMain: false, missing: false };
    });
    await client.connect(endpoint, token);
    await client.worktreeName("project", "/project", "codex", "Fix it");
    await client.worktreeCreate("project", "/project", "mc/task", "main");
    expect(calls.slice(-2)).toEqual([
      { method: "git.worktreeName", timeoutMs: 150_000 },
      { method: "git.worktreeCreate", timeoutMs: 120_000 },
    ]);
  });
  it("serializes commands and refuses a different Host while a request is uncertain", async () => {
    let resolve!: (value: unknown) => void;
    const client = new MobileClient(
      memory(),
      transport(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    await client.connect(endpoint, token);
    const first = client.dispatch(send);
    await expect(
      client.dispatch({ ...send, commandId: "duplicate" }),
    ).rejects.toThrow("already being sent");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    resolve(receipt);
    await first;
    const failing = new MobileClient(
      memory(),
      transport(() => {
        throw new Error("Offline");
      }),
    );
    await failing.connect(endpoint, token);
    await expect(failing.dispatch(send)).rejects.toThrow("Offline");
    await expect(
      failing.connect("https://another.example", token),
    ).rejects.toThrow("previous Host");
  });
  it("keeps files and plan intent in the first-message journal across app restoration", async () => {
    const store = memory();
    const commands: Record<string, any>[] = [];
    let fail = true;
    const rpc = transport((_method, params) => {
      commands.push(params);
      if (params.type === "send" && fail) throw new Error("Lost receipt");
      return { ...receipt, commandId: params.commandId };
    });
    const client = new MobileClient(store, rpc);
    await client.connect(endpoint, token);
    const files = [
      {
        id: "file",
        name: "notes.txt",
        mimeType: "text/plain",
        kind: "file" as const,
        size: 7,
      },
    ];
    await expect(
      client.dispatch(
        {
          type: "create",
          commandId: "create-files",
          projectId: "project",
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
        },
        { text: "", attachments: files, intent: "plan" },
      ),
    ).rejects.toThrow("Lost receipt");
    fail = false;
    const restored = new MobileClient(store, rpc);
    await restored.restore();
    await restored.retryPending();
    expect(commands.map((command) => command.type)).toEqual([
      "create",
      "send",
      "send",
    ]);
    expect(commands[1]).toEqual(commands[2]);
    expect(commands[2]).toMatchObject({
      text: "",
      attachments: files,
      intent: "plan",
    });
  });
  it("uploads chunked attachments and repeats the same chunk when its receipt is lost", async () => {
    const chunks: Record<string, any>[] = [];
    let fail = true;
    const client = new MobileClient(
      memory(),
      transport((method, params) => {
        expect(method).toBe("attachments.upload");
        chunks.push({ ...params });
        if (fail) {
          fail = false;
          throw new Error("Lost upload receipt");
        }
        return {
          offset: params.offset + Buffer.from(params.data, "base64").length,
        };
      }),
    );
    await client.connect(endpoint, token);
    const data = Buffer.alloc(600_001, 42);
    const file = {
      id: "file",
      name: "notes.txt",
      mimeType: "text/plain",
      kind: "file" as const,
      size: data.length,
      data: data.toString("base64"),
    };
    expect(await client.uploadAttachments([file])).toEqual([
      {
        id: "file",
        name: "notes.txt",
        mimeType: "text/plain",
        kind: "file",
        size: data.length,
      },
    ]);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual(chunks[1]);
    expect(chunks[2].offset).toBe(Buffer.from(chunks[1].data, "base64").length);
    expect(
      Buffer.concat([
        Buffer.from(chunks[1].data, "base64"),
        Buffer.from(chunks[2].data, "base64"),
      ]),
    ).toEqual(data);
  });
  it("creates empty attachment files and rejects a corrupt upload acknowledgement", async () => {
    const client = new MobileClient(
      memory(),
      transport((_method, params) => ({ offset: params.size ? 999 : 0 })),
    );
    await client.connect(endpoint, token);
    const file = {
      id: "empty",
      name: "empty.txt",
      mimeType: "text/plain",
      kind: "file" as const,
      size: 0,
      data: "",
    };
    expect(await client.uploadAttachments([file])).toHaveLength(1);
    await expect(
      client.uploadAttachments([{ ...file, size: 1, data: "YQ==" }]),
    ).rejects.toThrow("interrupted");
    await expect(
      client.uploadAttachments([{ ...file, size: 21 * 1024 * 1024 }]),
    ).rejects.toThrow("20 MB");
  });
  it("clears definitively rejected commands so the user can correct the request", async () => {
    const client = new MobileClient(
      memory(),
      transport(() => {
        throw new HostRequestError("Session is busy", 400);
      }),
    );
    await client.connect(endpoint, token);
    await expect(client.dispatch(send)).rejects.toThrow("Session is busy");
    expect(await client.pending()).toBeUndefined();
  });
});

it("reuses Host-accepted queued attachments when returning images and files to the composer", async () => {
  const client = new MobileClient(memory(), transport(() => { throw new Error("Should not upload accepted attachments"); }));
  await client.connect(endpoint, token);
  const files = [
    { id: "image", name: "photo.png", mimeType: "image/png", kind: "image" as const, size: 3, data: "YWJj" },
    { id: "file", name: "notes.txt", mimeType: "text/plain", kind: "file" as const, size: 5, path: "/host/file" },
  ];
  expect(await client.uploadAttachments(files, files)).toEqual(files.map(({ id, name, mimeType, kind, size }) => ({ id, name, mimeType, kind, size })));
  await expect(client.uploadAttachments([{ ...files[1], size: 6 }], files)).rejects.toThrow("must be readable");
});

it.each([false, true])("samples the sync response clock before reading chunks (chunked=%s)", async (chunked) => {
  const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
  try {
    const serialized = JSON.stringify({ kind: "snapshot", value: snapshot() });
    let unchanged = false;
    const client = new MobileClient(memory(), transport((method) => {
      if (method === "sessions.sync") {
        now.mockReturnValue(100_200);
        if (unchanged) return { kind: "unchanged", revision: 1, serverTime: 35_100 };
        return chunked
          ? { kind: "chunked", transfer: "t", length: serialized.length, serverTime: 35_100 }
          : { kind: "snapshot", value: snapshot(), serverTime: 35_100 };
      }
      now.mockReturnValue(110_000);
      return { data: serialized };
    }));
    await client.connect(endpoint, token);
    const first = await client.session("session");
    expect(first.clockOffsetMs).toBe(-65_000);
    unchanged = true;
    now.mockReturnValue(100_000);
    expect(await client.session("session")).toBe(first);
  } finally {
    now.mockRestore();
  }
});

it("keeps one phone identity across LAN, Tailscale, restart, and forgetting connections", async () => {
  const storage = memory();
  const lan = "http://192.168.1.5:3774";
  const rpc = vi.fn<RpcTransport>(async (_endpoint, credential, request) => {
    const input = request as { method: string; params: { deviceInfo: { installationId: string } } };
    expect(input.params.deviceInfo.installationId).toBe(await storage.get("installationId"));
    return input.method === "devices.pair"
      ? { id: credential, token: `private-${credential}`, host: descriptor }
      : descriptor;
  });
  const client = new MobileClient(storage, rpc);
  await client.connect(lan, "ABCD-EFGH");
  const identity = await storage.get("installationId");
  await client.connect(endpoint, "JKLM-NPQR");
  expect((await client.savedConnections()).map(connection => connection.endpoint)).toEqual([lan, endpoint]);
  const restored = new MobileClient({ ...storage }, rpc);
  await restored.restore();
  await restored.switchTo(lan);
  await restored.forget(endpoint);
  await restored.disconnect();
  await restored.connect(endpoint, "STUV-WXYZ");
  expect(await storage.get("installationId")).toBe(identity);
  for (const [, , request] of rpc.mock.calls) {
    expect(request).toMatchObject({ params: { deviceInfo: { installationId: identity } } });
  }
});

it("reports phone hardware on connect and reconnect without changing the device name", async () => {
  vi.mocked(readMobileDeviceInfo).mockResolvedValue({ model: "SM-S9280", manufacturer: "Samsung" });
  const rpc = vi.fn(transport(() => []));
  const client = new MobileClient(memory(), rpc);
  await client.connect(endpoint, token);
  await client.verify();
  expect(readMobileDeviceInfo).toHaveBeenCalledOnce();
  for (const [, credential, request] of rpc.mock.calls) {
    expect(credential).toBe(token);
    expect(request).toMatchObject({ method: "environment.describe", params: {
      deviceInfo: { model: "SM-S9280", manufacturer: "Samsung" },
    } });
    expect((request as { params: object }).params).not.toHaveProperty("name");
  }
});
