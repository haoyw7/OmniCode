// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLanguage } from "../../../shared/i18n/language";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { configureProjectPreferenceStores } from "../model/projectPreferenceRouting";
import { activatePreferenceStore, SharedPreferenceStore, type PreferenceRequest } from "../model/sharedPreferences";
import { SharedStateStatus } from "./SharedStateStatus";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../connections/model/hostWorkspace", () => ({
  hostWorkspacePending: () => false,
  HOST_WORKSPACE_STATUS: "monocode:host-workspace-status",
}));

function host(id: string) {
  const request = vi.fn(async () => ({ revision: 1, imported: true, values: {} })) as PreferenceRequest;
  return { store: new SharedPreferenceStore(id, localStorage, request), request };
}

let container: HTMLDivElement;
let root: Root;
let primary: ReturnType<typeof host>;
let remote: ReturnType<typeof host>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  setUiLanguage("en");
  configureSharedHost("local", [{ id: "project", cwd: "/app", name: "App" }]);
  primary = host("local");
  remote = host("remote");
  activatePreferenceStore(primary.store);
  configureProjectPreferenceStores(primary.store, new Map([["remote", remote.store]]));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  configureProjectPreferenceStores(undefined);
  activatePreferenceStore(undefined);
  configureSharedHost(undefined, []);
  setUiLanguage("en");
  vi.unstubAllGlobals();
});

async function render(pending?: () => boolean) {
  await act(async () => root.render(createElement(SharedStateStatus, { pending })));
}

it("does not show another Host's error or queued settings in this device's sync status", async () => {
  await render();
  vi.mocked(remote.request).mockRejectedValue(new Error("Update Host to share settings."));
  await act(async () => {
    remote.store.setItem("monocode.colorScheme", "dark");
    await remote.store.sync();
  });
  expect(remote.store.error).toBe("Update Host to share settings.");
  expect(remote.store.pendingCount).toBe(1);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(remote.store.getItem("monocode.colorScheme")).toBe("dark");

  // Mobile supplies its own workspace journal but uses the same Host boundary.
  await render(() => false);
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("shows the active Host's errors and clears them after recovery despite another Host's failure", async () => {
  setUiLanguage("zh-CN");
  vi.mocked(primary.request).mockRejectedValue(new Error("Update Host to share settings."));
  vi.mocked(remote.request).mockRejectedValue(new Error("Update Host to share settings."));
  await Promise.all([primary.store.sync(), remote.store.sync()]);
  await render();
  expect(container.textContent).toBe("尚未同步 · 请更新 Host 以共享设置。");

  vi.mocked(primary.request).mockResolvedValue({ revision: 1, imported: true, values: {} });
  await act(async () => { await primary.store.sync(); });
  expect(remote.store.error).toBe("Update Host to share settings.");
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("keeps this device's pending settings and workspace writes visible", async () => {
  vi.mocked(primary.request).mockImplementation(() => new Promise(() => {}));
  primary.store.setItem("monocode.colorScheme", "dark");
  await render();
  expect(container.textContent).toBe("Not yet synced");

  configureProjectPreferenceStores(undefined);
  activatePreferenceStore(undefined);
  await render(() => true);
  expect(container.textContent).toBe("Not yet synced");
  await render(() => false);
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("waits out routine workspace writes but shows errors immediately", async () => {
  vi.useFakeTimers();
  try {
    configureProjectPreferenceStores(undefined);
    activatePreferenceStore(undefined);
    await act(async () => root.render(createElement(SharedStateStatus, { pending: () => true, pendingDelayMs: 1500 })));
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(container.textContent).toBe("Not yet synced");

    vi.mocked(primary.request).mockRejectedValue(new Error("Update Host to share settings."));
    activatePreferenceStore(primary.store);
    await primary.store.sync();
    await act(async () => root.render(createElement(SharedStateStatus, { pending: () => false, pendingDelayMs: 1500 })));
    expect(container.textContent).toBe("Not yet synced · Update Host to share settings.");
  } finally {
    vi.useRealTimers();
  }
});
