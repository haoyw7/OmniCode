// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  cachedRemoteSessions,
  cachedRemoteSessionSummary,
  connectMachine,
  disconnectMachine,
  hasCachedRemoteProjectSessions,
  prefetchRemoteProjectSessions,
  refreshRemoteProjectSessions,
  useRemoteProjectSessions,
  type RemoteProjectSessions,
} from "./connections";
import { configureSharedHost, rememberRemoteProject } from "./remoteProjects";
import type { HostSessionSummary } from "./protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const machine = {
  id: "tree-computer", environmentId: "tree-environment", name: "Computer",
  endpoint: "http://127.0.0.1:3774",
};
let root: Root;
let container: HTMLDivElement;
let sequence = 0;
let list: (projectId: string) => Promise<HostSessionSummary[]>;
const views = new Map<string, RemoteProjectSessions>();
const summary = (title: string, id = "same-session-id"): HostSessionSummary => ({
  id, title, projectId: "host-project", revision: 1, status: "idle",
  harness: "codex", updatedAt: 1,
});
const project = (name: string) => rememberRemoteProject(machine.environmentId, {
  id: name, cwd: `/projects/${sequence}/${name}`, name,
}).key;
const listCalls = () => vi.mocked(invoke).mock.calls.filter(
  ([command, args]: any) => command === "remote_request" && args.method === "sessions.list",
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
function View({ path, enabled, name }: { path: string; enabled: boolean; name: string }) {
  views.set(name, useRemoteProjectSessions(path, enabled));
  return null;
}
const render = async (entries: { path: string; enabled: boolean; name: string }[]) => {
  await act(async () => root.render(createElement(Fragment, null,
    ...entries.map((entry) => createElement(View, { ...entry, key: entry.name })),
  )));
};

beforeEach(async () => {
  sequence++;
  localStorage.clear();
  views.clear();
  configureSharedHost(undefined, []);
  vi.useFakeTimers();
  list = async () => [];
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === "remote_connect") return machine;
    if (command === "remote_disconnect") return;
    if (command === "remote_machines") return [machine];
    if (command === "remote_request" && args.method === "sessions.list")
      return list(args.params.projectId);
    if (command === "remote_request" && args.method === "projects.open")
      return { id: "new-shared-project", cwd: args.params.cwd, name: "Shared" };
    throw new Error(`Unexpected operation: ${command}`);
  });
  await connectMachine("Computer", machine.endpoint, "test-token");
  vi.mocked(invoke).mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  configureSharedHost(undefined, []);
  vi.useRealTimers();
});

it("preserves collapsed history and treats a successfully loaded empty list as loaded", async () => {
  const path = project("collapsed");
  localStorage.setItem(`monocode.remote-history.v2:${path}`, JSON.stringify([summary("Cached")]));
  await render([{ path, enabled: false, name: "collapsed" }]);
  expect(views.get("collapsed")).toMatchObject({ loaded: true, pending: false, offline: false });
  expect(views.get("collapsed")!.sessions[0].title).toBe("Cached");
  expect(listCalls()).toHaveLength(0);

  await act(async () => prefetchRemoteProjectSessions(path));
  expect(views.get("collapsed")).toMatchObject({ sessions: [], loaded: true, pending: false });
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(listCalls()).toHaveLength(1);
});

it("keeps idle polls of an unchanged list silent and announces real changes", async () => {
  const path = project("idle-poll");
  list = async () => [summary("Same")];
  await prefetchRemoteProjectSessions(path);
  const first = cachedRemoteSessions(path);
  const updates = vi.fn();
  window.addEventListener("monocode:remote-history-updated", updates);
  try {
    await prefetchRemoteProjectSessions(path);
    expect(updates).not.toHaveBeenCalled();
    expect(cachedRemoteSessions(path)).toBe(first);

    list = async () => [summary("Renamed")];
    await prefetchRemoteProjectSessions(path);
    expect(updates).toHaveBeenCalledOnce();
    expect(cachedRemoteSessions(path)[0].title).toBe("Renamed");
  } finally {
    window.removeEventListener("monocode:remote-history-updated", updates);
  }
});

it("distinguishes an unloaded project from successful empty and restored cache lists", async () => {
  const empty = project("empty-readiness");
  const restored = project("restored-readiness");
  const failed = project("failed-readiness");
  localStorage.setItem(`monocode.remote-history.v2:${restored}`, "[]");
  expect(hasCachedRemoteProjectSessions(empty)).toBe(false);
  expect(hasCachedRemoteProjectSessions(restored)).toBe(true);
  await prefetchRemoteProjectSessions(empty);
  expect(hasCachedRemoteProjectSessions(empty)).toBe(true);
  expect(cachedRemoteSessions(empty)).toEqual([]);
  list = async () => { throw new Error("Host unreachable"); };
  await expect(prefetchRemoteProjectSessions(failed)).rejects.toThrow("Host unreachable");
  expect(hasCachedRemoteProjectSessions(failed)).toBe(false);
});

it("exposes missing remote registrations as scoped offline errors without issuing IPC", async () => {
  const missing = `remote://unregistered/projects/${sequence}/missing`;
  const restored = `remote://unregistered/projects/${sequence}/cached`;
  localStorage.setItem(`monocode.remote-history.v2:${restored}`, JSON.stringify([summary("Saved remote history")]));
  await render([
    { path: missing, enabled: true, name: "missing" },
    { path: restored, enabled: false, name: "restored" },
  ]);
  expect(views.get("missing")).toMatchObject({ loaded: false, pending: false, offline: true });
  expect(views.get("restored")).toMatchObject({ loaded: true, pending: false, offline: true });
  await act(async () => {
    await expect(prefetchRemoteProjectSessions(missing)).rejects.toThrow("not registered");
    await expect(prefetchRemoteProjectSessions(restored)).rejects.toThrow("not registered");
  });
  expect(views.get("missing")!.error).toContain("not registered");
  expect(hasCachedRemoteProjectSessions(missing)).toBe(false);
  expect(cachedRemoteSessions(restored)[0].title).toBe("Saved remote history");
  expect(hasCachedRemoteProjectSessions(restored)).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps ordinary local folders without a Shared Host as no-op prefetches", async () => {
  const path = `/unshared/${sequence}/local`;
  await render([{ path, enabled: true, name: "local" }]);
  await act(async () => expect(prefetchRemoteProjectSessions(path)).resolves.toBeUndefined());
  expect(views.get("local")).toMatchObject({
    sessions: [], loaded: false, pending: false, offline: false,
  });
  expect(views.get("local")!.error).toBeUndefined();
  expect(invoke).not.toHaveBeenCalled();
});

it("deduplicates search and multiple poll subscribers and stops polling on collapse", async () => {
  const path = project("deduplicated");
  const pending = deferred<HostSessionSummary[]>();
  list = () => pending.promise;
  await render([
    { path, enabled: true, name: "first" },
    { path, enabled: true, name: "second" },
  ]);
  const first = prefetchRemoteProjectSessions(path);
  const second = prefetchRemoteProjectSessions(path);
  expect(first).toBe(second);
  expect(listCalls()).toHaveLength(1);
  expect(views.get("first")!.pending).toBe(true);
  await act(async () => {
    pending.resolve([summary("Live")]);
    await first;
  });
  expect(views.get("second")!.sessions[0].title).toBe("Live");
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(listCalls()).toHaveLength(2);

  await render([
    { path, enabled: false, name: "first" },
    { path, enabled: false, name: "second" },
  ]);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(listCalls()).toHaveLength(2);
  expect(views.get("first")!.sessions[0].title).toBe("Live");
});

it("does not restart a collapsed poller when its outstanding request finishes", async () => {
  const path = project("pending-collapse");
  const pending = deferred<HostSessionSummary[]>();
  list = () => pending.promise;
  await render([{ path, enabled: true, name: "view" }]);
  await render([{ path, enabled: false, name: "view" }]);
  await act(async () => pending.resolve([summary("Finished after collapse")]));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(listCalls()).toHaveLength(1);
  expect(views.get("view")!.sessions[0].title).toBe("Finished after collapse");
});

it("ignores a late response after the folder is registered with a replacement project", async () => {
  const path = project("old-project");
  const pending = deferred<HostSessionSummary[]>();
  list = async (id) => id === "old-project" ? pending.promise : [summary("Replacement")];
  const old = prefetchRemoteProjectSessions(path);
  await Promise.resolve();
  rememberRemoteProject(machine.environmentId, {
    id: "replacement", cwd: `/projects/${sequence}/old-project`, name: "Replacement",
  });
  await prefetchRemoteProjectSessions(path);
  pending.resolve([summary("Late old history")]);
  await old;
  expect(cachedRemoteSessions(path)[0].title).toBe("Replacement");
  expect(listCalls()).toHaveLength(2);
});

it("does not let a request from a disconnected machine overwrite its replacement connection", async () => {
  const path = project("reconnected-project");
  const pending = deferred<HostSessionSummary[]>();
  list = () => pending.promise;
  const old = prefetchRemoteProjectSessions(path);
  await Promise.resolve();
  await disconnectMachine(machine.id);
  const replacement = { ...machine, id: "replacement-computer" };
  vi.mocked(invoke).mockImplementationOnce(async () => replacement);
  await connectMachine("Replacement", machine.endpoint, "test-token");
  list = async () => [summary("New connection")];
  await prefetchRemoteProjectSessions(path);
  pending.resolve([summary("Disconnected response")]);
  await old;
  expect(cachedRemoteSessions(path)[0].title).toBe("New connection");
  expect(listCalls()).toHaveLength(2);
  await disconnectMachine(replacement.id);
});

it("keeps failures and cached fallback scoped to the affected project", async () => {
  const failed = project("failed");
  const healthy = project("healthy");
  localStorage.setItem(`monocode.remote-history.v2:${failed}`, JSON.stringify([summary("Recovery") ]));
  list = async (id) => {
    if (id === "failed") throw new Error("SSH refused the request");
    return [summary("Current")];
  };
  await render([
    { path: failed, enabled: true, name: "failed" },
    { path: healthy, enabled: true, name: "healthy" },
  ]);
  expect(views.get("failed")).toMatchObject({
    loaded: true, pending: false, offline: true, error: "SSH refused the request",
  });
  expect(views.get("failed")!.sessions[0].title).toBe("Recovery");
  expect(views.get("healthy")).toMatchObject({ loaded: true, offline: false, error: undefined });
  expect(views.get("healthy")!.sessions[0].title).toBe("Current");

  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(listCalls().filter(([, args]: any) => args.params.projectId === "failed")).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(listCalls().filter(([, args]: any) => args.params.projectId === "failed")).toHaveLength(2);
});

it("retains disconnected cache and refreshes a collapsed subscriber once on retry", async () => {
  const path = project("disconnected");
  localStorage.setItem(`monocode.remote-history.v2:${path}`, JSON.stringify([summary("Offline cache")]));
  await disconnectMachine(machine.id);
  await render([{ path, enabled: false, name: "view" }]);
  await act(async () => {
    await expect(prefetchRemoteProjectSessions(path)).rejects.toThrow("not connected");
  });
  expect(views.get("view")).toMatchObject({ loaded: true, offline: true, pending: false });
  expect(views.get("view")!.sessions[0].title).toBe("Offline cache");
  expect(listCalls()).toHaveLength(0);

  list = async () => [summary("Reconnected")];
  await act(async () => {
    await connectMachine("Computer", machine.endpoint, "test-token");
    refreshRemoteProjectSessions();
  });
  expect(views.get("view")).toMatchObject({ machine, loaded: true, offline: false });
  expect(views.get("view")!.sessions[0].title).toBe("Reconnected");
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(listCalls()).toHaveLength(1);
});

it("registers native Shared Host paths before listing and deduplicates the one-shot request", async () => {
  configureSharedHost(machine.environmentId, [], machine.id);
  const path = `/shared/${sequence}/new-folder`;
  list = async () => [summary("Shared conversation")];
  await render([{ path, enabled: false, name: "view" }]);
  await act(async () => {
    await Promise.all([prefetchRemoteProjectSessions(path), prefetchRemoteProjectSessions(path)]);
  });
  const opened = vi.mocked(invoke).mock.calls.filter(
    ([command, args]: any) => command === "remote_request" && args.method === "projects.open",
  );
  expect(opened).toHaveLength(1);
  expect(listCalls()).toHaveLength(1);
  expect(listCalls()[0][1]).toMatchObject({ params: { projectId: "new-shared-project" } });
  expect(views.get("view")!.sessions[0].title).toBe("Shared conversation");
});

it("keeps the same Host session id distinct between project caches", async () => {
  const first = project("first-project");
  const second = project("second-project");
  list = async (id) => [summary(id)];
  await Promise.all([prefetchRemoteProjectSessions(first), prefetchRemoteProjectSessions(second)]);
  expect(cachedRemoteSessionSummary(first, "same-session-id")!.title).toBe("first-project");
  expect(cachedRemoteSessionSummary(second, "same-session-id")!.title).toBe("second-project");
});

it("caches history without native block IDs and evicts other projects when storage is full", async () => {
  const path = project("trimmed");
  const other = `monocode.remote-history.v2:${project("other")}`;
  localStorage.setItem(other, JSON.stringify([summary("Other")]));
  const nativeSession = {
    provider: "codex", providerSessionId: "native", path: "/tmp/native.jsonl",
    revision: "1", createdAt: 1, updatedAt: 1, blockIds: ["a", "b"], nativeIds: ["a"],
  } as HostSessionSummary["nativeSession"];
  list = async () => [{ ...summary("Native"), nativeSession }];
  const setItem = localStorage.setItem.bind(localStorage);
  let failures = 1;
  const spy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key.endsWith(path) && failures-- > 0) throw new DOMException("full", "QuotaExceededError");
    setItem(key, value);
  });
  await prefetchRemoteProjectSessions(path);
  spy.mockRestore();
  expect(cachedRemoteSessions(path)[0].nativeSession?.blockIds).toEqual(["a", "b"]);
  const stored = JSON.parse(localStorage.getItem(`monocode.remote-history.v2:${path}`)!);
  expect(stored[0].nativeSession).toEqual({ ...nativeSession, blockIds: [], nativeIds: undefined });
  expect(localStorage.getItem(other)).toBeNull();
});

it.each([
  [machine.id, "other-environment"],
  ["local-machine", machine.environmentId],
])("rejects removal of the shared local Host before native disconnect (%s)", async (localId, environmentId) => {
  configureSharedHost(environmentId, [], localId);
  await expect(disconnectMachine(machine.id)).rejects.toThrow("This computer cannot be removed.");
  expect(invoke).not.toHaveBeenCalledWith("remote_disconnect", expect.anything());
});
