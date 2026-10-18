import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostProject } from "../features/connections/model/protocol";
import { setUiLanguage } from "../shared/i18n/language";
import { MobileApp } from "./MobileApp";

const registered = vi.hoisted(() => [] as HostProject[]);
const healthyStatus = vi.hoisted(() => ({ state: "connected" as const }));
const host = vi.hoisted(() => ({
  connection: {
    endpoint: "http://computer:3774",
    name: "My computer",
    environmentId: "project-picker-flow",
  },
  getConnectionStatus: () => healthyStatus,
  hasCapability: () => false,
  subscribeConnectionStatus: () => () => {},
  restore: vi.fn(async () => true),
  verify: vi.fn(async () => {}),
  pending: vi.fn(async () => undefined),
  savedConnections: vi.fn(async () => []),
  switchTo: vi.fn(async () => undefined),
  projects: vi.fn(async () => [...registered]),
  sessions: vi.fn(async () => []),
  cachedModels: () => undefined,
  cachedSession: () => undefined,
  sessionPreviews: async () => undefined,
  models: vi.fn(async () => ({
    models: {
      codex: [{ id: "codex:test", name: "Test model", harness: "codex" }],
    },
    errors: {},
  })),
  browseDirectories: vi.fn(async (path?: string) =>
    path === "/home/me/My app"
      ? { path, parent: "/home/me", entries: [] }
      : {
          path: "/home/me",
          parent: "/home",
          entries: [{ name: "My app", path: "/home/me/My app" }],
        },
  ),
  openProject: vi.fn(async (cwd: string) => {
    const project = { id: "new-project", name: "My app", cwd };
    registered.push(project);
    return project;
  }),
}));
vi.mock("./client", () => ({
  MobileClient: vi.fn(function () {
    return host;
  }),
}));
vi.mock("./MobileAppUpdates", () => ({
  useMobileAppUpdates: () => ({}),
  MobileAppUpdates: () => null,
}));
vi.mock("./useMobileActivity", () => ({
  useMobileActivity: () => ({
    unreadIds: new Set(),
    permission: "unsupported",
    enabled: false,
  }),
}));

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  startMotionClock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  registered.length = 0;
  localStorage.clear();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  stopMotionClock();
  act(() => root.unmount());
  node.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(MobileApp)));
}
async function click(label: string, scope: Element = node) {
  const target = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      !element.closest('[inert], [aria-hidden="true"]') &&
      (element.getAttribute("aria-label") ?? element.textContent?.trim()) ===
      label,
  );
  expect(target, `button ${label}`).toBeDefined();
  await act(async () => { target!.click(); await vi.dynamicImportSettled(); });
}
async function pick() {
  const dialog = node.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  await click("My app", dialog);
  expect(host.openProject).not.toHaveBeenCalled();
  await click("Open project", dialog);
  expect(host.openProject).toHaveBeenCalledExactlyOnceWith("/home/me/My app");
  const backdrop = dialog.closest<HTMLElement>(".mobile-sheet-backdrop")!;
  expect(backdrop.dataset.foldState).toBe("closing");
  expect(backdrop.hasAttribute("inert")).toBe(true);
  expect(node.querySelector('.mobile-sheet-backdrop:not([inert]) [role="dialog"]')).toBeNull();
  await advanceMotionTimers(600);
  expect(node.querySelector('[role="dialog"]')).toBeNull();
  expect(host.sessions).toHaveBeenCalledWith("new-project");
  expect(host.models).toHaveBeenCalledWith("new-project");
  expect(node.querySelector(".mobile-app")?.getAttribute("data-view")).toBe("home");
  expect(node.querySelector("header")?.textContent).toContain("My app");
}

describe("mobile project folder picker entry points", () => {
  it("opens the first browsed project from the empty-project screen", async () => {
    await render();
    await click("Open project");
    expect(host.browseDirectories).toHaveBeenCalledWith(undefined);
    await pick();
  });
  it("opens a project from the project list capsule reached through the drawer", async () => {
    registered.push({
      id: "old-project",
      name: "Existing app",
      cwd: "/existing",
    });
    await render();
    await click("Menu");
    await click("More");
    await click("Projects", node.querySelector(".mobile-drawer")!);
    const capsule = node.querySelector<HTMLButtonElement>(".mobile-home-open-project");
    expect(capsule).not.toBeNull();
    await act(async () => capsule!.click());
    await pick();
    const drawer = node.querySelector(".mobile-drawer-backdrop")!;
    expect(drawer.getAttribute("data-open")).toBe("false");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(registered).toHaveLength(2);
  });
});
