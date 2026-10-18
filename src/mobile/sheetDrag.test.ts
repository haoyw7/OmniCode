// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motion } from "motion/react";
import { MobileSheet } from "./MobileSheet";
import { settleDetent, useSheetDrag } from "./sheetDrag";
import { startMotionClock, motionFrame, stopMotionClock } from "./motionTestClock";

describe("settleDetent", () => {
  it("steps down once on a downward fling and otherwise settles at the nearest stop", () => {
    // Full stop at 0, half stop at 300, half height 500.
    expect(settleDetent(250, -0.9, 300, 500, "half")).toBe("full");
    expect(settleDetent(100, 0.9, 300, 500, "full")).toBe("half");
    expect(settleDetent(460, 0.9, 300, 500, "full")).toBe("half");
    expect(settleDetent(320, 0.9, 300, 500, "half")).toBe("dismiss");
    expect(settleDetent(120, 0, 300, 500, "full")).toBe("full");
    expect(settleDetent(200, 0, 300, 500, "full")).toBe("half");
    expect(settleDetent(420, 0, 300, 500, "half")).toBe("half");
    expect(settleDetent(460, 0, 300, 500, "half")).toBe("dismiss");
  });
});

// These assertions cover the same drag/rest/geometry contracts as the former
// CSS/rAF tests. PointerEvent.pageY is supplied because happy-dom doesn't derive
// it from clientY, and physical springs are advanced through Motion's scheduler.
describe("MobileSheet drag", () => {
  let root: Root;
  let node: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(500);
    startMotionClock();
    node = document.createElement("div");
    document.body.append(node);
    root = createRoot(node);
  });
  afterEach(() => {
    act(() => root.unmount());
    node.remove();
    stopMotionClock();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function step(milliseconds = 16) {
    await act(async () => {
      vi.advanceTimersByTime(milliseconds);
      motionFrame(milliseconds);
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
  }
  async function rest() { for (let i = 0; i < 60; i++) await step(); }
  function offset(sheet: HTMLElement) {
    return Number(/translateY\(([-\d.]+)px\)/.exec(sheet.style.transform)?.[1] ?? 0);
  }
  function pointer(target: Element, type: string, y: number, kind = "mouse") {
    const event = new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
      pointerType: kind, button: 0, buttons: type === "pointerup" ? 0 : 1, clientY: y,
    });
    Object.defineProperty(event, "pageY", { value: y });
    act(() => { target.dispatchEvent(event); });
    return event;
  }
  async function pull(sheet: HTMLElement, from: number, to: number, selector = ".mobile-sheet-grip", kind = "mouse", milliseconds = 500) {
    const handle = sheet.querySelector(selector)!;
    pointer(handle, "pointerdown", from, kind);
    await step(milliseconds);
    pointer(handle, "pointermove", (from + to) / 2, kind);
    await step(milliseconds);
    pointer(handle, "pointermove", to, kind);
    await step(milliseconds);
    const moved = offset(sheet);
    pointer(handle, "pointerup", to, kind);
    await step(16);
    await step(1);
    return moved;
  }
  async function open(detents = false) {
    const onClose = vi.fn();
    if (detents) {
      vi.stubGlobal("innerHeight", 1000);
      vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!.get!).mockReturnValue(800);
    }
    act(() => root.render(createElement(MobileSheet,
      { title: "Tool details", onClose, detents, header: { title: "Bash", subtitle: "Completed" } },
      createElement("p", { className: "body" }, "Body"))));
    const sheet = node.querySelector<HTMLElement>(".mobile-sheet")!;
    await rest();
    return { sheet, onClose };
  }

  it("opens and closes within the popup duration and reverses without resetting its position", async () => {
    const exited = vi.fn();
    const show = (open: boolean) => act(() => root.render(createElement(MobileSheet, {
      title: "Details", open, onClose: () => {}, onExited: exited, children: "Content",
    })));
    show(true);
    const sheet = node.querySelector<HTMLElement>(".mobile-sheet")!;
    expect(offset(sheet)).toBe(524);
    for (let i = 0; i < 16; i++) await step();
    expect(offset(sheet)).toBe(0);
    show(false);
    for (let i = 0; i < 4; i++) await step();
    const closingOffset = offset(sheet);
    expect(closingOffset).toBeGreaterThan(0);
    expect(closingOffset).toBeLessThan(524);
    show(true);
    await step();
    expect(node.querySelector(".mobile-sheet")).toBe(sheet);
    expect(offset(sheet)).toBeLessThanOrEqual(closingOffset);
    for (let i = 0; i < 16; i++) await step();
    expect(offset(sheet)).toBe(0);
    expect(exited).not.toHaveBeenCalled();
    show(false);
    for (let i = 0; i < 16; i++) await step();
    expect(node.querySelector(".mobile-sheet")).toBeNull();
    expect(exited).toHaveBeenCalledOnce();
  });

  it("follows the pointer and closes after a long pull", async () => {
    const { sheet, onClose } = await open();
    expect(await pull(sheet, 100, 320)).toBe(220);
    expect(sheet.closest<HTMLElement>(".mobile-sheet-backdrop")!.dataset.foldState).toBe("closing");
    expect(sheet.closest("[inert]")).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await rest();
    expect(onClose).toHaveBeenCalledOnce();
    expect(node.querySelector(".mobile-sheet")).toBeNull();
  });
  it("springs back after a short pull", async () => {
    const { sheet, onClose } = await open();
    expect(await pull(sheet, 100, 160)).toBe(60);
    await rest();
    expect(onClose).not.toHaveBeenCalled();
    expect(offset(sheet)).toBe(0);
  });
  it("dismisses immediately after release with reduced motion", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    const { sheet, onClose } = await open();
    await pull(sheet, 100, 320);
    expect(onClose).toHaveBeenCalledOnce();
    expect(node.querySelector(".mobile-sheet")).toBeNull();
  });
  it("cancels a pending dismissal when the sheet unmounts", async () => {
    const { sheet, onClose } = await open();
    await pull(sheet, 100, 320);
    expect(onClose).not.toHaveBeenCalled();
    act(() => root.render(null));
    await rest();
    expect(onClose).not.toHaveBeenCalled();
  });
  it.each(["mouse", "touch"])("drags only the nested sheet with %s input", async kind => {
    const closeSettings = vi.fn(), closePicker = vi.fn();
    act(() => root.render(createElement(MobileSheet, { title: "Settings", onClose: closeSettings },
      createElement(MobileSheet, { title: "Picker", onClose: closePicker }, "Options"))));
    const outer = node.querySelector<HTMLElement>('[aria-label="Settings"]')!;
    const inner = node.querySelector<HTMLElement>('[aria-label="Picker"]')!;
    await rest();
    expect(await pull(inner, 100, 320, undefined, kind)).toBe(220);
    expect(offset(outer)).toBe(0);
    await rest();
    expect(closePicker).toHaveBeenCalledOnce();
    expect(closeSettings).not.toHaveBeenCalled();
  });
  it.each([".mobile-sheet-grip", ".mobile-sheet-header strong"])("expands from %s and steps back down before closing", async selector => {
    const { sheet, onClose } = await open(true);
    expect(sheet.dataset.detent).toBe("half");
    expect(offset(sheet)).toBe(300);
    expect(sheet.querySelector(".mobile-sheet-header strong")?.textContent).toBe("Bash");
    await pull(sheet, 600, 400, selector, "touch");
    expect(sheet.dataset.detent).toBe("full");
    await rest();
    expect(offset(sheet)).toBe(0);
    await pull(sheet, 300, 500, selector, "touch");
    expect(sheet.dataset.detent).toBe("half");
    await rest();
    expect(offset(sheet)).toBe(300);
    expect(onClose).not.toHaveBeenCalled();
    await pull(sheet, 600, 800, selector, "touch");
    await rest();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("closes from the header button without starting a drag", async () => {
    const { sheet, onClose } = await open(true);
    const button = sheet.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
    pointer(button, "pointerdown", 600, "touch");
    expect(pointer(button, "pointermove", 400, "touch").defaultPrevented).toBe(false);
    pointer(button, "pointerup", 400, "touch");
    expect(sheet.dataset.detent).toBe("half");
    act(() => button.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("restores the half-height scroll viewport immediately with reduced motion", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    const { sheet } = await open(true);
    await pull(sheet, 600, 400, ".mobile-sheet-header strong", "touch");
    expect(sheet.dataset.detent).toBe("full");
    expect(offset(sheet)).toBe(0);
    await pull(sheet, 300, 500, ".mobile-sheet-header strong", "touch");
    expect(sheet.dataset.detent).toBe("half");
    expect(offset(sheet)).toBe(300);
    expect(sheet.style.getPropertyValue("--mobile-sheet-content-offset")).toBe("");
  });
  it.each([80, 500])("steps a full sheet to half on a quick %ipx swipe, then dismisses on the next swipe", async distance => {
    const { sheet, onClose } = await open(true);
    await pull(sheet, 600, 400, ".mobile-sheet-header strong", "touch");
    await rest();
    await pull(sheet, 300, 300 + distance, ".mobile-sheet-header strong", "touch", 16);
    expect(sheet.dataset.detent).toBe("half");
    expect(sheet.closest("[inert]")).toBeNull();
    await rest();
    expect(onClose).not.toHaveBeenCalled();
    expect(offset(sheet)).toBe(300);
    await pull(sheet, 600, 680, ".mobile-sheet-header strong", "touch", 16);
    expect(sheet.closest("[inert]")).not.toBeNull();
    await rest();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it.each(["half", "full"])("leaves all content swipes to native scrolling at the %s stop", async detent => {
    const { sheet, onClose } = await open(true);
    if (detent === "full") { await pull(sheet, 600, 400, ".mobile-sheet-header strong", "touch"); await rest(); }
    const position = offset(sheet);
    for (const scrollTop of [0, 100]) {
      sheet.querySelector<HTMLElement>(".mobile-sheet-content")!.scrollTop = scrollTop;
      for (const distance of [-150, 150]) {
        const target = sheet.querySelector(".body")!;
        pointer(target, "pointerdown", 600, "touch");
        expect(pointer(target, "pointermove", 600 + distance, "touch").defaultPrevented).toBe(false);
        pointer(target, "pointerup", 600 + distance, "touch");
        await rest();
        expect(sheet.dataset.detent).toBe(detent);
        expect(offset(sheet)).toBe(position);
      }
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  describe("Motion geometry and lifetime", () => {
    function harness(detents = true) {
      vi.stubGlobal("innerHeight", 1000);
      const ref = createRef<HTMLElement>();
      const onClose = vi.fn();
      let drag!: ReturnType<typeof useSheetDrag>;
      let height = detents ? 800 : 500;
      vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!.get!).mockImplementation(function () {
        return (this as HTMLElement).dataset.expanded ? 800 : height;
      });
      function Sheet({ enabled }: { enabled: boolean }) {
        drag = useSheetDrag(ref, enabled, onClose, undefined, detents);
        return createElement(motion.section, {
          ref, className: "mobile-sheet", drag: "y", dragListener: false, dragMomentum: false,
          dragControls: drag.controls, onPointerDownCapture: drag.start, onDrag: drag.onDrag,
          onDragEnd: drag.onDragEnd, style: { y: drag.y },
        }, createElement("div", { className: "mobile-sheet-grip" }));
      }
      const render = (enabled: boolean) => act(() => root.render(createElement(Sheet, { enabled })));
      render(true);
      return { sheet: ref.current!, onClose, render, drag, resize: (next: number) => { height = next; } };
    }
    it("keeps content geometry stable through expansion, reversal and the return spring", async () => {
      const { sheet } = harness();
      await rest();
      const writeOffset = vi.spyOn(sheet.style, "setProperty");
      await pull(sheet, 600, 400);
      await rest();
      expect(sheet.dataset.detent).toBe("full");
      await pull(sheet, 200, 400);
      expect(sheet.dataset.detent).toBe("half");
      expect(sheet.style.getPropertyValue("--mobile-sheet-content-offset")).toBe("0px");
      await pull(sheet, 400, 200, undefined, "mouse", 16);
      await rest();
      expect(sheet.dataset.detent).toBe("full");
      expect(sheet.style.getPropertyValue("--mobile-sheet-content-offset")).toBe("0px");
      expect(writeOffset.mock.calls.filter(([name]) => name === "--mobile-sheet-content-offset").map(([, value]) => value)).toEqual(["0px"]);
    });
    it("pulls a content-height sheet to full screen and restores its content-height layout on return", async () => {
      const { sheet } = harness(false);
      await rest();
      const handle = sheet.querySelector(".mobile-sheet-grip")!;
      pointer(handle, "pointerdown", 600);
      await step(100);
      pointer(handle, "pointermove", 590);
      await step(100);
      expect(sheet.dataset.expanded).toBe("true");
      expect(offset(sheet)).toBe(290);
      pointer(handle, "pointermove", 300);
      await step(100);
      pointer(handle, "pointerup", 300);
      await rest();
      expect(offset(sheet)).toBe(0);
      expect(sheet.dataset.expanded).toBe("true");
      await pull(sheet, 100, 350);
      await rest();
      expect(sheet.dataset.expanded).toBeUndefined();
      expect(offset(sheet)).toBe(0);
    });
    it("catches a settling sheet at its current Motion value", async () => {
      const { sheet, drag } = harness();
      await rest();
      drag.y.set(120);
      await step();
      expect(await pull(sheet, 100, 125)).toBe(145);
    });
    it.each(["disable", "unmount"])("cancels a pending dismissal on %s", async action => {
      const { sheet, onClose, render } = harness();
      await rest();
      await pull(sheet, 100, 320);
      if (action === "disable") render(false); else act(() => root.render(null));
      await rest();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
