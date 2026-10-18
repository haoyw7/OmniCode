import { duration } from "../../motion/tokens";
// @vitest-environment happy-dom
import { act, createElement, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MenuPanel } from "./MenuPanel";
import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../SurfaceVisibility";


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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function NestedPortal() {
  return useSurfaceVisibility()
    ? createElement("span", { "data-nested-portal": "" }, "Nested menu")
    : null;
}
function render(open: boolean, visible = true) {
  act(() =>
    root.render(
      createElement(
        SurfaceVisibilityContext.Provider,
        { value: visible },
        createElement(
          MenuPanel,
          { open, inset: true, anchor: null, "data-menu": "" },
          "Action",
          createElement(NestedPortal),
        ),
      ),
    ),
  );
}

it("retains the closing surface, disables interaction and nested portals, then unmounts", () => {
  render(true);
  const menu = container.querySelector<HTMLElement>("[data-menu]")!;
  expect(container.querySelector("[data-nested-portal]")).not.toBeNull();
  render(false);
  expect(menu.inert).toBe(true);
  expect(menu.getAttribute("aria-hidden")).toBe("true");
  expect(menu.textContent).toBe("Action");
  expect(container.querySelector("[data-nested-portal]")).toBeNull();
  act(() => vi.advanceTimersByTime(duration.pop * 1000));
  expect(container.querySelector("[data-menu]")).toBeNull();
});

it("reverses closing on the same surface and cancels the pending unmount", () => {
  render(true);
  const menu = container.querySelector("[data-menu]");
  render(false);
  act(() => vi.advanceTimersByTime(70));
  render(true);
  expect(container.querySelector("[data-menu]")).toBe(menu);
  expect(menu?.hasAttribute("inert")).toBe(false);
  act(() => vi.advanceTimersByTime(duration.pop * 1000));
  expect(menu?.getAttribute("aria-hidden")).not.toBe("true");
});

it("closes immediately with reduced motion and removes portals in a hidden surface", () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as MediaQueryList);
  render(true);
  render(false);
  expect(container.querySelector("[data-menu]")).toBeNull();
  render(true);
  render(true, false);
  expect(container.querySelector("[data-menu]")).toBeNull();
});

it("preserves styling and animates the closing lifetime for other picker consumers", () => {
  act(() =>
    root.render(
      createElement(
        MenuPanel,
        {
          open: true,
          inset: false,
          anchor: null,
          className: "existing-menu",
          "data-menu": "",
        },
        "Action",
      ),
    ),
  );
  expect(container.querySelector(".existing-menu")).not.toBeNull();
  expect(container.querySelector(".composer-popover")).toBeNull();
  act(() =>
    root.render(
      createElement(
        MenuPanel,
        { open: false, inset: false, anchor: null },
        "Action",
      ),
    ),
  );
  expect(container.querySelector<HTMLElement>("[data-menu]")?.inert).toBe(true);
  act(() => completeMotionAnimation(container));
  expect(container.querySelector("[data-menu]")).toBeNull();
});

it("dismisses only the nested menu on Escape and restores its row focus", () => {
  const dismissParent = vi.fn();
  function NestedMenus() {
    const [childOpen, setChildOpen] = useState(true);
    const anchor = useRef<HTMLButtonElement>(null);
    return createElement(MenuPanel, { open: true, anchor: null, onDismiss: dismissParent },
      createElement("button", { ref: anchor }, "Branch"),
      createElement(MenuPanel, {
        open: childOpen, anchor, submenu: true, "data-child": "",
        onDismiss: () => setChildOpen(false),
      }, "main"),
    );
  }
  act(() => root.render(createElement(NestedMenus)));
  const child = container.querySelector<HTMLElement>("[data-child]")!;
  const parent = child.parentElement!.closest('[data-ui="menu-panel"]')!;
  expect(child.dataset.menuTree).toBe(parent.getAttribute("data-menu-tree"));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(dismissParent).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe("Branch");
  expect(child.inert).toBe(true);
  act(() => completeMotionAnimation(container));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(dismissParent).toHaveBeenCalledOnce();
});

vi.mock("react-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-dom")>(), createPortal: (children: ReactNode) => children,
}));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
