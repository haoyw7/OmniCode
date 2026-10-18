// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileApp } from "./MobileApp";
import type { Connection, HostConnectionStatus } from "./client";

const host = vi.hoisted(() => ({
  connection: undefined as Connection | undefined,
  status: { state: "disconnected" } as HostConnectionStatus,
  restore: vi.fn(), connect: vi.fn(), settingsLoaded: vi.fn(), settingsRendered: vi.fn(),
}));
vi.mock("./client", () => ({ MobileClient: class {
  get connection() { return host.connection; }
  getConnectionStatus = () => host.status;
  subscribeConnectionStatus = () => () => {};
  hasCapability = () => false;
  restore = host.restore;
  connect = host.connect;
  verify = async () => {};
  pending = async () => undefined;
  savedConnections = async () => [];
  projects = async () => [];
  sessions = async () => [];
  models = async () => ({ models: {}, errors: {} });
  cachedModels = () => undefined;
  rpc = async () => null;
} }));
vi.mock("./MobileSettings", () => {
  host.settingsLoaded();
  return { MobileSettings: ({ onAddConnection }: { onAddConnection: () => void }) => {
    host.settingsRendered();
    return createElement("button", { onClick: onAddConnection }, "Add connection");
  } };
});
vi.mock("./MobileConnectionSheet", () => ({ MobileConnectionSheet: ({ onConnectWith }: {
  onConnectWith: (credentials: { url: string; token: string }) => void;
}) => createElement("button", { onClick: () => onConnectWith({ url: "http://host:3774", token: "123456" }) }, "Pair Host") }));
vi.mock("./MobileHome", () => ({ MobileHome: () => createElement("div", { "data-home": true }, "Home") }));
vi.mock("./MobileAppUpdates", () => ({ useMobileAppUpdates: () => ({}) }));
vi.mock("./useMobileActivity", () => ({ useMobileActivity: () => ({
  unreadIds: new Set(), permission: "unsupported", enabled: false,
}) }));

let root: Root;
let node: HTMLDivElement;
const paired: Connection = { endpoint: "http://host:3774", token: "paired", environmentId: "host", name: "Host" };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  localStorage.clear();
  host.connection = undefined;
  host.status = { state: "disconnected" };
  host.restore.mockReset();
  host.settingsRendered.mockClear();
  host.connect.mockReset().mockImplementation(async () => {
    host.connection = paired;
    host.status = { state: "connected" };
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const mount = () => act(async () => root.render(createElement(MobileApp)));
const settleImports = () => act(async () => vi.dynamicImportSettled());
async function click(text: string) {
  const button = [...node.querySelectorAll("button")].find(button => button.textContent === text)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  await settleImports();
}

it("restores a paired Host without loading or mounting the Settings module", async () => {
  let finish!: () => void;
  const restored = new Promise<void>(resolve => { finish = resolve; });
  host.restore.mockImplementation(async () => {
    await restored;
    host.connection = paired;
    host.status = { state: "connected" };
    return true;
  });
  await mount();
  await settleImports();
  expect(node.querySelector(".mobile-loading[role=status]")).not.toBeNull();
  expect(host.settingsLoaded).not.toHaveBeenCalled();
  await act(async () => finish());
  await settleImports();
  expect(node.querySelector("[data-home]")).not.toBeNull();
  expect(host.settingsLoaded).not.toHaveBeenCalled();
  expect(host.settingsRendered).not.toHaveBeenCalled();
});

it.each(["unpaired", "restore failure"])("keeps pairing available after %s", async (scenario) => {
  if (scenario === "unpaired") host.restore.mockResolvedValue(false);
  else host.restore.mockRejectedValue(new Error("Saved connection could not be read"));
  await mount();
  await settleImports();
  expect(host.settingsRendered).toHaveBeenCalled();
  await click("Add connection");
  await click("Pair Host");
  expect(host.connect).toHaveBeenCalledExactlyOnceWith("http://host:3774", "123456");
  expect(node.querySelector("[data-home]")).not.toBeNull();
});
