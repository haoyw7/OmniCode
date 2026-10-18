// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharedPreferenceStore, type PreferenceRequest } from "./sharedPreferences";
import { createProjectPreferenceCodec } from "./projectPreferenceCodec";
import { configureProjectPreferenceStores, projectPreferencePending, routeGet, routeSet } from "./projectPreferenceRouting";
import { configureSharedHost, REMOTE_PROJECTS_CHANGED, rememberRemoteProject } from "../../connections/model/remoteProjects";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const key = "monocode.projectProviderSettings.v1";
function host(id: string) {
  let revision = 1;
  const values: Record<string, string> = {};
  const request = vi.fn(async (method, params) => {
    if (method === "preferences.patch") {
      for (const [field, value] of Object.entries(params.changes)) {
        if (value === null) delete values[field]; else values[field] = value as string;
      }
      revision++;
    }
    return { revision, imported: true, values: { ...values } };
  }) as PreferenceRequest;
  return { store: new SharedPreferenceStore(id, localStorage, request, createProjectPreferenceCodec()), request };
}
beforeEach(() => {
  localStorage.clear();
  configureSharedHost(undefined, []);
  configureSharedHost("local", [{ id: "local-project", cwd: "/app", name: "App" }], "local-machine");
  rememberRemoteProject("remote", { id: "remote-project", cwd: "/app", name: "Remote app" });
});
afterEach(() => configureProjectPreferenceStores(undefined));

it("aggregates project choices but sends each edit only to the project's Host", async () => {
  const local = host("local");
  const remote = host("remote");
  local.store.setItem(key, JSON.stringify({ "/app": { defaultHarness: "codex" } }));
  remote.store.setItem(key, JSON.stringify({ "remote://remote/app": { defaultHarness: "claude" } }));
  await Promise.all([local.store.sync(), remote.store.sync()]);
  configureProjectPreferenceStores(local.store, new Map([["remote", remote.store]]));
  expect(JSON.parse(routeGet(key)!)).toEqual({ "/app": { defaultHarness: "codex" }, "remote://remote/app": { defaultHarness: "claude" } });
  vi.mocked(local.request).mockClear();
  vi.mocked(remote.request).mockClear();
  routeSet(key, JSON.stringify({ "/app": { defaultHarness: "codex" }, "remote://remote/app": { defaultHarness: "omp" } }));
  await Promise.all([local.store.sync(), remote.store.sync()]);
  expect(vi.mocked(local.request).mock.calls.some(([method]) => method === "preferences.patch")).toBe(false);
  const changes = vi.mocked(remote.request).mock.calls.find(([method]) => method === "preferences.patch")?.[1].changes;
  expect(changes).toEqual({ 'monocode.projectProviderSettings.v1::["@project:remote:remote-project","defaultHarness"]': '"omp"' });
});

it("keeps unregistered project choices durable until the Host returns a project ID", async () => {
  const local = host("local");
  configureProjectPreferenceStores(local.store);
  routeSet(key, JSON.stringify({ "/new": { defaultHarness: "pi" } }));
  expect(projectPreferencePending()).toBe(true);
  expect(JSON.parse(routeGet(key)!)).toEqual({ "/new": { defaultHarness: "pi" } });
  await local.store.sync();
  expect(JSON.stringify(vi.mocked(local.request).mock.calls)).not.toContain("/new");
  configureSharedHost("local", [{ id: "new-project", cwd: "/new", name: "New" }], "local-machine");
  window.dispatchEvent(new Event(REMOTE_PROJECTS_CHANGED));
  await local.store.sync();
  expect(projectPreferencePending()).toBe(false);
  expect(JSON.parse(local.store.getItem(key)!)).toEqual({ "/new": { defaultHarness: "pi" } });
});

it("scopes pending project settings to their Host, including unregistered projects", async () => {
  const local = host("local");
  configureProjectPreferenceStores(local.store);
  routeSet(key, JSON.stringify({ "remote://unregistered/app": { defaultHarness: "pi" } }));
  await local.store.sync();
  expect(projectPreferencePending()).toBe(true);
  expect(projectPreferencePending("local")).toBe(false);
  expect(projectPreferencePending("unregistered")).toBe(true);

  routeSet(key, JSON.stringify({ "/new": { defaultHarness: "pi" } }));
  await local.store.sync();
  expect(projectPreferencePending("local")).toBe(true);
  expect(projectPreferencePending("unregistered")).toBe(false);
});

it("does not route global preferences or project rail ordering away from the primary Host", () => {
  const local = host("local");
  configureProjectPreferenceStores(local.store);
  expect(routeGet("monocode.projectRailOrder")).toBeUndefined();
  expect(routeSet("monocode.colorScheme", "dark")).toBe(false);
});

it("retains a newly opened folder in recents while waiting for project registration", async () => {
  const local = host("local");
  configureProjectPreferenceStores(local.store);
  const recentKey = "monocode.recentProjects";
  const raw = JSON.stringify([{ path: "/new", openedAt: 12 }, { path: "/app", openedAt: 4 }]);
  routeSet(recentKey, raw);
  expect(projectPreferencePending()).toBe(true);
  expect(projectPreferencePending("local")).toBe(true);
  expect(projectPreferencePending("remote")).toBe(false);
  expect(routeGet(recentKey)).toBe(raw);
  expect(vi.mocked(local.request).mock.calls).toHaveLength(0);
  configureSharedHost("local", [{ id: "new-project", cwd: "/new", name: "New" }], "local-machine");
  window.dispatchEvent(new Event(REMOTE_PROJECTS_CHANGED));
  await local.store.sync();
  expect(projectPreferencePending()).toBe(false);
  expect(routeGet(recentKey)).toBeUndefined();
  expect(local.store.getItem(recentKey)).toBe(raw);
});


it("durably stages mixed pins until their embedded project identity is known", async () => {
  const local = host("local");
  configureProjectPreferenceStores(local.store);
  const pins = "monocode.sidebarPinnedOrder.v1";
  const raw = JSON.stringify(['session:["/new-project","session-id"]']);
  expect(routeSet(pins, raw)).toBe(true);
  expect(routeGet(pins)).toBe(raw);
  expect(projectPreferencePending()).toBe(true);
  expect(vi.mocked(local.request)).not.toHaveBeenCalled();
  configureSharedHost("local", [{ id: "new-project", cwd: "/new-project", name: "New" }], "local-machine");
  window.dispatchEvent(new Event(REMOTE_PROJECTS_CHANGED));
  await local.store.sync();
  expect(routeGet(pins)).toBeUndefined();
  const call = vi.mocked(local.request).mock.calls.find(([method]) => method === "preferences.patch");
  expect(call?.[1].changes).toEqual({ [pins]: JSON.stringify(['session:["@project:local:new-project","session-id"]']) });
});
