// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreserveInputFocusOnTouch } from "./inputFocus";

let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
function render() {
  const onClick = vi.fn();
  function TestApp() {
    const input = useRef<HTMLTextAreaElement>(null);
    const surface = useRef<HTMLDivElement>(null);
    usePreserveInputFocusOnTouch(surface, input);
    return createElement(
      "div",
      null,
      createElement("textarea", {
        ref: input,
        defaultValue: "Keep this draft",
      }),
      createElement(
        "div",
        { ref: surface },
        createElement(
          "button",
          { type: "button", onClick },
          createElement("span", null, "Action"),
        ),
        createElement("input", { type: "search" }),
      ),
    );
  }
  act(() => root.render(createElement(TestApp)));
  const input = node.querySelector("textarea")!;
  const button = node.querySelector("button")!;
  const search = node.querySelector("input")!;
  return { input, button, search, onClick };
}
function touch(type: string, target: Element, clientY = 100, count = 1) {
  const point = new Touch({ identifier: 1, target, clientX: 40, clientY });
  const touches =
    count === 2
      ? [point, new Touch({ identifier: 2, target, clientX: 60, clientY })]
      : [point];
  const event = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type === "touchend" || type === "touchcancel" ? [] : touches,
    changedTouches: [point],
  });
  act(() => target.dispatchEvent(event));
  return event;
}
function compatibilityClick(target: Element) {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    detail: 1,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

describe("typing focus during touch actions", () => {
  it("activates an icon's button once and suppresses a later compatibility click", () => {
    const { input, button, onClick } = render();
    input.focus();
    input.setSelectionRange(5, 9, "backward");
    const blur = vi.fn();
    input.addEventListener("blur", blur);
    const label = button.firstElementChild!;
    expect(touch("touchstart", label).defaultPrevented).toBe(false);
    expect(touch("touchend", label).defaultPrevented).toBe(true);
    expect(compatibilityClick(label).defaultPrevented).toBe(true);
    expect(touch("touchend", label).defaultPrevented).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
    expect([
      input.selectionStart,
      input.selectionEnd,
      input.selectionDirection,
    ]).toEqual([5, 9, "backward"]);
    expect(blur).not.toHaveBeenCalled();
  });

  it("allows rapid separate taps and subsequent keyboard and mouse activation", () => {
    const { input, button, onClick } = render();
    input.focus();
    for (let index = 0; index < 2; index++) {
      touch("touchstart", button);
      touch("touchend", button);
      compatibilityClick(button);
    }
    act(() => button.click()); // Keyboard/programmatic activation has detail 0.
    button.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
    expect(compatibilityClick(button).defaultPrevented).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(4);
  });

  it("does not open a keyboard when the input was not focused at touch start", () => {
    const { input, button, onClick } = render();
    touch("touchstart", button);
    expect(touch("touchend", button).defaultPrevented).toBe(false);
    compatibilityClick(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });

  it("allows an editable field to take focus deliberately", () => {
    const { input, search, onClick } = render();
    input.focus();
    touch("touchstart", search);
    search.focus();
    expect(touch("touchend", search).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(search);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("restores the original selection before activating if the WebView already blurred the input", () => {
    const { input, button, onClick } = render();
    input.focus();
    input.setSelectionRange(5, 9, "backward");
    onClick.mockImplementation(() => {
      expect(document.activeElement).toBe(input);
      expect([
        input.selectionStart,
        input.selectionEnd,
        input.selectionDirection,
      ]).toEqual([5, 9, "backward"]);
    });
    touch("touchstart", button);
    input.blur();
    input.setSelectionRange(0, 0);
    expect(touch("touchend", button).defaultPrevented).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus from another input during an unfinished touch", () => {
    const { input, button, search, onClick } = render();
    input.focus();
    touch("touchstart", button);
    search.focus();
    expect(touch("touchend", button).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(search);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("leaves scrolling, multi-touch and cancelled gestures unhandled", () => {
    const { input, button, onClick } = render();
    input.focus();
    touch("touchstart", button);
    expect(touch("touchmove", button, 120).defaultPrevented).toBe(false);
    expect(touch("touchend", button).defaultPrevented).toBe(false);
    touch("touchstart", button);
    touch("touchstart", button, 100, 2);
    expect(touch("touchend", button).defaultPrevented).toBe(false);
    touch("touchstart", button);
    touch("touchcancel", button);
    expect(touch("touchend", button).defaultPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not activate a row after a sheet begins dragging below the tap threshold", () => {
    const { input, button, onClick } = render();
    input.focus();
    button.addEventListener("touchmove", (event) => event.preventDefault(), {
      passive: false,
    });
    touch("touchstart", button);
    expect(touch("touchmove", button, 108).defaultPrevented).toBe(true);
    expect(touch("touchend", button, 108).defaultPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("respects disabled buttons and input disablement during a press", () => {
    const { input, button, onClick } = render();
    input.focus();
    button.disabled = true;
    touch("touchstart", button);
    touch("touchend", button);
    expect(onClick).not.toHaveBeenCalled();
    button.disabled = false;
    touch("touchstart", button);
    input.disabled = true;
    expect(touch("touchend", button).defaultPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ignores disconnected controls and releases its listeners when unmounted", () => {
    const { input, button, onClick } = render();
    input.focus();
    touch("touchstart", button);
    const parent = button.parentElement!;
    button.remove();
    expect(touch("touchend", parent).defaultPrevented).toBe(false);
    parent.append(button);
    touch("touchstart", button);
    act(() => root.render(null));
    expect(touch("touchend", button).defaultPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});
