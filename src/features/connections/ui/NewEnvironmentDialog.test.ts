// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewEnvironmentDialog, parseEnvironmentVariables } from "./NewEnvironmentDialog";
import { pickFolders } from "../../../platform/tauri/fs";
import { saveHostEnvironment } from "../model/hostEnvironments";
import { ensureSharedProject } from "../model/remoteProjects";

vi.mock("../../../platform/tauri/fs", () => ({ pickFolders: vi.fn() }));
vi.mock("../../../platform/tauri/wsl", () => ({ listWslDistributions: vi.fn().mockResolvedValue([]), pickWslFolder: vi.fn() }));
vi.mock("../model/hostEnvironments", async (importActual) => ({
  ...(await importActual<typeof import("../model/hostEnvironments")>()),
  saveHostEnvironment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../model/remoteProjects", async (importActual) => ({
  ...(await importActual<typeof import("../model/remoteProjects")>()),
  ensureSharedProject: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
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

it("parses NAME=value lines and rejects reserved or malformed lines", () => {
  expect(parseEnvironmentVariables("# comment\nexport API_URL = \"http://x\"\n\nEMPTY=\nA=b=c")).toEqual({
    variables: { API_URL: "http://x", EMPTY: "", A: "b=c" },
  });
  expect(parseEnvironmentVariables("MONOCODE_CONTROL_TOKEN=x").error).toEqual({ line: 1, reserved: true });
  expect(parseEnvironmentVariables("ok=1\nnot valid").error).toEqual({ line: 2, reserved: false });
});

it("creates a local environment with folders and variables, then opens its first folder", async () => {
  vi.mocked(pickFolders).mockResolvedValue(["C:/code/app"]);
  vi.mocked(ensureSharedProject).mockResolvedValue({ key: "project-key" } as Awaited<ReturnType<typeof ensureSharedProject>>);
  const onOpen = vi.fn();
  await act(async () => root.render(createElement(NewEnvironmentDialog, { onClose: vi.fn(), onOpen })));
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
  expect(tabs).toEqual(["Local", "SSH", "Remote Control"]);
  const submit = [...document.querySelectorAll("button")].find((button) => button.textContent === "Create environment")!;
  expect(submit.disabled).toBe(true);

  const name = document.querySelector<HTMLInputElement>('input[placeholder="My app"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "App");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const add = [...document.querySelectorAll("button")].find((button) => button.textContent === "Add")!;
  await act(async () => add.click());
  expect(document.body.textContent).toContain("C:/code/app");

  const disclosure = [...document.querySelectorAll<HTMLButtonElement>("button[aria-controls]")]
    .find((button) => button.textContent?.startsWith("Environment variables"))!;
  expect(disclosure.textContent).toContain("None for this environment");
  await act(async () => disclosure.click());
  const variables = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Environment variables"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(variables, "API_URL=http://localhost");
    variables.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(submit.disabled).toBe(false);
  await act(async () => submit.click());
  expect(saveHostEnvironment).toHaveBeenCalledWith(expect.objectContaining({
    name: "App", folders: ["C:/code/app"], variables: { API_URL: "http://localhost" },
  }));
  expect(vi.mocked(saveHostEnvironment).mock.calls[0][0]).not.toHaveProperty("machine");
  expect(ensureSharedProject).toHaveBeenCalledWith("C:/code/app");
  expect(onOpen).toHaveBeenCalledWith("project-key");
});
