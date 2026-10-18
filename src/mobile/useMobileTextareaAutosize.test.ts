// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";
import { useMobileTextareaAutosize } from "./useMobileTextareaAutosize";
import { installKeyboardMotion, KEYBOARD_EVENT } from "./keyboardMotion";

let root: Root;
let node: HTMLDivElement;
const observers: { notify: (contentWidth?: number) => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
let width = 320;
function Field({ value }: { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useMobileTextareaAutosize(ref, value, { minHeight: 28, viewportHeightRatio: 0.25 });
  return createElement("textarea", { ref, value, readOnly: true });
}
function render(value: string, visible = true) {
  act(() => root.render(createElement(SurfaceVisibilityContext.Provider,
    { value: visible }, createElement(Field, { value }))));
  return node.querySelector("textarea")!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  width = 320;
  observers.length = 0;
  vi.spyOn(HTMLTextAreaElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLTextAreaElement) {
    return this.value.length > 10 ? (width < 300 ? 120 : 72) : 24;
  });
  vi.spyOn(globalThis, "ResizeObserver").mockImplementation(function (callback) {
    const observer = {
      notify: (contentWidth?: number) => callback(contentWidth === undefined ? [] : [
        { contentRect: { width: contentWidth } } as ResizeObserverEntry,
      ], {} as ResizeObserver),
      disconnect: vi.fn(), observe: vi.fn(), unobserve: vi.fn(),
    };
    observers.push(observer);
    return observer;
  });
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("grows and shrinks using one measuring node without resetting focus or rebuilding observers", () => {
  const clone = vi.spyOn(HTMLTextAreaElement.prototype, "cloneNode");
  const field = render("A multiline draft to measure");
  act(() => field.focus());
  expect(field.style.height).toBe("72px");
  // The browser has already inserted the edit before the controlled value commits.
  field.value = "An edited multiline draft to measure";
  field.setSelectionRange(3, 3);
  render("An edited multiline draft to measure");
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(3);
  render("Short");
  expect(field.style.height).toBe("28px");
  expect(clone).toHaveBeenCalledTimes(1);
  expect(observers).toHaveLength(1);
  expect(node.querySelectorAll("textarea:not([data-autosize-measure])")).toHaveLength(1);
  const mirror = node.querySelector<HTMLTextAreaElement>("[data-autosize-measure]")!;
  expect(mirror.inert).toBe(true);
  expect(mirror.getAttribute("aria-hidden")).toBe("true");
  expect(field.style.height).not.toBe("0px");
});

it("ignores height-only observations, rewraps width changes and suspends while the page is hidden", () => {
  const reads = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get");
  const field = render("A multiline draft to measure");
  const initial = reads.mock.calls.length;
  act(() => observers[0].notify());
  expect(reads).toHaveBeenCalledTimes(initial);
  width = 240;
  act(() => observers[0].notify());
  expect(field.style.height).toBe("120px");
  render("A multiline draft to measure", false);
  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  const hidden = reads.mock.calls.length;
  render("A changed draft while hidden", false);
  act(() => window.dispatchEvent(new Event("resize")));
  expect(reads).toHaveBeenCalledTimes(hidden);
  render("A changed draft while hidden");
  expect(observers).toHaveLength(2);
  expect(field.style.height).toBe("120px");
});

it("clears a capped draft without measuring layout and can immediately restore the same text", () => {
  const reads = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(1200);
  const widths = vi.spyOn(HTMLTextAreaElement.prototype, "clientWidth", "get");
  const draft = "A long draft\n".repeat(100);
  const field = render(draft);
  expect(field.style.height).toBe("168px");
  act(() => field.focus());
  field.scrollTop = 1032;
  field.setSelectionRange(0, draft.length);
  // Mirror the browser's select-all/delete before React commits the value.
  field.value = "";
  field.setSelectionRange(0, 0);
  reads.mockClear();
  widths.mockClear();
  render("");
  expect(field.style.height).toBe("28px");
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(reads).not.toHaveBeenCalled();
  expect(widths).not.toHaveBeenCalled();
  render(draft);
  expect(field.style.height).toBe("168px");
  expect(reads).toHaveBeenCalledOnce();
});

it("uses observed widths without synchronous reads during height animations", () => {
  const reads = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get");
  const widths = vi.spyOn(HTMLTextAreaElement.prototype, "clientWidth", "get");
  const field = render("A multiline draft to measure");
  act(() => observers[0].notify(320));
  reads.mockClear();
  widths.mockClear();
  for (let frame = 0; frame < 12; frame++) act(() => observers[0].notify(320));
  expect(reads).not.toHaveBeenCalled();
  expect(widths).not.toHaveBeenCalled();
  width = 240;
  act(() => observers[0].notify(240));
  expect(field.style.height).toBe("120px");
  expect(reads).toHaveBeenCalledOnce();
});

it("reuses the attached mirror and cached width across edits, but rewraps after viewport resizing", () => {
  const widths = vi.spyOn(HTMLTextAreaElement.prototype, "clientWidth", "get");
  const field = render("A multiline draft to measure");
  act(() => observers[0].notify(320));
  const mirror = node.querySelector<HTMLTextAreaElement>("[data-autosize-measure]")!;
  const insert = vi.spyOn(field, "after");
  const remove = vi.spyOn(mirror, "remove");
  widths.mockClear();
  render("An edited multiline draft");
  render("");
  render("The next multiline draft");
  expect(widths).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(node.querySelector("[data-autosize-measure]")).toBe(mirror);
  expect(mirror.value).toBe("The next multiline draft");
  width = 240;
  act(() => window.dispatchEvent(new Event("resize")));
  expect(field.style.height).toBe("120px");
  expect(mirror.style.width).toBe("240px");
  render("The next multiline draft", false);
  expect(mirror.isConnected).toBe(false);
});

it("reuses wrapping measurements when the keyboard changes the height limit", () => {
  const stopKeyboard = installKeyboardMotion(node);
  const keyboard = (height: number) => act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height, viewport: 400, duration: 0, easing: "linear" },
  })));
  const reads = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get");
  const widths = vi.spyOn(HTMLTextAreaElement.prototype, "clientWidth", "get");
  try {
    const field = render("A multiline draft to measure");
    expect(field.style.height).toBe("72px");
    const initialReads = reads.mock.calls.length;
    const initialWidths = widths.mock.calls.length;
    for (let cycle = 0; cycle < 2; cycle++) {
      keyboard(200);
      expect(field.style.height).toBe("50px");
      keyboard(0);
      expect(field.style.height).toBe("72px");
    }
    // No synchronous layout read after native motion has resized the shell.
    expect(reads).toHaveBeenCalledTimes(initialReads);
    expect(widths).toHaveBeenCalledTimes(initialWidths);

    keyboard(200);
    width = 240;
    act(() => observers[0].notify());
    expect(field.style.height).toBe("50px");
    keyboard(0);
    expect(field.style.height).toBe("100px");
    render("Short");
    expect(field.style.height).toBe("28px");
  } finally {
    stopKeyboard();
  }
});
