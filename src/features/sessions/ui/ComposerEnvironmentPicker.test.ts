// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerEnvironmentPicker } from "./ComposerEnvironmentPicker";
import { OPEN_NEW_ENVIRONMENT_EVENT, OPEN_REMOTE_PROJECT_EVENT } from "../../connections/model/connections";
import type { HostEnvironmentDefinition } from "../../connections/model/hostState";

import { listWslDistributions } from "../../../platform/tauri/wsl";
vi.mock("../../../platform/tauri/wsl", () => ({ listWslDistributions: vi.fn() }));
const environments = vi.hoisted(() => ({ value: [] as HostEnvironmentDefinition[] }));
vi.mock("../../connections/model/hostEnvironments", async (importActual) => ({
  ...(await importActual<typeof import("../../connections/model/hostEnvironments")>()),
  useHostEnvironments: () => ({ environments: environments.value, loaded: true, error: "" }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.mocked(listWslDistributions).mockReset().mockResolvedValue(["Ubuntu", "Debian"]);
  environments.value = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Picker(props: { remote: boolean; cwd?: string; onCwdChange?: (cwd: string) => void }) {
  const [selectedDistribution, onEnvironmentChange] = useState<string | null>();
  return createElement(ComposerEnvironmentPicker, { ...props, selectedDistribution, onEnvironmentChange });
}
async function open(remote = false, props: { cwd?: string; onCwdChange?: (cwd: string) => void } = {}) {
  await act(async () => root.render(createElement(Picker, { remote, ...props })));
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await act(async () => trigger.click());
  return trigger;
}
const option = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
  .find((entry) => entry.textContent?.startsWith(label))!;

it("opens the environment menu with the actual selection", async () => {
  const trigger = await open();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector('input[placeholder="Search environments…"]')).not.toBeNull();
  expect(option("This machine").getAttribute("aria-selected")).toBe("true");
  expect(option("Cloud")).toBeUndefined();
  expect(option("WSL").getAttribute("aria-disabled")).toBeNull();
  await act(async () => option("This machine").click());
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("selects and checks WSL without opening a project flow", async () => {
  const listener = vi.fn();
  window.addEventListener(OPEN_REMOTE_PROJECT_EVENT, listener);
  try {
    const trigger = await open();
    await act(async () => option("WSL").click());
    expect(listener).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(option("WSL").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-submenu="true"]')?.getAttribute("data-popover-side")).toBe("right");
    expect(listWslDistributions).toHaveBeenCalledOnce();
    await act(async () => option("Debian").click());
    expect(listener).not.toHaveBeenCalled();
    expect(trigger.textContent).toBe("WSL · Debian");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => trigger.click());
    expect(option("WSL").getAttribute("aria-selected")).toBe("true");
    expect(option("WSL").querySelector('[data-ui="select-check"]')).not.toBeNull();
    expect(option("This machine").getAttribute("aria-selected")).toBe("false");
    await act(async () => option("WSL").click());
    expect(option("Debian").getAttribute("aria-selected")).toBe("true");
    expect(option("Debian").querySelector('[data-ui="select-check"]')).not.toBeNull();
    await act(async () => option("Debian").click());
    await act(async () => trigger.click());
    await act(async () => option("This machine").click());
    expect(trigger.textContent).toBe("Local");
    expect(listener).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(OPEN_REMOTE_PROJECT_EVENT, listener);
  }
});

it.each([
  ["Remote Control", OPEN_REMOTE_PROJECT_EVENT],
  ["New environment", OPEN_NEW_ENVIRONMENT_EVENT],
])("opens the existing %s flow without changing the current environment", async (label, event) => {
  const listener = vi.fn();
  window.addEventListener(event, listener);
  try {
    const trigger = await open();
    await act(async () => option(label).click());
    expect(listener).toHaveBeenCalledOnce();
    expect(trigger.textContent).toBe("Local");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  } finally {
    window.removeEventListener(event, listener);
  }
});

it("keeps remote sessions selected and cannot silently move them to this computer", async () => {
  const trigger = await open(true);
  expect(option("Remote Control").getAttribute("aria-selected")).toBe("true");
  expect(option("This machine").getAttribute("aria-disabled")).toBe("true");
  await act(async () => option("This machine").click());
  expect(trigger.textContent).toBe("Remote");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("returns to the environment menu with Escape and can reopen WSL", async () => {
  const trigger = await open();
  const wsl = option("WSL");
  await act(async () => wsl.click());
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(wsl.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(wsl);
  await act(async () => wsl.click());
  expect(wsl.getAttribute("aria-expanded")).toBe("true");
});

it.each(["empty", "error"])("shows WSL discovery %s inside the side panel", async (state) => {
  if (state === "empty") vi.mocked(listWslDistributions).mockResolvedValue([]);
  else vi.mocked(listWslDistributions).mockRejectedValue(new Error("WSL is not installed"));
  const trigger = await open();
  await act(async () => option("WSL").click());
  expect(document.querySelector('[data-submenu="true"]')?.textContent).toContain(
    state === "empty" ? "No WSL distributions found" : "WSL is not installed",
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("opens WSL by keyboard and selects within the child list", async () => {
  const listener = vi.fn();
  window.addEventListener(OPEN_REMOTE_PROJECT_EVENT, listener);
  try {
    const trigger = await open();
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search environments…"]')!;
    for (const key of ["ArrowDown", "ArrowDown", "ArrowRight"]) {
      await act(async () => search.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
    const child = document.querySelector<HTMLElement>('[data-submenu="true"] [role="listbox"]')!;
    expect(child).not.toBeNull();
    for (const key of ["ArrowDown", "Enter"]) {
      await act(async () => child.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
    expect(listener).not.toHaveBeenCalled();
    expect(trigger.textContent).toBe("WSL · Debian");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  } finally {
    window.removeEventListener(OPEN_REMOTE_PROJECT_EVENT, listener);
  }
});

it("lists saved environments, marks the one containing the project and opens its first folder", async () => {
  environments.value = [
    { id: "app", name: "My app", folders: ["C:/code/app", "C:/code/lib"], variables: { API_URL: "x" } },
    { id: "empty", name: "Empty", folders: [], variables: {} },
  ];
  const onCwdChange = vi.fn();
  const trigger = await open(false, { cwd: "c:/Code/App/web", onCwdChange });
  expect(trigger.textContent).toBe("My app");
  expect(option("My app").getAttribute("aria-selected")).toBe("true");
  expect(option("Empty")).toBeUndefined();
  await act(async () => root.render(createElement(Picker, { remote: false, cwd: "C:/other", onCwdChange })));
  expect(trigger.textContent).toBe("Local");
  await act(async () => option("My app").click());
  expect(onCwdChange).toHaveBeenCalledWith("C:/code/app");
});
