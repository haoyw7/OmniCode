import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { queryClient } from "../../../shared/lib/queryClient";
import type { Root } from "react-dom/client";
import { createRoot } from "../../../../tests/helpers/queryRoot";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxView } from "./InboxView";
import { loadInboxSource, saveInboxConnections, saveInboxSource } from "../model/inboxFilters";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("No native bridge")),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  queryClient.clear();
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

it("keeps a linked item's temporary GitHub source out of the saved filter", async () => {
  saveInboxSource("linear");
  saveInboxConnections({ github: true, linear: true, jira: false, gitlab: false, azuredevops: false });
  await act(async () => root.render(createElement(InboxView, {
    cwd: "/repo", recents: [],
    target: { kind: "issue", repo: "owner/repo", number: 1, url: "https://github.com/owner/repo/issues/1" },
    onAsk: async () => "", onAskRestart: async () => "", onAskMount: () => {}, onOpenIntegrations: () => {},
  })));
  expect(loadInboxSource()).toBe("linear");
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
