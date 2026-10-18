// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GraphResizeSash } from "./GitHistoryGraph";

let container: HTMLDivElement;
let root: Root;
let pendingFrame: FrameRequestCallback | undefined;

function flushFrame() {
  const frame = pendingFrame;
  pendingFrame = undefined;
  act(() => frame?.(0));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pendingFrame = undefined;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    pendingFrame = callback;
    return 1;
  }));
  vi.stubGlobal("cancelAnimationFrame", () => { pendingFrame = undefined; });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render() {
  const onHeightPaint = vi.fn();
  const onHeightCommit = vi.fn();
  act(() =>
    root.render(
      createElement(GraphResizeSash, {
        height: 240,
        maxHeight: () => 400,
        onHeightPaint,
        onHeightCommit,
      }),
    ),
  );
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
  const capture = new Set<number>();
  handle.setPointerCapture = (id) => capture.add(id);
  handle.releasePointerCapture = (id) => capture.delete(id);
  return { handle, capture, onHeightPaint, onHeightCommit };
}

function pointer(
  target: EventTarget,
  type: string,
  clientY: number,
  pointerId = 1,
) {
  act(() =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId,
        clientY,
      }),
    ),
  );
}

it("resizes through the shared target, ignores other pointers and commits a clamped height", () => {
  const { handle, capture, onHeightPaint, onHeightCommit } = render();
  const previousCursor = document.body.style.cursor;
  expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
  expect(handle.getAttribute("aria-valuenow")).toBe("240");
  pointer(handle, "pointerdown", 300);
  expect(document.querySelector<HTMLElement>("[data-resize-cursor]")?.style.cursor).toBe("row-resize");
  pointer(window, "pointermove", 260, 2);
  expect(onHeightPaint).not.toHaveBeenCalled();
  pointer(window, "pointermove", 260);
  expect(onHeightPaint).not.toHaveBeenCalled();
  flushFrame();
  expect(onHeightPaint).toHaveBeenLastCalledWith(280);
  pointer(window, "pointermove", 0);
  pointer(window, "pointerup", 0);
  expect(onHeightPaint).toHaveBeenLastCalledWith(400);
  expect(onHeightCommit).toHaveBeenCalledExactlyOnceWith(400);
  expect(capture.has(1)).toBe(false);
  expect(document.body.style.cursor).toBe(previousCursor);
  expect(document.documentElement.classList.contains("is-resizing")).toBe(
    false,
  );
  expect(document.querySelector("[data-resize-cursor]")).toBeNull();
});

it("retains the minimum height and double-click reset", () => {
  const { handle, onHeightPaint, onHeightCommit } = render();
  pointer(handle, "pointerdown", 300);
  pointer(window, "pointermove", 900);
  flushFrame();
  expect(onHeightPaint).toHaveBeenLastCalledWith(120);
  pointer(window, "pointerup", 900);
  expect(onHeightCommit).toHaveBeenLastCalledWith(120);
  act(() =>
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  expect(onHeightCommit).toHaveBeenLastCalledWith(240);
});

it("coalesces samples, flushes the release position and cancels queued work on unmount", () => {
  const { handle, capture, onHeightPaint, onHeightCommit } = render();
  pointer(handle, "pointerdown", 300);
  pointer(window, "pointermove", 260);
  pointer(window, "pointermove", 240);
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  expect(onHeightCommit).not.toHaveBeenCalled();
  flushFrame();
  expect(onHeightPaint).toHaveBeenCalledExactlyOnceWith(300);
  pointer(window, "pointerup", 220);
  expect(onHeightPaint).toHaveBeenLastCalledWith(320);
  expect(onHeightCommit).toHaveBeenCalledExactlyOnceWith(320);
  expect(pendingFrame).toBeUndefined();

  pointer(handle, "pointerdown", 300);
  pointer(window, "pointermove", 200);
  act(() => root.render(null));
  expect(pendingFrame).toBeUndefined();
  expect(capture.size).toBe(0);
  expect(document.documentElement.classList.contains("is-resizing")).toBe(false);
  const commits = onHeightCommit.mock.calls.length;
  pointer(window, "pointerup", 200);
  expect(onHeightCommit).toHaveBeenCalledTimes(commits);
});
