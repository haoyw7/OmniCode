// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  decodeHostWorkspace, encodeHostWorkspace, HostWorkspaceJournal,
  mobileWorkspaceLocation, type HostStateRequest, type WorkspaceRecord,
} from "./hostWorkspace";
import { configureSharedHost, remoteProjectFor, rememberRemoteProject } from "./remoteProjects";
import { rememberRemoteSession, remoteSessionFor, remoteSessionScopeFor } from "./connections";
import { newTab } from "../../workspace/model/layout";
import { newSession } from "../../sessions/model/session";
import { collectWorkspaceSnapshot } from "../../workspace/model/workspaceSnapshot";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  configureSharedHost("host-a", [{ id: "project-a", cwd: "/work/app", name: "App" }], "machine-a");
});

it("retains offline writes and retries an uncertain receipt with the original operation ID", async () => {
  let online = false;
  const calls: Record<string, unknown>[] = [];
  const request = vi.fn(async (_method, params) => {
    calls.push(params);
    if (!online) throw new Error("offline");
    return { ...params, revision: 1, updatedAt: 1 };
  }) as HostStateRequest;
  const journal = new HostWorkspaceJournal("host-a", "window-a", "desktop", request, localStorage);
  await journal.save({ tabs: ["chat"] }, true);
  expect(journal.pending).toBe(true);
  online = true;
  await journal.flush();
  expect(journal.pending).toBe(false);
  expect(calls).toHaveLength(2);
  expect(calls[1].operationId).toBe(calls[0].operationId);
});

it("does not claim the most recent window on a background snapshot update", async () => {
  const request = vi.fn(async (_method, params) => ({ ...params, revision: 1, updatedAt: 1 })) as HostStateRequest;
  const first = new HostWorkspaceJournal("host-a", "window-a", "desktop", request, localStorage);
  const second = new HostWorkspaceJournal("host-a", "window-b", "desktop", request, localStorage);
  await first.save({ selection: "one" }, true);
  await second.save({ selection: "two" }, false);
  expect(request).toHaveBeenLastCalledWith("workspaces.save", expect.objectContaining({ windowId: "window-b", activate: false }));
  expect(JSON.parse(localStorage.getItem("monocode.host-workspace.v1:host-a:cache:desktop")!).windowId).toBe("window-a");
});

it("keeps caches and pending operations isolated by verified Host identity", async () => {
  const request = vi.fn().mockRejectedValue(new Error("offline")) as HostStateRequest;
  const first = new HostWorkspaceJournal("host-a", "window-a", "desktop", request, localStorage);
  await first.save({ location: "private-a" }, true);
  const second = new HostWorkspaceJournal("host-b", "window-b", "desktop", request, localStorage);
  expect(second.pending).toBe(false);
  await expect(second.read()).rejects.toThrow("offline");
});

it("restores the latest durable unsent layout after an offline restart", async () => {
  const request = vi.fn().mockRejectedValue(new Error("offline")) as HostStateRequest;
  const previous = new HostWorkspaceJournal("host-a", "old-window", "desktop", request, localStorage);
  await previous.save({ selection: "first" }, true);
  await previous.save({ selection: "latest" }, false);
  const restarted = new HostWorkspaceJournal("host-a", "new-window", "desktop", request, localStorage);
  expect((await restarted.read())?.snapshot).toEqual({ selection: "latest" });
  expect(restarted.pending).toBe(true);
});

it("restores portable project and session references on another desktop", async () => {
  const session = { ...newSession("codex", "/work/app"), id: "shell-a" };
  const tab = newTab(session.id);
  rememberRemoteSession(session.id, "host-session", { environmentId: "host-a", projectId: "project-a" });
  const original = collectWorkspaceSnapshot([tab], [session], tab.id, "/work/app", new Map());
  const encoded = await encodeHostWorkspace(original);
  expect(encoded.workspace.projectCwd).toBe("remote://host-a/work/app");
  expect(encoded.location).toEqual({ environmentId: "host-a", projectId: "project-a", sessionId: "host-session" });
  localStorage.clear();
  configureSharedHost("host-b", [], "machine-b");
  const restored = decodeHostWorkspace(encoded)!;
  expect(restored.projectCwd).toBe("remote://host-a/work/app");
  expect(remoteProjectFor(restored.projectCwd)?.projectId).toBe("project-a");
  expect(remoteSessionFor("shell-a")).toBe("host-session");
  expect(remoteSessionScopeFor("shell-a")).toEqual({ environmentId: "host-a", projectId: "project-a" });
  configureSharedHost("host-a", [], "machine-a");
  expect(decodeHostWorkspace(encoded)?.projectCwd).toBe("/work/app");
});

it("projects only the active location onto mobile and rejects another Host's selection", () => {
  const location = { environmentId: "host-a", projectId: "project-a", sessionId: "session-a" };
  const record: WorkspaceRecord = { revision: 2, kind: "desktop", windowId: "desktop", updatedAt: 1,
    snapshot: { location, workspace: { secretDesktopState: "not projected" } } };
  expect(mobileWorkspaceLocation(record, "host-a")).toEqual(location);
  expect(mobileWorkspaceLocation(record, "host-b")).toBeUndefined();
});

it("keeps mixed-Host worktree paths scoped to their own project", async () => {
  rememberRemoteProject("host-b", { id: "project-b", cwd: "/remote", name: "Remote" });
  const local = { ...newSession("codex", "/work/app"), id: "local-shell", executionCwd: "/work/app-trees/one" };
  const remote = { ...newSession("codex", "remote://host-b/remote"), id: "remote-shell", executionCwd: "/remote-trees/two" };
  const tabs = [newTab(local.id), newTab(remote.id)];
  const snapshot = collectWorkspaceSnapshot(tabs, [local, remote], tabs[1].id, remote.cwd, new Map());
  const encoded = await encodeHostWorkspace(snapshot);
  expect(encoded.workspace.sessions.map((entry) => entry.executionCwd)).toEqual([
    "remote://host-a/work/app-trees/one", "remote://host-b/remote-trees/two",
  ]);
  const legacy = JSON.parse(JSON.stringify(encoded));
  for (const entry of legacy.workspace.sessions) {
    entry.worktreeCwd = entry.executionCwd;
    delete entry.executionCwd;
  }
  const restored = decodeHostWorkspace(legacy)!;
  expect(restored.sessions.map((entry) => entry.executionCwd)).toEqual([
    "/work/app-trees/one", "remote://host-b/remote-trees/two",
  ]);
  expect(JSON.stringify(restored.sessions)).not.toContain("worktreeCwd");
});

it("restores WSL identities without turning Linux paths into native Windows paths", async () => {
  configureSharedHost("host-a", [
    { id: "wsl-a", cwd: "/work/app", name: "App", machine: { kind: "wsl", distribution: "Ubuntu" } },
  ], "machine-a");
  const session = { ...newSession("codex", "wsl://Ubuntu/work/app"), executionCwd: "wsl://Ubuntu/work/app-trees/fix" };
  const tab = newTab(session.id);
  const encoded = await encodeHostWorkspace(collectWorkspaceSnapshot([tab], [session], tab.id, session.cwd, new Map()));
  expect(encoded.projects).toEqual([{ environmentId: "host-a", projectId: "wsl-a", cwd: "/work/app", machine: { kind: "wsl", distribution: "Ubuntu" } }]);
  configureSharedHost(undefined, []);
  configureSharedHost("host-a", [], "machine-a");
  const restored = decodeHostWorkspace(encoded)!;
  expect(restored.projectCwd).toBe("wsl://Ubuntu/work/app");
  expect(restored.sessions[0].executionCwd).toBe("wsl://Ubuntu/work/app-trees/fix");
  expect(remoteProjectFor(restored.projectCwd)).toMatchObject({ projectId: "wsl-a", local: true, machine: { kind: "wsl", distribution: "Ubuntu" } });
});
