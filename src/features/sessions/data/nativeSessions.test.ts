// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { newSession, type Session } from "../model/session";
import type {
  NativeSessionAccess,
  NativeSessionFile,
  NativeSourceListing,
} from "../../../integrations/harness/core/nativeSessions";
const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  remoteRequest: vi.fn(),
  remoteMachineFor: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: mocks.isTauri }));
vi.mock("../../connections/model/connections", () => ({
  remoteRequest: mocks.remoteRequest,
  remoteMachineFor: mocks.remoteMachineFor,
  remoteSessionFor: (id: string) => `host-${id}`,
}));
vi.mock("../../connections/model/remoteProjects", () => ({
  remoteProjectFor: (cwd: string) =>
    cwd.startsWith("remote://") ? { key: cwd, environmentId: "env-2", projectId: "p", cwd: "/far" } : undefined,
}));
import {
  importNativeSession,
  importNativeSessions,
  installNativeSessionSync,
  syncNativeSessions,
  setNativeAutoSync,
  nativeAutoSyncEnabled,
  nativeSessionSnapshot,
  nativeSessionReadOnly,
  nativeSessionAccessHint,
  nativeSessionAccess,
  pollNativeSessionAccess,
  externalNativeSessions,
  refreshNativeDiscovery,
  discoverNativeSessions,
} from "./nativeSessions";
import { useNativeSessionAccess } from "../ui/useNativeSessionAccess";
import { setSharedSessionBackend, type SharedSessionBackend } from "./sharedSessionBackend";

const file: NativeSessionFile = {
  provider: "pi",
  providerSessionId: "pi-id",
  cwd: "/repo",
  path: "/pi/session.jsonl",
  revision: "1",
  modifiedAt: 100,
  sourceId: "a".repeat(32),
};
const link = {
  provider: "pi" as const, providerSessionId: "pi-id", path: file.path, revision: "1",
  createdAt: 1, updatedAt: 1, blockIds: [], nativeIds: [], mode: "managed" as const,
};
const hostSession: Session = { ...newSession("pi", "/repo"), id: "host-native", providerSessionId: "pi-id", nativeSession: link };
const idle = (): NativeSessionAccess => ({ state: "idle", reason: "available", checkedAt: Date.now(), path: file.path });
const listing = (patch: Partial<NativeSourceListing> = {}): NativeSourceListing => ({
  sources: [file], warnings: [], scannedAt: 1, autoSync: true, managedCount: 0, ...patch,
});

let cleanup: () => void;
let live: Session[];
let changed: ReturnType<typeof vi.fn>;
let native: SharedSessionBackend["native"] & {
  list: ReturnType<typeof vi.fn>;
  import: ReturnType<typeof vi.fn>;
  syncAll: ReturnType<typeof vi.fn>;
  access: ReturnType<typeof vi.fn>;
};

function sharedBackend(overrides: Partial<SharedSessionBackend> = {}): SharedSessionBackend {
  return {
    ownsProject: (cwd) => !cwd.startsWith("remote://"),
    ownsSession: () => true,
    rememberSession: vi.fn(),
    native,
    list: vi.fn(async () => [{ id: "host-native", cwd: "/repo", title: "Host", harness: "pi", createdAt: 1, updatedAt: 1 }] as never),
    get: vi.fn(async () => hostSession),
    update: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    search: vi.fn(async () => []),
    cancelSearch: vi.fn(),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  native = {
    list: vi.fn(async () => listing()),
    import: vi.fn(async () => "host-native"),
    syncAll: vi.fn(async () => {}),
    access: vi.fn(async () => idle()),
  };
  setSharedSessionBackend(sharedBackend());
  live = [hostSession];
  changed = vi.fn();
  cleanup = installNativeSessionSync({ live: () => live, changed });
  // Installing starts one ownership check and one listing; let them finish.
  await pollNativeSessionAccess();
  await vi.advanceTimersByTimeAsync(0);
  native.access.mockClear();
  native.list.mockClear();
});
afterEach(() => {
  cleanup();
  setSharedSessionBackend();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("keeps 39 panes quiet on lease renewals, but redraws a changed owner", async () => {
  await pollNativeSessionAccess();
  const sessions = Array.from({ length: 39 }, (_, index) =>
    index === 0 ? hostSession : { ...hostSession, id: `other-${index}` });
  const renders = sessions.map(() => 0);
  const views: ReturnType<typeof useNativeSessionAccess>[] = [];
  const Pane = ({ index }: { index: number }) => {
    views[index] = useNativeSessionAccess(sessions[index]);
    renders[index]++;
    return null;
  };
  const root = createRoot(document.createElement("div"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    act(() => root.render(createElement("div", null, ...sessions.map((_, index) => createElement(Pane, { key: index, index })))));
    const initial = [...renders];
    expect(views[0].readOnly).toBe(false);
    vi.setSystemTime(Date.now() + 5_000);
    await act(async () => pollNativeSessionAccess());
    expect(renders).toEqual(initial);
    native.access.mockImplementation(async () => ({
      state: "external", reason: "externalProcess", checkedAt: Date.now(), path: file.path,
      holder: { pid: 42, provider: "pi", command: "pi" },
    }));
    await act(async () => pollNativeSessionAccess());
    expect(renders).toEqual(initial.map((count, index) => count + Number(index === 0)));
    expect(views[0].readOnly).toBe(true);
    expect(views[0].hint).toContain("pid 42");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("releases the composer when an owner seen by a stopped poller ages out", async () => {
  native.access.mockImplementation(async () => ({
    state: "external", reason: "externalProcess", checkedAt: Date.now(), path: file.path,
    holder: { pid: 42, provider: "pi", command: "pi" },
  }));
  await pollNativeSessionAccess();
  let renders = 0;
  let view: ReturnType<typeof useNativeSessionAccess>;
  const Pane = () => {
    view = useNativeSessionAccess(hostSession);
    renders++;
    return null;
  };
  const root = createRoot(document.createElement("div"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    act(() => root.render(createElement(Pane)));
    const initial = renders;
    expect(view!.readOnly).toBe(true);
    // The Host rechecks ownership under its lock before writing, so a stale owner does not lock the composer.
    cleanup();
    await act(async () => vi.advanceTimersByTimeAsync(15_001));
    expect(view!.readOnly).toBe(false);
    expect(view!.hint).toBeUndefined();
    expect(renders).toBe(initial + 1);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("reads ownership of a native conversation on another machine from that machine's Host", async () => {
  const far: Session = { ...hostSession, id: "far", cwd: "remote://env-2/far" };
  live = [far];
  mocks.remoteMachineFor.mockResolvedValue({ id: "machine-2" });
  mocks.remoteRequest.mockResolvedValue(idle());
  await pollNativeSessionAccess();
  expect(mocks.remoteMachineFor).toHaveBeenCalledWith("env-2");
  expect(mocks.remoteRequest).toHaveBeenCalledWith("machine-2", "sessions.nativeAccess", { sessionId: "host-far" });
  expect(native.access).not.toHaveBeenCalled();
  expect(nativeSessionReadOnly(far)).toBe(false);
  // A failed probe keeps the last confirmed state, then stays writable without a notice.
  mocks.remoteMachineFor.mockResolvedValue(undefined);
  vi.setSystemTime(Date.now() + 5_000);
  await pollNativeSessionAccess();
  expect(nativeSessionAccess(far)?.state).toBe("idle");
  vi.setSystemTime(Date.now() + 11_000);
  await pollNativeSessionAccess();
  expect(nativeSessionAccess(far)?.state).toBe("unknown");
  expect(nativeSessionReadOnly(far)).toBe(false);
  expect(nativeSessionAccessHint(far)).toBeUndefined();
});

describe("native discovery scheduling", () => {
  it("coalesces refresh requests into one Host listing per interval", async () => {
    native.list.mockClear();
    await refreshNativeDiscovery(true);
    expect(native.list).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 10; index++) {
      await vi.advanceTimersByTimeAsync(300);
      void refreshNativeDiscovery();
    }
    expect(native.list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(native.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(native.list).toHaveBeenCalledTimes(2);
  });

  it("lets an explicit refresh bypass the interval", async () => {
    native.list.mockClear();
    await refreshNativeDiscovery(true);
    await refreshNativeDiscovery();
    await refreshNativeDiscovery(true);
    expect(native.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(native.list).toHaveBeenCalledTimes(2);
  });
});

it("lists only unbound sessions belonging to a project", () => {
  const claude = { ...file, provider: "claude" as const, providerSessionId: "c1", path: "/c/c1.jsonl" };
  const other = { ...claude, providerSessionId: "c2", cwd: "/elsewhere" };
  const bound = { ...claude, providerSessionId: "c3" };
  expect(
    externalNativeSessions([claude, other, bound], new Set(["claude:c3"]), (cwd) => cwd === "/repo"),
  ).toEqual([claude]);
});

describe("Host-managed native conversations", () => {
  it("lists through the Host with its import count, last sync and auto-sync setting", async () => {
    native.list.mockResolvedValue(listing({ managedCount: 3, lastSyncedAt: 42, autoSync: false }));
    await discoverNativeSessions();
    expect(native.list).toHaveBeenLastCalledWith({ refresh: true });
    expect(nativeSessionSnapshot()).toMatchObject({ files: [file], importedCount: 3, lastSynced: 42, autoSync: false });
    expect(nativeAutoSyncEnabled()).toBe(false);
    native.list.mockResolvedValue(listing({ managedCount: 3, autoSync: true }));
    setNativeAutoSync(true);
    expect(nativeAutoSyncEnabled()).toBe(true);
    expect(native.list).toHaveBeenLastCalledWith({ autoSync: true });
  });

  it("imports through the Host and marks the source bound", async () => {
    expect(await importNativeSession(file)).toBe("host-native");
    expect(native.import).toHaveBeenCalledWith(file.sourceId);
    expect(nativeSessionSnapshot().bound.has("pi:pi-id")).toBe(true);
    expect(changed).toHaveBeenCalledWith(hostSession, expect.objectContaining({ id: "host-native" }), true);
  });

  it("imports a batch, continues past failures and can stop", async () => {
    const files = ["a", "b", "c"].map((id) => ({ ...file, providerSessionId: id, sourceId: id.repeat(32) }));
    native.import.mockImplementation(async (sourceId: string) => {
      if (sourceId.startsWith("b")) throw new Error("Native session has no user messages yet");
      return "host-native";
    });
    const stop = { cancelled: false };
    const seen: number[] = [];
    const result = await importNativeSessions(files, { stop, onProgress: ({ done }) => seen.push(done) });
    expect(result).toEqual({ done: 3, total: 3, failed: 1 });
    expect(seen).toEqual([1, 2, 3]);
    expect(nativeSessionSnapshot().busy).toBe(false);
    stop.cancelled = true;
    expect((await importNativeSessions(files, { stop })).done).toBe(0);
  });

  it("syncs every managed conversation on the Host, then refreshes the listing", async () => {
    native.list.mockResolvedValue(listing({ managedCount: 1, lastSyncedAt: 7 }));
    await syncNativeSessions();
    expect(native.syncAll).toHaveBeenCalledTimes(1);
    expect(nativeSessionSnapshot()).toMatchObject({ lastSynced: 7, busy: false, error: undefined });
  });

  it("reports Host ownership and blocked synchronization in the composer hint", async () => {
    native.access.mockResolvedValue({
      state: "external", reason: "externalProcess", checkedAt: Date.now(), path: file.path,
      holder: { pid: 42, provider: "pi", command: "pi" },
    });
    await pollNativeSessionAccess();
    expect(native.access).toHaveBeenCalledWith("host-native");
    expect(nativeSessionReadOnly(hostSession)).toBe(true);
    expect(nativeSessionAccessHint(hostSession)).toContain("pid 42");
    const diverged = { ...hostSession, nativeSyncStatus: { state: "error" as const, reason: "diverged", checkedAt: 1 } };
    expect(nativeSessionAccessHint(diverged)).toContain("rewound");
  });
});
