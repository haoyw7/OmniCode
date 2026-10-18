// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startMotionClock, stopMotionClock, motionFrame, finishMotion } from "../../../../tests/helpers/sharedMotionClock";
import { useBotMessageSwipe } from "./useBotMessageSwipe";

let root: Root, node: HTMLDivElement;
const reply = vi.fn();
const cancelHold = vi.fn();

function Conversation({ active = true }: { active?: boolean }) {
  const log = useRef<HTMLDivElement>(null);
  useBotMessageSwipe({
    log,
    active,
    replyDisabled: false,
    onReply: reply,
    cancelHold,
  });
  return createElement(
    "div",
    { ref: log, className: "assistant-messages" },
    Array.from({ length: 400 }, (_, index) =>
      createElement(
        "div",
        {
          key: index,
          className: "assistant-message-row assistant-message-row-assistant",
          "data-reply-id": String(index),
        },
        createElement("span", { className: "assistant-swipe-reply" }),
        createElement(
          "div",
          { className: "assistant-message" },
          `Message ${index}`,
        ),
        createElement("time", { className: "assistant-swipe-time" }, "12:30"),
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  reply.mockClear();
  cancelHold.mockClear();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  stopMotionClock();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  act(() => root.render(createElement(Conversation)));
  const log = node.firstElementChild as HTMLElement;
  vi.spyOn(log, "getBoundingClientRect").mockReturnValue({
    top: 1,
    bottom: 299,
  } as DOMRect);
  const rows = Array.from(log.children) as HTMLElement[];
  const bounds = rows.map((row, index) => {
    Object.defineProperty(row, "clientWidth", { value: 300 });
    Object.defineProperty(
      row.querySelector(".assistant-message"),
      "offsetWidth",
      { value: 260 },
    );
    return vi
      .spyOn(row, "getBoundingClientRect")
      .mockReturnValue({
        top: (index - 190) * 100,
        bottom: (index - 189) * 100,
      } as DOMRect);
  });
  return { log, rows, bounds };
}
function touch(target: Element, type: string, x: number) {
  act(() =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerType: "touch",
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: 50,
      }),
    ),
  );
}
function frame() { act(() => motionFrame()); }

it("follows touch moves through Motion values and updates only visible rows without restyling the history", async () => {
  const { log, rows, bounds } = mount();
  touch(log, "pointerdown", 240);
  touch(log, "pointermove", 220);
  const measured = bounds.reduce(
    (count, spy) => count + spy.mock.calls.length,
    0,
  );
  expect(measured).toBeLessThan(20);
  for (let x = 210; x >= 150; x -= 5) touch(log, "pointermove", x);
  expect(log.querySelectorAll('[style*="translateX"]')).toHaveLength(0);
  frame();
  expect(log.style.cssText).toBe("");
  expect(log.querySelectorAll('[data-message-swipe="time"]')).toHaveLength(3);
  expect(log.querySelectorAll('[style*="translateX"]')).toHaveLength(6);
  expect(
    rows[190].querySelector<HTMLElement>(".assistant-message")!.style.transform,
  ).toBe("translateX(-48px)");
  expect(rows[0].querySelector("[style]")).toBeNull();
  expect(rows[399].querySelector("[style]")).toBeNull();
  touch(log, "pointermove", 210);
  frame();
  expect(bounds.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(
    measured,
  );
  expect(
    rows[190].querySelector<HTMLElement>(".assistant-message")!.style.transform,
  ).toBe("none");
  touch(log, "pointerup", 210);
  await act(async () => { await finishMotion(120); });
  expect(log.querySelector("[data-message-swipe]")).toBeNull();
  expect(log.querySelectorAll('[style*="translateX"]')).toHaveLength(0);
});

it("settles on release and hiding, and accepts another drag immediately", async () => {
  const { log, rows } = mount();
  touch(log, "pointerdown", 240);
  touch(log, "pointermove", 160);
  touch(log, "pointerup", 160);
  await act(async () => { await finishMotion(120); });
  expect(log.querySelectorAll('[style*="translateX"]')).toHaveLength(0);
  const bubble = rows[190].querySelector<HTMLElement>(".assistant-message")!;
  touch(bubble, "pointerdown", 100);
  touch(bubble, "pointermove", 180);
  frame();
  expect(log.querySelectorAll('[style*="translateX"]')).toHaveLength(1);
  touch(bubble, "pointerup", 180);
  expect(reply).toHaveBeenCalledExactlyOnceWith("190");
  touch(log, "pointerdown", 240);
  touch(log, "pointermove", 160);
  act(() => root.render(createElement(Conversation, { active: false })));
  frame();
  expect(log.querySelector("[data-message-swipe]")).toBeNull();
  expect(log.querySelectorAll('[style*="translateX"]')).toHaveLength(0);
});

it.each(["a", "button", "pre", "table", "scroller"])(
  "reveals times from %s content without activating it or replying",
  (kind) => {
    const { log, rows } = mount();
    const content = document.createElement(kind === "scroller" ? "div" : kind);
    if (kind === "scroller") {
      content.style.overflowX = "auto";
      Object.defineProperty(content, "clientWidth", { value: 100 });
      Object.defineProperty(content, "scrollWidth", { value: 200 });
    }
    const target = document.createElement("span");
    content.append(target);
    rows[190].querySelector(".assistant-message")!.append(content);
    const click = vi.fn();
    content.addEventListener("click", click);
    // Nested widgets may stop bubbling touch events after handling them.
    content.addEventListener("touchmove", (event) => event.stopPropagation());

    touch(target, "pointerdown", 240);
    touch(target, "pointermove", 150);
    frame();
    expect(log.querySelectorAll('[data-message-swipe="time"]')).toHaveLength(3);
    const move = new TouchEvent("touchmove", { bubbles: true, cancelable: true });
    target.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
    touch(target, "pointerup", 150);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(click).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();

    // A fresh tap still activates the original content.
    touch(target, "pointerdown", 240);
    touch(target, "pointerup", 240);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(click).toHaveBeenCalledOnce();

    touch(target, "pointerdown", 150);
    touch(target, "pointermove", 240);
    touch(target, "pointerup", 240);
    expect(log.dataset.messageSwipe).toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
  },
);
