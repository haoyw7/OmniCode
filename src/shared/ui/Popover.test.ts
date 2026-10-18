// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
import { duration } from "../motion/tokens";
import { AnimatePresence } from "motion/react";
import { applyReducedMotion } from "../lib/reducedMotion";
import { Popover } from "./Popover";
import { NativePopupHost } from "./NativePopupHost";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "./SurfaceVisibility";

let container: HTMLDivElement;
let host: HTMLDivElement;
let anchor: HTMLButtonElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  host = document.createElement("div");
  anchor = document.createElement("button");
  document.body.append(container, host, anchor);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  host.remove();
  anchor.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function NestedSurface() {
  return useSurfaceVisibility()
    ? createElement("span", { "data-nested-surface": "" }, "Nested surface")
    : null;
}

it("repositions and flips a retained flyout when its anchor moves before reopening", () => {
  let left = 100;
  vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => new DOMRect(left, 200, 20, 24));
  const anchorRef = { current: anchor };
  const render = (open: boolean) => act(() => root.render(createElement(Popover, {
    open, anchor: anchorRef, side: "right", width: 240, gap: 4, "data-flyout": "",
  }, "Choices")));
  render(true);
  const flyout = document.querySelector<HTMLElement>("[data-flyout]")!;
  expect(flyout.dataset.popoverSide).toBe("right");
  render(false);
  act(() => vi.advanceTimersByTime(70));
  left = window.innerWidth - 100;
  render(true);
  expect(document.querySelector("[data-flyout]")).toBe(flyout);
  expect(flyout.dataset.popoverSide).toBe("left");
  expect(flyout.parentElement?.style.left).toBe(`${left - 244}px`);
});

describe.each([false, true])(
  "animated popover with native host: %s",
  (native) => {
    const dismiss = vi.fn();
    function render(open: boolean, visible = true) {
      dismiss.mockClear();
      act(() =>
        root.render(
          createElement(
            SurfaceVisibilityContext.Provider,
            { value: visible },
            createElement(
              NativePopupHost.Provider,
              { value: native ? host : null },
              createElement(
                Popover,
                {
                  open,
                  anchor,
                  autoFocus: true,
                  tabIndex: -1,
                  onDismiss: dismiss,
                  "data-test-popover": "",
                },
                "Menu action",
                createElement(NestedSurface),
              ),
            ),
          ),
        ),
      );
    }

    it("focuses after opening becomes interactive and does not steal focus when motion completes", () => {
      // happy-dom permits focus on inert/hidden content; emulate browser focus
      // rules to catch attempts made before the opening surface is interactive.
      const focus = HTMLElement.prototype.focus;
      vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(
        function (this: HTMLElement, options) {
          if (
            this.closest("[inert]") ||
            this.parentElement?.style.visibility === "hidden"
          )
            return;
          focus.call(this, options);
        },
      );
      render(false);
      anchor.focus();
      render(true);
      expect(document.activeElement).toBe(
        document.querySelector("[data-test-popover]"),
      );
      anchor.focus();
      act(() => vi.advanceTimersByTime(200));
      expect(document.activeElement).toBe(anchor);
    });

    it("retains closing content, disables interaction and nested surfaces, then unmounts", () => {
      render(true);
      const surface = document.querySelector<HTMLElement>(
        "[data-test-popover]",
      )!;
      expect(document.querySelector("[data-nested-surface]")).not.toBeNull();
      render(false);
      expect(surface.inert).toBe(true);
      expect(surface.getAttribute("aria-hidden")).toBe("true");
      expect(surface.textContent).toBe("Menu action");
      expect(document.querySelector("[data-nested-surface]")).toBeNull();
      act(() => {
        anchor.focus();
        document.body.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(dismiss).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(anchor);
      act(() => vi.advanceTimersByTime(duration.pop * 1000));
      expect(document.querySelector("[data-test-popover]")).toBeNull();
    });

    it("reverses closing on the same surface and cancels its pending unmount", () => {
      render(true);
      const surface = document.querySelector<HTMLElement>(
        "[data-test-popover]",
      )!;
      render(false);
      act(() => vi.advanceTimersByTime(70));
      render(true);
      expect(document.querySelector("[data-test-popover]")).toBe(surface);
      expect(surface.inert).toBe(false);
      act(() => vi.advanceTimersByTime(duration.pop * 1000));
      expect(document.querySelector("[data-test-popover]")).toBe(surface);
      expect(
        surface.closest("[data-fold-state]")?.getAttribute("data-fold-state"),
      ).toBe("open");
    });

    it("closes immediately with reduced motion and suppresses hidden portals", () => {
      vi.spyOn(window, "matchMedia").mockReturnValue({
        matches: true,
      } as MediaQueryList);
      render(true);
      render(false);
      expect(document.querySelector("[data-test-popover]")).toBeNull();
      render(true);
      render(true, false);
      expect(document.querySelector("[data-test-popover]")).toBeNull();
    });

    it("keeps an open draft mounted when the reduced-motion preference changes", () => {
      const draft = () => document.querySelector<HTMLInputElement>("[data-popover-draft]")!;
      const renderDraft = (open: boolean) => act(() => root.render(
        createElement(NativePopupHost.Provider, { value: native ? host : null },
          createElement(Popover, { open, anchor },
            createElement("input", { "data-popover-draft": "", defaultValue: "Draft" }))),
      ));
      renderDraft(true);
      const input = draft();
      input.value = "Unsent edit";
      try {
        act(() => applyReducedMotion("on"));
        expect(draft()).toBe(input);
        expect(draft().value).toBe("Unsent edit");
        renderDraft(false);
        expect(draft()).toBeNull();
      } finally {
        act(() => applyReducedMotion("system"));
      }
    });

    it("blocks action handlers while the exiting menu is retained", () => {
      const select = vi.fn();
      const renderAction = (open: boolean) => act(() => root.render(
        createElement(NativePopupHost.Provider, { value: native ? host : null },
          createElement(Popover, { open, anchor },
            createElement("button", { "data-popover-action": "", onClick: select }, "Select"))),
      ));
      renderAction(true);
      const button = document.querySelector<HTMLButtonElement>("[data-popover-action]")!;
      renderAction(false);
      act(() => button.click());
      expect(select).not.toHaveBeenCalled();
    });

    it("retains a conditionally mounted default popover and disables its actions during exit", () => {
      const select = vi.fn();
      const renderConditional = (open: boolean) => act(() => root.render(
        createElement(NativePopupHost.Provider, { value: native ? host : null },
          createElement(AnimatePresence, { propagate: true }, open
            ? createElement(Popover, { key: "menu", anchor, "data-test-popover": "", onDismiss: dismiss },
                createElement("button", { "data-popover-action": "", onClick: select }, "Select"),
                createElement(NestedSurface))
            : null)),
      ));
      renderConditional(true);
      const surface = document.querySelector<HTMLElement>("[data-test-popover]")!;
      const button = surface.querySelector<HTMLButtonElement>("button")!;
      renderConditional(false);
      expect(document.querySelector("[data-test-popover]")).toBe(surface);
      expect(surface.inert).toBe(true);
      expect(surface.getAttribute("aria-hidden")).toBe("true");
      expect(document.querySelector("[data-nested-surface]")).toBeNull();
      act(() => button.click());
      expect(select).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(duration.pop * 1000));
      expect(document.querySelector("[data-test-popover]")).toBeNull();
    });

    it("removes an externally controlled popover immediately when reduced motion is enabled", () => {
      const renderConditional = (open: boolean) => act(() => root.render(
        createElement(NativePopupHost.Provider, { value: native ? host : null },
          createElement(AnimatePresence, { propagate: true }, open
            ? createElement(Popover, { key: "menu", anchor, "data-test-popover": "" }, "Menu")
            : null)),
      ));
      try {
        act(() => applyReducedMotion("on"));
        renderConditional(true);
        renderConditional(false);
        expect(document.querySelector("[data-test-popover]")).toBeNull();
      } finally {
        act(() => applyReducedMotion("system"));
      }
    });

    it("finishes a conditional exit when its parent surface is hidden and does not revive it", () => {
      const renderConditional = (open: boolean, visible: boolean) => act(() => root.render(
        createElement(NativePopupHost.Provider, { value: native ? host : null },
          createElement(SurfaceVisibilityContext.Provider, { value: visible },
            createElement(AnimatePresence, { propagate: true }, open
              ? createElement(Popover, { key: "menu", anchor, "data-test-popover": "" }, "Menu")
              : null))),
      ));
      renderConditional(true, true);
      expect(document.querySelector("[data-test-popover]")).not.toBeNull();
      renderConditional(false, false);
      expect(document.querySelector("[data-test-popover]")).toBeNull();
      renderConditional(false, true);
      expect(document.querySelector("[data-test-popover]")).toBeNull();
    });
  },
);
