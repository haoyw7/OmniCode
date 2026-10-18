// @vitest-environment happy-dom
import { act, createElement, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
import { AppViewDialog } from "./AppViewDialog";

vi.mock("motion/react", async (original) => {
  const actual = await original<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});

let container: HTMLDivElement;
let root: Root;
let trigger: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // happy-dom has no layout; actual visibility is also checked in Chromium/WebKit.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList);
  container = document.createElement("div");
  trigger = document.createElement("button");
  document.body.append(trigger, container);
  trigger.focus();
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  trigger.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function VisibilityProbe() {
  const visible = useSurfaceVisibility();
  return createElement("button", { "data-dialog-content-visible": String(visible) }, "Content");
}

it("keeps the exiting dialog mounted but noninteractive, then restores focus", async () => {
  const onClose = vi.fn();
  const render = (open: boolean) => act(async () => root.render(createElement(PresenceBoundary, {
    children: open ? createElement(AppViewDialog, {
      title: "Settings",
      onClose,
      children: createElement(VisibilityProbe),
    }) : null,
  })));

  await render(true);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
  expect(document.querySelector('[data-dialog-content-visible="true"]')).not.toBeNull();
  await render(false);
  const dialog = document.querySelector<HTMLElement>("[data-app-view-dialog]")!;
  expect(dialog).not.toBeNull();
  expect(dialog.hasAttribute("inert")).toBe(true);
  expect(dialog.getAttribute("aria-hidden")).toBe("true");
  expect(document.querySelector('[data-dialog-content-visible="false"]')).not.toBeNull();
  act(() => dialog.querySelector(".modal-backdrop")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => completeMotionAnimation(document.body));
  expect(document.querySelector("[data-app-view-dialog]")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

function tab(element: HTMLElement, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
  act(() => element.dispatchEvent(event));
  return event;
}

it("wraps both Tab boundaries while excluding unavailable controls and leaves Escape to the view", async () => {
  const onClose = vi.fn();
  await act(async () => root.render(createElement(AppViewDialog, {
    title: "Settings",
    onClose,
    children: createElement("div", null,
      createElement("input", { "data-field": "first" }),
      createElement("button", { "data-field": "last" }, "Last"),
      createElement("button", { disabled: true }, "Disabled"),
      createElement("button", { hidden: true }, "Hidden"),
      createElement("button", { style: { display: "none" } }, "Not displayed"),
      createElement("div", { inert: true }, createElement("button", null, "Inert")),
      createElement("div", { "aria-hidden": true }, createElement("button", null, "Excluded")),
      createElement("button", { tabIndex: -1 }, "Programmatic only"),
    ),
  })));
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
  const last = document.querySelector<HTMLButtonElement>('[data-field="last"]')!;
  expect(tab(close, true).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(last);
  expect(tab(last).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
  expect(tab(close).defaultPrevented).toBe(false);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => close.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
});

it("respects a control's prevented Tab and a newer nested dialog's focus ownership", async () => {
  await act(async () => root.render(createElement(AppViewDialog, {
    title: "Settings",
    onClose: vi.fn(),
    children: createElement("button", {
      "data-owned-tab": true,
      onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => event.preventDefault(),
    }, "Own keyboard handling"),
  })));
  const control = document.querySelector<HTMLButtonElement>("[data-owned-tab]")!;
  control.focus();
  expect(tab(control).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(control);

  const nested = document.createElement("div");
  document.body.append(nested);
  try {
    await act(async () => root.render(createElement(AppViewDialog, {
      title: "Settings",
      onClose: vi.fn(),
      children: createPortal(createElement("div", { role: "dialog", "aria-modal": true },
        createElement("button", { "data-nested-control": true }, "Nested")), nested),
    })));
    const child = nested.querySelector<HTMLButtonElement>("[data-nested-control]")!;
    child.focus();
    expect(tab(child).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(child);
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
    close.focus();
    expect(tab(close, true).defaultPrevented).toBe(false);
  } finally {
    nested.remove();
  }
});
