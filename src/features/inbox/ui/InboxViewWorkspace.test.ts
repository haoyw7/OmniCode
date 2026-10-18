import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxView } from "./InboxView";
import { saveInboxConnections } from "../model/inboxFilters";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("No native bridge")),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("only leaves Inbox on Escape while its workspace pane is active", async () => {
  const onClose = vi.fn();
  const props = {
    cwd: "/repo",
    recents: [],
    onClose,
    onAsk: async () => "",
    onAskRestart: async () => "",
    onAskMount: () => {},
    onOpenIntegrations: () => {},
  };
  await act(async () =>
    root.render(createElement(InboxView, { ...props, active: false })),
  );
  act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    ),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(container.querySelector("[data-app-inbox]")).not.toBeNull();

  await act(async () =>
    root.render(createElement(InboxView, { ...props, active: true })),
  );
  act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    ),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("dismisses the connection menu before returning to chat on Escape", async () => {
  saveInboxConnections({
    github: false,
    linear: false,
    jira: false,
    gitlab: false,
    azuredevops: false,
  });
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(InboxView, {
        active: true,
        cwd: "/repo",
        recents: [],
        onClose,
        onAsk: async () => "",
        onAskRestart: async () => "",
        onAskMount: () => {},
        onOpenIntegrations: () => {},
      }),
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Connect an inbox source"]',
      )!
      .click(),
  );
  expect(
    document.querySelector(
      '[role="menu"][aria-label="Connect an inbox source"]',
    ),
  ).not.toBeNull();
  act(() =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
        bubbles: true,
      }),
    ),
  );
  act(() => completeMotionAnimation(document.body));
  expect(
    document.querySelector(
      '[role="menu"][aria-label="Connect an inbox source"]',
    ),
  ).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  act(() =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
        bubbles: true,
      }),
    ),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
