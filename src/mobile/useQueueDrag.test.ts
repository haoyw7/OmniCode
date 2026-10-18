// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { motion } from "motion/react";
import { startMotionClock, motionFrame, stopMotionClock } from "./motionTestClock";
import { useQueueDrag } from "./useQueueDrag";

let root: Root;
let node: HTMLDivElement;
let sorting: ReturnType<typeof useQueueDrag>;
let renders: number;
let frameId: number;
let frames: Map<number, FrameRequestCallback>;
const onDrop = vi.fn();

function Queue() {
  renders++;
  sorting = useQueueDrag(["a", "b", "c"], true, onDrop);
  return createElement(
    "div",
    null,
    createElement(
      "div",
      { "data-list": true },
      sorting.order.map((id) =>
        createElement(
          "button",
          {
            key: id,
            "data-queue-id": id,
            onPointerDown: (event) => sorting.start(id, event),
          },
          id,
        ),
      ),
    ),
    sorting.drag &&
      createElement(motion.div, {
        ref: sorting.previewRef,
        "data-preview": true,
        style: {
          left: sorting.drag.left,
          width: sorting.drag.width,
          ...sorting.previewStyle,
        },
      }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  startMotionClock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  frameId = 0;
  renders = 0;
  onDrop.mockReset();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  act(() => root.render(createElement(Queue)));
});

afterEach(() => {
  act(() => root.unmount());
  node.remove();
  stopMotionClock();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function pointer(type: string, y: number, target: EventTarget = window) {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function frame() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => { motionFrame(); pending.forEach((callback) => callback(performance.now())); });
}

function layout(height = 160, held = true) {
  const list = node.querySelector<HTMLElement>("[data-list]")!;
  let top = 100;
  list.getBoundingClientRect = vi.fn(
    () => ({ top, bottom: top + height }) as DOMRect,
  );
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: height },
    scrollHeight: { configurable: true, value: 146 },
  });
  for (const row of list.querySelectorAll<HTMLElement>("button")) {
    row.getBoundingClientRect = vi.fn(() => {
      const rowTop =
        top + [...list.children].indexOf(row) * 51 - list.scrollTop;
      return {
        top: rowTop,
        bottom: rowTop + 44,
        left: 20,
        right: 220,
        width: 200,
        height: 44,
      } as DOMRect;
    });
  }
  const first = list.querySelector("button")!;
  if (held)
    act(() => {
      pointer("pointerdown", 122, first);
      vi.advanceTimersByTime(400);
    });
  return {
    list,
    first,
    shift: (delta: number) => {
      top += delta;
    },
  };
}

it("sleeps while a held finger is stationary, with no repeated layout reads or renders", () => {
  const { list } = layout();
  frame();
  const reads = vi.mocked(list.getBoundingClientRect).mock.calls.length;
  const rendered = renders;
  expect(frames.size).toBe(0);
  frame();
  frame();
  expect(list.getBoundingClientRect).toHaveBeenCalledTimes(reads);
  expect(renders).toBe(rendered);
});

it("coalesces pointer moves and moves the ghost without rerendering the queue in the same slot", () => {
  const { list } = layout();
  frame();
  const rendered = renders;
  const reads = vi.mocked(list.getBoundingClientRect).mock.calls.length;
  act(() => {
    pointer("pointermove", 126);
    pointer("pointermove", 130);
    pointer("pointermove", 132);
  });
  // Motion coalesces the pending updates into its own scheduler.
  frame();
  expect(
    node.querySelector<HTMLElement>("[data-preview]")!.style.transform,
  ).toBe("translateY(110px) scale(1.03)");
  expect(renders).toBe(rendered);
  expect(list.getBoundingClientRect).toHaveBeenCalledTimes(reads);
  expect(frames.size).toBe(0);
});

it("commits the release position even when the last pointer move has not rendered", () => {
  layout();
  act(() => {
    pointer("pointermove", 175);
    pointer("pointerup", 175);
  });
  expect(onDrop).toHaveBeenCalledWith("a", "c");
  expect(frames.size).toBe(0);
  expect(node.querySelector("[data-preview]")).toBeNull();
});

it("mounts a deferred ghost at the latest pointer position", () => {
  const { first } = layout(160, false);
  act(() => {
    pointer("pointerdown", 122, first);
    vi.advanceTimersByTime(400);
    pointer("pointermove", 132);
    const pending = [...frames.values()];
    frames.clear();
    motionFrame();
    pending.forEach((callback) => callback(performance.now()));
  });
  expect(
    node.querySelector<HTMLElement>("[data-preview]")!.style.transform,
  ).toBe("translateY(110px) scale(1.03)");
});

it("autoscrolls only near an edge and stops at the scroll boundary", () => {
  const { list } = layout(80);
  frame();
  expect(frames.size).toBe(0);
  act(() => pointer("pointermove", 176));
  const reads = vi.mocked(list.getBoundingClientRect).mock.calls.length;
  for (let i = 0; i < 12; i++) frame();
  expect(list.scrollTop).toBe(66);
  expect(frames.size).toBe(0);
  expect(list.getBoundingClientRect).toHaveBeenCalledTimes(reads);
  act(() => pointer("pointermove", 104));
  frame();
  expect(list.scrollTop).toBe(59);
  act(() => pointer("pointermove", 140));
  frame();
  expect(list.scrollTop).toBe(59);
  expect(frames.size).toBe(0);
});

it("refreshes slot geometry after a viewport change without keeping an idle frame loop", () => {
  const { list, shift } = layout();
  frame();
  const reads = vi.mocked(list.getBoundingClientRect).mock.calls.length;
  shift(50);
  act(() => {
    window.dispatchEvent(new Event("resize"));
    pointer("pointermove", 175);
  });
  frame();
  expect(list.getBoundingClientRect).toHaveBeenCalledTimes(reads + 1);
  expect(sorting.order).toEqual(["a", "b", "c"]);
  expect(frames.size).toBe(0);
  act(() => pointer("pointerup", 175));
  expect(onDrop).not.toHaveBeenCalled();
});
