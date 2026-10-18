import { createElement, type PointerEvent as ReactPointerEvent } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, false) };
});
import {
  useAnimatedReorder,
  type ReorderExternalDrop,
  type ReorderOptions,
} from "./useAnimatedReorder";

const ids = ["sessions", "changes", "explorer"];

function tabAt(
  left: number,
  top: number,
  parentElement: HTMLElement,
  height = 32,
) {
  const captured = new Set<number>();
  return {
    parentElement,
    getBoundingClientRect: vi.fn(() => ({
      left,
      right: left + 100,
      width: 100,
      top,
      bottom: top + height,
      height,
    })),
    style: {
      transform: "",
      transition: "",
      removeProperty(key: "transform" | "transition") {
        this[key] = "";
      },
    },
    dataset: {} as Record<string, string>,
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  };
}

let browser: EventTarget;

function pointer(type: string, clientX: number, pointerId = 1) {
  browser.dispatchEvent(
    Object.assign(new Event(type), { clientX, clientY: clientX, pointerId }),
  );
}

function setup(
  reducedMotion = false,
  axis: "x" | "y" = "x",
  externalDrop?: ReorderExternalDrop<string>,
  options?: ReorderOptions<string>,
  verticalLayout = [
    { top: 0, height: 32 },
    { top: 33, height: 32 },
    { top: 66, height: 32 },
  ],
) {
  Object.assign(browser, { matchMedia: () => ({ matches: reducedMotion }) });
  const onReorder = vi.fn();
  let reorder!: ReturnType<typeof useAnimatedReorder<string>>;
  // Render the real hook to obtain its gesture interface without mocking React.
  // Mount/unmount effects and native click targeting need a browser check.
  function Probe() {
    reorder = useAnimatedReorder(ids, onReorder, axis, externalDrop, options);
    return null;
  }
  renderToString(createElement(Probe));
  const scroller = { scrollLeft: 0, scrollTop: 0, parentElement: null };
  const tabs = verticalLayout.map(({ top, height }, index) =>
    tabAt(index * 100, top, scroller as unknown as HTMLElement, height),
  );
  tabs.forEach((tab, index) =>
    reorder.setItemRef(ids[index], tab as unknown as HTMLElement),
  );
  const press = (index = 0, pointerId = 1) =>
    reorder.onItemPointerDown(ids[index], {
      button: 0,
      clientX: index * 100 + 50,
      clientY: verticalLayout[index].top + 16,
      pointerId,
    } as ReactPointerEvent);
  return { reorder, tabs, onReorder, press, scroller };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  browser = Object.assign(new EventTarget(), {
    getComputedStyle: () => ({
      getPropertyValue: (name: string) =>
        name === "--motion-reorder-duration"
          ? "160ms"
          : "cubic-bezier(0.22, 1, 0.36, 1)",
    }),
    getSelection: () => null,
    clearTimeout,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
    cancelAnimationFrame: clearTimeout,
  });
  const classes = new Set<string>();
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", {
    body: { style: { cursor: "" } },
    documentElement: {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
    },
  });
});

afterEach(() => {
  browser.dispatchEvent(new Event("blur"));
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("workspace tab gestures", () => {
  it.each([
    ["x", 150, 100, "translate3d(200px, 0, 0)"],
    ["y", 49, 33, "translate3d(0, 66px, 0)"],
  ] as const)(
    "keeps the dragged item under the pointer when scrolling on %s",
    (axis, position, scroll, transform) => {
      const { press, tabs, scroller, onReorder } = setup(false, axis);
      press();
      pointer("pointermove", position);
      vi.advanceTimersByTime(16);
      if (axis === "x") scroller.scrollLeft = scroll;
      else scroller.scrollTop = scroll;
      browser.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(16);
      expect(tabs[0].style.transform).toBe(transform);
      pointer("pointerup", position);
      vi.runAllTimers();
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(
        ["changes", "explorer", "sessions"],
        "sessions",
      );
    },
  );

  it("releases drag feedback immediately while the drop animation finishes", () => {
    const { press, tabs, onReorder } = setup();
    press();
    pointer("pointermove", 180);
    vi.advanceTimersByTime(16);
    expect(tabs[0].dataset.dragging).toBe("true");
    pointer("pointerup", 180);
    expect(tabs[0].dataset.dragging).toBeUndefined();
    expect(tabs[0].hasPointerCapture(1)).toBe(false);
    expect(document.body.style.cursor).toBe("");
    expect(onReorder).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["changes", "sessions", "explorer"],
      "sessions",
    );
  });

  it("drops a drag whose pointerup was missed once the mouse moves with no button held", () => {
    const { press, tabs, onReorder } = setup();
    press();
    pointer("pointermove", 180);
    vi.advanceTimersByTime(16);
    expect(tabs[0].dataset.dragging).toBe("true");

    browser.dispatchEvent(
      Object.assign(new Event("pointermove"), {
        clientX: 260,
        clientY: 260,
        pointerId: 1,
        pointerType: "mouse",
        buttons: 0,
      }),
    );
    vi.runAllTimers();

    expect(tabs[0].dataset.dragging).toBeUndefined();
    expect(tabs[0].style.transform).toBe("");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("makes room for an item's own size when neighbours differ in height", () => {
    const { press, tabs, onReorder } = setup(false, "y", undefined, undefined, [
      { top: 0, height: 36 },
      { top: 46, height: 60 },
      { top: 116, height: 120 },
    ]);
    press(2);
    pointer("pointermove", 32);
    vi.advanceTimersByTime(16);
    // The shorter card moves past the whole tall card, not by its own height.
    expect(tabs[1].style.transform).toBe("translate3d(0, 130px, 0)");
    expect(tabs[0].style.transform).toBe("translate3d(0, 0px, 0)");
    pointer("pointerup", 32);
    expect(tabs[2].style.transform).toBe("translate3d(0, -70px, 0)");
    vi.runAllTimers();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["sessions", "explorer", "changes"],
      "explorer",
    );
  });

  it("previews and reorders vertical project rows", () => {
    const { press, tabs, onReorder } = setup(false, "y");
    press();
    pointer("pointermove", 60);
    vi.advanceTimersByTime(16);
    expect(tabs[0].style.transform).toBe("translate3d(0, 44px, 0)");
    expect(tabs[1].style.transform).toBe("translate3d(0, -33px, 0)");
    expect(onReorder).not.toHaveBeenCalled();
    pointer("pointerup", 90);
    vi.runAllTimers();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["changes", "explorer", "sessions"],
      "sessions",
    );
  });

  it.each([
    {
      direction: "down",
      from: 0,
      verticalLayout: [
        { top: 0, height: 144 },
        { top: 145, height: 80 },
        { top: 226, height: 56 },
      ],
      position: 200,
      siblingOffset: -33,
      finalOffset: 138,
      order: ["changes", "explorer", "sessions"],
    },
    {
      direction: "up",
      from: 2,
      verticalLayout: [
        { top: 0, height: 80 },
        { top: 81, height: 120 },
        { top: 202, height: 144 },
      ],
      position: 0,
      siblingOffset: 33,
      finalOffset: -202,
      order: ["explorer", "sessions", "changes"],
    },
  ])(
    "activates at 8px and shifts expanded siblings by the collapsed header plus gap when moving $direction",
    ({ from, verticalLayout, position, siblingOffset, finalOffset, order }) => {
      const collapsedSize = vi.fn(() => 32);
      const { press, tabs, onReorder } = setup(
        false,
        "y",
        undefined,
        { activationDistance: 8, collapsedSize },
        verticalLayout,
      );
      const start = verticalLayout[from].top + 16;
      press(from);
      pointer("pointermove", start + 7);
      vi.advanceTimersByTime(16);
      expect(tabs[from].hasPointerCapture(1)).toBe(false);
      expect(collapsedSize).not.toHaveBeenCalled();

      pointer("pointermove", start + 8);
      expect(tabs[from].hasPointerCapture(1)).toBe(true);
      expect(collapsedSize).toHaveBeenCalledExactlyOnceWith(
        ids[from],
        tabs[from],
      );
      pointer("pointermove", position);
      vi.advanceTimersByTime(16);
      for (const [index, tab] of tabs.entries()) {
        expect(tab.getBoundingClientRect).toHaveBeenCalledTimes(1);
        if (index !== from)
          expect(tab.style.transform).toBe(
            `translate3d(0, ${siblingOffset}px, 0)`,
          );
      }
      pointer("pointerup", position);
      expect(tabs[from].style.transform).toBe(
        `translate3d(0, ${finalOffset}px, 0)`,
      );
      vi.runAllTimers();
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(order, ids[from]);
    },
  );

  it("preserves button clicks below the drag threshold", () => {
    const { press, tabs, reorder, onReorder } = setup();
    press();
    expect(tabs[0].hasPointerCapture(1)).toBe(false);
    pointer("pointermove", 53);
    expect(tabs[0].hasPointerCapture(1)).toBe(false);
    pointer("pointerup", 53);
    expect(reorder.consumeClick()).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("reorders on drop and permits a fresh click immediately afterwards", () => {
    const { press, tabs, reorder, onReorder } = setup();
    press();
    pointer("pointermove", 160);
    expect(tabs[0].hasPointerCapture(1)).toBe(true);
    expect(onReorder).not.toHaveBeenCalled();
    pointer("pointerup", 160);
    expect(reorder.consumeClick()).toBe(true);
    vi.runAllTimers();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["changes", "sessions", "explorer"],
      "sessions",
    );
    expect(tabs[0].hasPointerCapture(1)).toBe(false);
    press(2);
    pointer("pointerup", 250);
    expect(reorder.consumeClick()).toBe(false);
  });

  it.each([20, 140])(
    "accepts a fresh click started during settling and released after %i ms",
    (held) => {
      const { press, reorder, onReorder } = setup();
      press();
      pointer("pointermove", 160);
      pointer("pointerup", 160);
      expect(reorder.consumeClick()).toBe(true);
      vi.advanceTimersByTime(60);
      press(2);
      vi.advanceTimersByTime(held);
      pointer("pointerup", 250);
      expect(reorder.consumeClick()).toBe(false);
      vi.runAllTimers();
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(
        ["changes", "sessions", "explorer"],
        "sessions",
      );
    },
  );

  it("previews the latest pointer position and makes room before committing", () => {
    const { press, tabs, onReorder } = setup();
    press();
    pointer("pointermove", 100);
    pointer("pointermove", 180);
    vi.advanceTimersByTime(16);
    expect(tabs[0].style.transform).toBe("translate3d(130px, 0, 0)");
    expect(tabs[1].style.transform).toBe("translate3d(-100px, 0, 0)");
    expect(tabs[2].style.transform).toBe("translate3d(0px, 0, 0)");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("moves the last tab to the first slot when released beyond the left edge", () => {
    const { press, onReorder } = setup();
    press(2);
    pointer("pointerup", -100);
    vi.runAllTimers();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["explorer", "sessions", "changes"],
      "explorer",
    );
  });

  it.each(["Escape", "pointercancel", "blur"])(
    "cancels a drag on %s",
    (reason) => {
      const { press, tabs, onReorder } = setup();
      press();
      pointer("pointermove", 250);
      vi.advanceTimersByTime(16);
      const event =
        reason === "Escape"
          ? Object.assign(new Event("keydown", { cancelable: true }), {
              key: "Escape",
            })
          : new Event(reason);
      browser.dispatchEvent(event);
      pointer("pointerup", 250);
      vi.runAllTimers();
      expect(onReorder).not.toHaveBeenCalled();
      expect(tabs.every((tab) => tab.style.transform === "")).toBe(true);
      expect(tabs[0].hasPointerCapture(1)).toBe(false);
      expect(document.body.style.cursor).toBe("");
      if (reason === "Escape") expect(event.defaultPrevented).toBe(true);
    },
  );

  it("commits a fast drop without waiting for animation in reduced motion", () => {
    const { press, tabs, onReorder } = setup(true);
    press();
    pointer("pointerup", 250);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["changes", "explorer", "sessions"],
      "sessions",
    );
    expect(tabs.every((tab) => tab.style.transform === "")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hands a drag to an external target without reordering", () => {
    const externalDrop: ReorderExternalDrop<string> = {
      onMove: vi.fn((_id, event) => event.clientY > 100),
      onDrop: vi.fn((_id, event) => event.clientY > 100),
      onEnd: vi.fn(),
    };
    const { press, tabs, reorder, onReorder } = setup(false, "x", externalDrop);
    press();
    pointer("pointermove", 180);
    pointer("pointerup", 180);
    vi.runAllTimers();

    expect(externalDrop.onMove).toHaveBeenCalled();
    expect(externalDrop.onDrop).toHaveBeenCalledExactlyOnceWith(
      "sessions",
      expect.objectContaining({ clientX: 180, clientY: 180 }),
    );
    expect(externalDrop.onEnd).toHaveBeenCalledWith("sessions");
    expect(onReorder).not.toHaveBeenCalled();
    expect(tabs.every((tab) => tab.style.transform === "")).toBe(true);
    expect(reorder.consumeClick()).toBe(true);
  });
});
