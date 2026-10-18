// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDragResize } from "./useDragResize";
import { isPaneResizing, onPaneResizeSettled } from "../lib/paneResize";

let container: HTMLDivElement;
let root: Root;
let resize: ReturnType<typeof useDragResize>;
let onCommit: ReturnType<typeof vi.fn>;
let pendingFrame: FrameRequestCallback | undefined;
let renders: number;
const maximum = vi.fn(() => 560);

function Probe({ value, direction }: { value?: number; direction?: "left" | "right" | "top" | "bottom" } = {}) {
  renders += 1;
  resize = useDragResize({
    direction,
    min: 260,
    max: maximum,
    defaultWidth: 260,
    initial: 260,
    value,
    onCommit,
  });
  return createElement(
    "div",
    { ref: resize.setPaneRef, "data-pane": true },
    createElement("div", {
      role: "separator",
      onPointerDown: resize.onPointerDown,
    }),
  );
}

function pane() {
  return container.querySelector<HTMLElement>("[data-pane]")!;
}

function handle() {
  return container.querySelector<HTMLElement>('[role="separator"]')!;
}

function startDrag() {
  act(() =>
    handle().dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: 260,
      }),
    ),
  );
}

function pointer(type: string, clientX: number) {
  act(() =>
    window.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX })),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  renders = 0;
  maximum.mockClear();
  pendingFrame = undefined;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    pendingFrame = callback;
    return 1;
  }));
  vi.stubGlobal("cancelAnimationFrame", () => { pendingFrame = undefined; });
  onCommit = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Probe)));
  handle().setPointerCapture = vi.fn();
  handle().releasePointerCapture = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.cursor = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pane drag resizing", () => {
  it.each(["pointerup", "pointercancel", "blur", "lostpointercapture", "unmount"])("defers expensive pane fitting until %s", (reason) => {
    const settled = vi.fn();
    const unsubscribe = onPaneResizeSettled(settled);
    try {
      startDrag();
      pointer("pointermove", 400);
      act(() => pendingFrame?.(0));
      expect(isPaneResizing()).toBe(true);
      expect(settled).not.toHaveBeenCalled();
      if (reason === "unmount") act(() => root.render(null));
      else if (reason === "blur") act(() => window.dispatchEvent(new Event("blur")));
      else if (reason === "lostpointercapture") act(() => handle().dispatchEvent(new PointerEvent(reason, { pointerId: 1 })));
      else pointer(reason, 400);
      expect(isPaneResizing()).toBe(false);
      expect(settled).toHaveBeenCalledOnce();
    } finally { unsubscribe(); }
  });

  it.each(["top", "bottom"] as const)("resizes a %s-facing handle with vertical pointer movement", (direction) => {
    act(() => root.render(createElement(Probe, { direction })));
    startDrag();
    expect(document.querySelector<HTMLElement>("[data-resize-cursor]")?.style.cursor).toBe("row-resize");
    act(() => window.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1,
      clientX: 900,
      clientY: direction === "top" ? -80 : 80,
    })));
    expect(resize.width).toBe(340);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(340);
    expect(document.body.style.cursor).toBe("");
  });

  it("applies incoming shared widths without echoing a preference write", () => {
    act(() => root.render(createElement(Probe, { value: 430 })));
    expect(resize.width).toBe(430);
    expect(pane().style.width).toBe("430px");
    expect(onCommit).not.toHaveBeenCalled();
    act(() => root.render(createElement(Probe, { value: 900 })));
    expect(resize.width).toBe(560);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps direct dragging in control when a shared width arrives", () => {
    startDrag();
    pointer("pointermove", 410);
    act(() => pendingFrame?.(0));
    act(() => root.render(createElement(Probe, { value: 300 })));
    expect(pane().style.width).toBe("410px");
    expect(onCommit).not.toHaveBeenCalled();
    pointer("pointerup", 410);
    expect(resize.width).toBe(410);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(410);
  });

  it("writes each move immediately without rendering and commits only on release", () => {
    startDrag();
    const beforeMoves = renders;
    maximum.mockClear();
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 1, clientX: 390 }),
      );
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 420 }));
      expect(pane().style.width).toBe("420px");
      expect(resize.width).toBe(260);
    });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(maximum).not.toHaveBeenCalled();
    act(() => pendingFrame?.(0));
    expect(pane().style.width).toBe("420px");
    expect(renders).toBe(beforeMoves);
    expect(onCommit).not.toHaveBeenCalled();
    pointer("pointerup", 420);
    expect(resize.width).toBe(420);
    expect(resize.dragging).toBe(false);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(420);
  });

  it.each(["Escape", "pointercancel"])("rolls back on %s without persisting the preview", (reason) => {
    startDrag();
    pointer("pointermove", 410);
    expect(pane().style.width).toBe("410px");
    if (reason === "Escape") act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: reason })));
    else pointer(reason, 410);
    expect(pane().style.width).toBe("260px");
    expect(resize.width).toBe(260);
    expect(resize.dragging).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
    pointer("pointerup", 500);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps finishDrag stable and finishes at the last valid width", () => {
    const finishDrag = resize.finishDrag;
    document.body.style.cursor = "crosshair";
    startDrag();
    expect(resize.finishDrag).toBe(finishDrag);
    pointer("pointermove", 800);
    expect(pane().style.width).toBe("560px");
    expect(document.querySelector<HTMLElement>("[data-resize-cursor]")?.style.cursor).toBe("col-resize");
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.documentElement.classList.contains("is-resizing")).toBe(true);
    const blockedSelection = new Event("selectstart", { cancelable: true });
    window.dispatchEvent(blockedSelection);
    expect(blockedSelection.defaultPrevented).toBe(true);

    act(() => finishDrag());
    expect(resize.finishDrag).toBe(finishDrag);
    expect(resize.width).toBe(560);
    expect(resize.dragging).toBe(false);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(560);
    expect(handle().releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.documentElement.classList.contains("is-resizing")).toBe(false);
    expect(document.documentElement.classList.contains("is-reordering")).toBe(false);
    const releasedSelection = new Event("selectstart", { cancelable: true });
    window.dispatchEvent(releasedSelection);
    expect(releasedSelection.defaultPrevented).toBe(false);
  });

  it("does not commit again when finishDrag is called while idle or repeatedly", () => {
    act(() => resize.finishDrag());
    expect(onCommit).not.toHaveBeenCalled();
    startDrag();
    pointer("pointermove", 390);
    act(() => {
      resize.finishDrag();
      resize.finishDrag();
    });
    act(() => resize.finishDrag());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(390);
    expect(handle().releasePointerCapture).toHaveBeenCalledOnce();
  });

  it("ignores later pointer events after an explicit finish", () => {
    startDrag();
    pointer("pointermove", 390);
    act(() => resize.finishDrag());
    pointer("pointermove", 500);
    pointer("pointerup", 500);
    pointer("pointercancel", 500);
    expect(pane().style.width).toBe("390px");
    expect(resize.width).toBe(390);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(390);
  });

  it("flushes the release position before a frame and cleans up on lost capture", () => {
    startDrag();
    pointer("pointermove", 390);
    pointer("pointerup", 430);
    expect(pane().style.width).toBe("430px");
    expect(pendingFrame).toBeUndefined();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(430);
    startDrag();
    pointer("pointermove", 300);
    act(() => handle().dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 })));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(430);
    expect(pane().style.width).toBe("430px");
    expect(resize.dragging).toBe(false);
    expect(pendingFrame).toBeUndefined();
  });
});
