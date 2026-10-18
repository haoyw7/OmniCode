import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TitleModelSettings } from "./TitleModelSettings";
import { remoteRequest } from "../../connections/model/connections";

vi.mock("../../connections/model/connections", () => ({
  remoteRequest: vi.fn(),
  useRemoteMachines: () => ({
    machines: [
      { id: "local", name: "Local" },
      { id: "remote", name: "Remote" },
    ],
    loaded: true,
  }),
}));
vi.mock("../../connections/model/remoteProjects", () => ({
  sharedHostMachineId: () => "local",
}));
const status = {
  enabled: true,
  endpoint: "https://example.com/v1/chat/completions",
  model: "small-model",
  hasApiKey: true,
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(remoteRequest).mockReset().mockResolvedValue(status);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function input(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>("fieldset button")!.click();
  });
}

async function renderExpanded() {
  await act(async () => root.render(createElement(TitleModelSettings)));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("button[aria-expanded]")!
      .click(),
  );
}

it("preserves an undisclosed key on ordinary edits and clears a newly submitted key from the form", async () => {
  await renderExpanded();
  const fields = container.querySelectorAll<HTMLInputElement>("input");
  const model = fields[2];
  const key = fields[3];
  expect(key.type).toBe("password");
  expect(key.value).toBe("");
  await input(model, "new-model");
  await save();
  expect(remoteRequest).toHaveBeenLastCalledWith("local", "titleModel.save", {
    enabled: true,
    endpoint: status.endpoint,
    model: "new-model",
  });
  await input(key, "new-secret");
  await save();
  expect(remoteRequest).toHaveBeenLastCalledWith("local", "titleModel.save", {
    enabled: true,
    endpoint: status.endpoint,
    model: status.model,
    apiKey: "new-secret",
  });
  expect(key.value).toBe("");
});

it("discards unsaved credentials when switching machines", async () => {
  await renderExpanded();
  await input(
    container.querySelector<HTMLInputElement>('input[type="password"]')!,
    "local-only-secret",
  );
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
      .click();
  });
  await act(async () => {
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((option) => option.textContent?.trim() === "Remote")!
      .click();
  });
  expect(remoteRequest).toHaveBeenLastCalledWith("remote", "titleModel.status");
  expect(
    container.querySelector<HTMLInputElement>('input[type="password"]')!.value,
  ).toBe("");
  expect(
    vi
      .mocked(remoteRequest)
      .mock.calls.filter((call) => call[1] === "titleModel.save"),
  ).toHaveLength(0);
});

it("keeps saving unavailable when the Host cannot load its settings", async () => {
  vi.mocked(remoteRequest).mockRejectedValue(new Error("Host unavailable"));
  await renderExpanded();
  expect(container.querySelector("fieldset")!.disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(
    "Host unavailable",
  );
});

it("starts collapsed and retains unsaved input through closing and reopening", async () => {
  await act(async () => root.render(createElement(TitleModelSettings)));
  const trigger = container.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  )!;
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(remoteRequest).not.toHaveBeenCalled();
  await act(async () => trigger.click());
  const key = container.querySelector<HTMLInputElement>(
    'input[type="password"]',
  )!;
  await input(key, "unsaved-key");
  await act(async () => trigger.click());
  const fold = container.querySelector<HTMLElement>(".zen-fold-item")!;
  expect(fold.getAttribute("aria-hidden")).toBe("true");
  expect(fold.hasAttribute("inert")).toBe(true);
  await act(async () =>
    completeMotionAnimation(fold),
  );
  expect(fold.hidden).toBe(true);
  await act(async () => trigger.click());
  expect(container.querySelector('input[type="password"]')).toBe(key);
  expect(key.value).toBe("unsaved-key");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("opens search results and shows the connection test progress and result", async () => {
  await act(async () =>
    root.render(createElement(TitleModelSettings, { revealed: true })),
  );
  expect(
    container
      .querySelector("button[aria-expanded]")!
      .getAttribute("aria-expanded"),
  ).toBe("true");
  let finish!: (value: unknown) => void;
  vi.mocked(remoteRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const test =
    container.querySelectorAll<HTMLButtonElement>("fieldset button")[1];
  await act(async () => test.click());
  expect(remoteRequest).toHaveBeenLastCalledWith("local", "titleModel.test");
  expect(test.textContent).toBe("Testing connection…");
  expect(test.disabled).toBe(true);
  await act(async () => finish({ title: "Sample title", workItem: null }));
  expect(test.textContent).toBe("Test connection");
  expect(container.querySelector('[role="status"]')!.textContent).toContain(
    "Sample title",
  );
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
