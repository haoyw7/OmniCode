// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { completeMotionAnimation } from "../../../tests/helpers/motionDriver";
import { PresenceBoundary } from "./PresenceBoundary";
import { Popover } from "./Popover";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function AccountMenu({ label }: { label: string }) {
  const [revealed, setRevealed] = useState(false);
  return createElement(Popover, { anchor: new DOMRect(10, 10, 20, 20) },
    createElement("button", { "data-account-menu": "", onClick: () => setRevealed(!revealed) },
      `${label}: ${revealed ? "Hide email" : "Reveal email"}`));
}
function render(open: boolean, label = "Account", menuKey = "account") {
  act(() => root.render(createElement(PresenceBoundary, null,
    open ? createElement(AccountMenu, { key: menuKey, label }) : null)));
}
function activeMenu() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-account-menu]"))
    .find((button) => !button.closest("[inert]"))!;
}

it("keeps state during one open lifetime and resets it after a rapid close and reopen", () => {
  render(true);
  const first = activeMenu();
  act(() => first.click());
  render(true, "Updated account");
  expect(activeMenu()).toBe(first);
  expect(first.textContent).toContain("Hide email");
  render(false);
  expect(first.closest("[inert]")).not.toBeNull();
  render(true);
  const reopened = activeMenu();
  expect(reopened).not.toBe(first);
  expect(reopened.textContent).toContain("Reveal email");
  act(() => completeMotionAnimation(first.closest("[data-fold-state]")!));
  expect(activeMenu()).toBe(reopened);
});

it("honors an existing child key while the boundary remains open", () => {
  render(true, "First account", "first");
  const first = activeMenu();
  act(() => first.click());
  render(true, "Second account", "second");
  expect(activeMenu()).not.toBe(first);
  expect(activeMenu().textContent).toContain("Second account: Reveal email");
});
