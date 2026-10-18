import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostClientState } from "./client-state";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "host-client-state-"));
  let store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    state: new HostClientState(store),
    restart() { store.close(); store = new HostStore(join(directory, "host.db")); return new HostClientState(store); },
  };
}

it("merges independent fields and preserves receipt responses across restart without replaying stale data", () => {
  const s = setup();
  expect(s.state.preferencesRead({ revision: -1 })).toEqual({ revision: 0, imported: false, values: {} });
  const first = { operationId: "desktop-1", changes: { "monocode.colorScheme": "dark" } };
  const accepted = s.state.preferencesPatch(first);
  s.state.preferencesPatch({ operationId: "phone-1", changes: { "monocode.uiLanguage": "zh-CN", "monocode.colorScheme": "light" } });
  const state = s.restart();
  expect(state.preferencesPatch(first)).toEqual(accepted);
  expect(state.preferencesRead()).toMatchObject({ revision: 2, values: { "monocode.colorScheme": "light", "monocode.uiLanguage": "zh-CN" } });
  expect(state.preferencesRead({ revision: 2 })).toBeNull();
  expect(() => state.preferencesPatch({ ...first, changes: { "monocode.colorScheme": "light" } })).toThrow("already used");
});

it("supports independent entity fields, deletion and a one-time release import", () => {
  const { state } = setup();
  const first = 'monocode.projectProviderSettings.v1::["@project:host:project","defaultHarness"]';
  const second = 'monocode.projectProviderSettings.v1::["@project:host:project","defaultModel"]';
  state.preferencesPatch({ operationId: "import-1", importRelease: true, changes: { [first]: '"codex"' } });
  state.preferencesPatch({ operationId: "model-1", changes: { [second]: '"model-1"' } });
  expect(state.preferencesPatch({ operationId: "import-2", importRelease: true, changes: { [first]: '"claude"' } })).toMatchObject({ imported: true, values: { [first]: '"codex"', [second]: '"model-1"' } });
  state.preferencesPatch({ operationId: "delete-1", changes: { [first]: null } });
  expect(state.preferencesRead()!.values).toEqual({ [second]: '"model-1"' });
});

it("rejects credentials, malformed values and invalid field paths atomically", () => {
  const { state } = setup();
  for (const changes of [
    { "monocode.colorScheme": "light", "monocode.deviceToken": "secret" },
    { "monocode.sidebarWidth": "no-number" },
    { 'monocode.defaultModels::["__proto__","token"]': '"secret"' },
    { "monocode.colorScheme": { credentials: "secret" } },
  ]) expect(() => state.preferencesPatch({ operationId: "bad", changes })).toThrow();
  expect(state.preferencesRead()).toEqual({ revision: 0, values: {}, imported: false });
});

it("keeps window snapshots independent and only updates the recent pointer on activation", () => {
  const s = setup();
  s.state.workspacesSave({ operationId: "w1", kind: "desktop", windowId: "a", snapshot: { projectId: "project-a", sessionId: "s-a" } });
  s.state.workspacesSave({ operationId: "w2", kind: "desktop", windowId: "b", snapshot: { projectId: "project-b" } });
  s.state.workspacesSave({ operationId: "w3", kind: "desktop", windowId: "a", snapshot: { projectId: "project-c" }, activate: false });
  expect(s.state.workspacesRead({ kind: "desktop" })!.windowId).toBe("b");
  expect(s.state.workspacesRead({ kind: "desktop", windowId: "a" })!.snapshot).toEqual({ projectId: "project-c" });
  expect(s.state.workspacesRead({ kind: "mobile" })!.windowId).toBe("b");
  s.state.workspacesSave({ operationId: "m1", kind: "mobile", windowId: "phone", snapshot: { projectId: "project-a" } });
  const state = s.restart();
  expect(state.workspacesRead({ kind: "mobile" })!.kind).toBe("mobile");
  expect(state.workspacesRead({ kind: "desktop" })!.windowId).toBe("b");
  state.workspacesSave({ operationId: "w4", kind: "desktop", windowId: "b", snapshot: { projectId: "project-d" } });
  expect(state.workspacesRead({ kind: "mobile" })!.snapshot).toEqual({ projectId: "project-d" });
  expect(state.workspacesRead({ kind: "mobile", windowId: "phone" })!.snapshot).toEqual({ projectId: "project-a" });
  expect(state.workspacesSave({ operationId: "migration", kind: "desktop", windowId: "old", importRelease: true, snapshot: { projectId: "old" } })!.windowId).toBe("b");
});

it("shares only safe connection definitions and does not resurrect a deleted imported connection", () => {
  const s = setup();
  const definition = { id: "server", name: "Build server", kind: "ssh", hostname: "build.local", port: 22, environmentId: "host-1" };
  const original = s.state.connectionsPatch({ operationId: "c1", importRelease: true, changes: { server: definition } });
  expect(s.state.connectionsList({ revision: original.revision })).toBeNull();
  expect(() => s.state.connectionsPatch({ operationId: "c-secret", changes: { server: { ...definition, token: "secret" } } })).toThrow("credentials");
  expect(() => s.state.connectionsPatch({ operationId: "c-url", changes: { server: { ...definition, hostname: "user:password@example.com" } } })).toThrow("hostname");
  s.state.connectionsPatch({ operationId: "c2", changes: { server: null } });
  const state = s.restart();
  expect(state.connectionsPatch({ operationId: "c3", importRelease: true, changes: { server: definition } }).connections).toEqual([]);
  expect(state.connectionsPatch({ operationId: "c1", importRelease: true, changes: { server: definition } })).toEqual(original);
  expect(state.connectionsList()!.connections).toEqual([]);
});

it("stores environments and resolves variables for the most specific folder on the same machine", () => {
  const { state } = setup();
  const root = process.platform === "win32" ? "C:\\code\\app" : "/code/app";
  const nested = process.platform === "win32" ? "C:\\code\\app\\web" : "/code/app/web";
  state.environmentsPatch({ operationId: "env-1", changes: {
    app: { id: "app", name: "App", folders: [root], variables: { API_URL: "outer", SHARED: "1" } },
    web: { id: "web", name: "Web", folders: [nested], variables: { API_URL: "inner" } },
    wsl: { id: "wsl", name: "Linux", machine: { kind: "wsl", distribution: "Ubuntu" }, folders: ["/code/app"], variables: { API_URL: "wsl" } },
  } });
  expect(state.environmentsList()?.environments.map((entry) => entry.name)).toEqual(["App", "Linux", "Web"]);
  expect(state.environmentVariables(process.platform === "win32" ? "c:/CODE/app/src" : "/code/app/src")).toEqual({ API_URL: "outer", SHARED: "1" });
  expect(state.environmentVariables(`${nested}${process.platform === "win32" ? "\\" : "/"}pkg`)).toEqual({ API_URL: "inner" });
  expect(state.environmentVariables(process.platform === "win32" ? "C:\\code\\application" : "/code/application")).toEqual({});
  expect(state.environmentVariables("/code/app", { kind: "wsl", distribution: "Ubuntu" })).toEqual({ API_URL: "wsl" });
  expect(() => state.environmentsPatch({ operationId: "env-2", changes: { bad: { id: "bad", name: "Bad", folders: [root], variables: { MONOCODE_CONTROL_TOKEN: "x" } } } })).toThrow("Invalid environment variable name");
  expect(() => state.environmentsPatch({ operationId: "env-3", changes: { bad: { id: "bad", name: "Bad", folders: ["relative"], variables: {} } } })).toThrow("absolute");
  state.environmentsPatch({ operationId: "env-4", changes: { web: null } });
  expect(state.environmentsList()?.environments).toHaveLength(2);
});
