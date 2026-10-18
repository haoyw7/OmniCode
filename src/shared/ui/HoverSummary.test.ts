// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoverSummary, useHoverSummary } from "./HoverSummary";
import { SurfaceVisibilityContext } from "./SurfaceVisibility";
import { completeMotionAnimation } from "../../../tests/helpers/motionDriver";
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});

function finishClosing() {
  act(() => document.querySelectorAll("[inert]").forEach(completeMotionAnimation));
}

let root: Root;
let container: HTMLDivElement;
let visible = true;
let enabled = true;
const onOpen = vi.fn();
function Fixture() {
  const hover = useHoverSummary<HTMLButtonElement>({
    enabled,
    interactive: true,
    onOpen,
  });
  return createElement(
    "div",
    {},
    createElement(
      "button",
      { ref: hover.anchorRef, ...hover.triggerProps, "data-trigger": true },
      "Project",
    ),
    createElement(HoverSummary, {
      hover,
      role: "dialog",
      label: "Summary",
      children: createElement("button", { "data-action": true }, "Pin"),
    }),
  );
}
function render() {
  act(() =>
    root.render(
      createElement(
        SurfaceVisibilityContext.Provider,
        { value: visible },
        createElement(Fixture),
      ),
    ),
  );
  finishClosing();
}
const trigger = () =>
  container.querySelector<HTMLButtonElement>("[data-trigger]")!;
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]');
function pointer(
  element: HTMLElement,
  type: string,
  pointerType = "mouse",
  relatedTarget: EventTarget | null = null,
) {
  act(() =>
    element.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerType, relatedTarget }),
    ),
  );
  finishClosing();
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers();
  visible = enabled = true;
  onOpen.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("opens, ignores touch, and retains direct pointer transfer until dismissal completes", () => {
  pointer(trigger(), "pointerover", "touch");
  expect(panel()).toBeNull();
  pointer(trigger(), "pointerover");
  expect(panel()).not.toBeNull();
  expect(panel()!.style.animation).toBe("none");
  expect(onOpen).toHaveBeenCalledTimes(1);
  pointer(trigger(), "pointerout", "mouse", document.body);
  expect(panel()).toBeNull();
  pointer(trigger(), "pointerover");
  expect(panel()).not.toBeNull();
  expect(onOpen).toHaveBeenCalledTimes(2);
  const surface = panel()!;
  const frame = surface.parentElement!;
  pointer(trigger(), "pointerout", "mouse", frame);
  pointer(frame, "pointerover", "mouse", trigger());
  pointer(surface, "pointerover", "mouse", trigger());
  expect(panel()).not.toBeNull();
  pointer(surface, "pointerout", "mouse", frame);
  expect(panel()).toBe(surface);
  pointer(surface, "pointerout", "mouse", trigger());
  pointer(trigger(), "pointerover", "mouse", surface);
  expect(panel()).toBe(surface);
  expect(onOpen).toHaveBeenCalledTimes(2);
  pointer(trigger(), "pointerout", "mouse", document.body);
  expect(panel()).toBeNull();
  act(() => vi.advanceTimersByTime(500));
  expect(panel()).toBeNull();
  pointer(trigger(), "pointerover");
  pointer(trigger(), "pointerout", "mouse", panel()!.parentElement!);
  pointer(panel()!.parentElement!, "pointerout", "mouse", document.body);
  expect(panel()).toBeNull();
});
it("restores focus on Escape without reopening until a fresh focus/hover intent", () => {
  act(() => trigger().focus());
  expect(panel()).not.toBeNull();
  act(() =>
    trigger().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.activeElement).toBe(panel()!.querySelector("button"));
  act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  finishClosing();
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(trigger());
  act(() => vi.advanceTimersByTime(500));
  expect(panel()).toBeNull();
  pointer(trigger(), "pointerover");
  expect(panel()).not.toBeNull();
});
it("hides immediately when the containing surface closes or the summary is disabled", () => {
  pointer(trigger(), "pointerover");
  expect(panel()).not.toBeNull();
  visible = false;
  render();
  act(() => vi.advanceTimersByTime(500));
  expect(panel()).toBeNull();
  expect(onOpen).toHaveBeenCalledTimes(1);
  visible = true;
  render();
  act(() => trigger().focus());
  expect(panel()).not.toBeNull();
  enabled = false;
  render();
  expect(panel()).toBeNull();
  enabled = true;
  render();
  expect(panel()).toBeNull();
});
it("allows scrolling card contents but dismisses on list scroll and outside click", () => {
  act(() => trigger().focus());
  act(() => panel()!.dispatchEvent(new Event("scroll", { bubbles: true })));
  expect(panel()).not.toBeNull();
  act(() => panel()!.querySelector<HTMLButtonElement>("button")!.focus());
  act(() => container.dispatchEvent(new Event("scroll", { bubbles: true })));
  finishClosing();
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(trigger());
  pointer(trigger(), "pointerover");
  act(() =>
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    ),
  );
  finishClosing();
  expect(panel()).toBeNull();
});

it("does not treat the native focus after a pointer press as keyboard hover intent", () => {
  pointer(trigger(), "pointerdown");
  act(() => trigger().focus());
  expect(panel()).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
  act(() => trigger().blur());
  act(() => trigger().focus());
  expect(panel()).not.toBeNull();
});

it("retains focus transfers within the card and closes when focus leaves", () => {
  act(() => trigger().focus());
  const surface = panel()!;
  act(() => surface.querySelector<HTMLButtonElement>("button")!.focus());
  expect(panel()).toBe(surface);
  act(() => trigger().focus());
  expect(panel()).toBe(surface);
  act(() => trigger().blur());
  finishClosing();
  expect(panel()).toBeNull();
});
