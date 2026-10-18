// @vitest-environment happy-dom
import { act, createElement, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMotionClock, motionFrame, stopMotionClock } from "./motionTestClock";
import { installKeyboardMotion, KEYBOARD_EVENT } from "./keyboardMotion";
import { useMobileSheetFocus } from "./useMobileSheetFocus";

let root: Root;
let node: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let now: number;
let disposeKeyboard: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  startMotionClock();
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  node = document.createElement("div");
  node.className = "mobile-app";
  document.body.append(node);
  root = createRoot(node);
  disposeKeyboard = installKeyboardMotion(node);
});

afterEach(() => {
  act(() => root.unmount());
  disposeKeyboard();
  stopMotionClock();
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function TestSheet({ active = true, name = "outer", children }: {
  active?: boolean;
  name?: string;
  children?: ReactNode;
}) {
  const sheet = useRef<HTMLElement>(null);
  useMobileSheetFocus(sheet, active);
  return createElement("div", { className: "mobile-sheet-backdrop" },
    createElement("section", { ref: sheet, className: "mobile-sheet", "data-sheet": name },
      createElement("div", { className: "mobile-sheet-content", style: { overflowY: "hidden" } },
        createElement("div", { "data-scroll": name, style: { overflowY: "auto" } },
          createElement("input", { "data-field": `${name}-first` }),
          createElement("textarea", { "data-field": `${name}-second` }),
          children,
        ),
      ),
    ),
  );
}

function show(active = true, nested = false) {
  act(() => root.render(createElement(TestSheet, { active },
    nested ? createElement(TestSheet, { name: "inner" }) : null,
  )));
}

function field(name = "outer-first") {
  return node.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${name}"]`)!;
}

function geometry(name = "outer") {
  const scroller = node.querySelector<HTMLElement>(`[data-scroll="${name}"]`)!;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
  });
  scroller.scrollTop = 80;
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 320, 200));
  const first = field(`${name}-first`);
  const second = field(`${name}-second`);
  vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(12, 450, 296, 32));
  vi.spyOn(second, "getBoundingClientRect").mockReturnValue(new DOMRect(12, 480, 296, 40));
  const scrollTo = vi.spyOn(scroller, "scrollTo").mockImplementation(() => {});
  return { scroller, first, second, scrollTo };
}

function keyboard(height: number, duration = 200) {
  act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height, viewport: 800, duration, easing: "linear" },
  })));
  act(() => motionFrame(0));
}

async function advance(duration: number) {
  await act(async () => {
    now += duration;
    vi.advanceTimersByTime(duration);
    motionFrame(duration);
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

async function frame() {
  await act(async () => {
    motionFrame(0);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
  });
}

async function settle(duration = 200) {
  await advance(duration);
  await frame();
  await frame();
  await frame();
}

describe("mobile sheet keyboard focus", async () => {
  it("reveals a field in the inner scroll area only after keyboard layout has settled", async () => {
    show();
    const { first, scrollTo } = geometry();
    const content = node.querySelector<HTMLElement>(".mobile-sheet-content")!;
    const outerScroll = vi.spyOn(content, "scrollTo");
    const pageScroll = vi.spyOn(window, "scrollTo");
    act(() => first.focus());
    keyboard(300);
    await advance(199);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(node.style.height).toBe("800px");
    await advance(1);
    await frame();
    await frame();
    expect(node.style.height).toBe("500px");
    await frame();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 346, behavior: "smooth" });
    expect(outerScroll).not.toHaveBeenCalled();
    expect(pageScroll).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("leaves a field already inside the visible scroll area in place", async () => {
    show();
    const { first, scrollTo } = geometry();
    vi.mocked(first.getBoundingClientRect).mockReturnValue(new DOMRect(12, 140, 296, 32));
    act(() => first.focus());
    keyboard(300);
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("reveals newly focused fields while the keyboard is already open", async () => {
    keyboard(300, 0);
    show();
    const { first, second, scrollTo } = geometry();
    act(() => first.focus());
    await settle(0);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 346, behavior: "smooth" });
    scrollTo.mockClear();
    act(() => second.focus());
    await settle(0);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 380, behavior: "smooth" });
  });

  it("waits for the remaining motion when focus changes during a keyboard rise", async () => {
    show();
    const { first, second, scrollTo } = geometry();
    act(() => first.focus());
    keyboard(300);
    await advance(80);
    act(() => second.focus());
    await advance(119);
    await frame();
    expect(scrollTo).not.toHaveBeenCalled();
    await settle(1);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 380, behavior: "smooth" });
  });

  it("cancels a stale reveal on dismissal and follows a reversed rise once", async () => {
    show();
    const { first, scrollTo } = geometry();
    act(() => first.focus());
    keyboard(300);
    await advance(100);
    keyboard(0);
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
    keyboard(300);
    await advance(50);
    keyboard(0);
    keyboard(260);
    await settle();
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it.each(["close", "unmount"])("cancels pending reveals when the sheet is %s", async (action) => {
    show();
    const { first, scrollTo } = geometry();
    act(() => first.focus());
    keyboard(300);
    await advance(199);
    await frame();
    if (action === "close") show(false);
    else act(() => root.render(null));
    await frame();
    await frame();
    keyboard(280);
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("reveals a focused field on activation with an existing keyboard", async () => {
    keyboard(300, 0);
    show(false);
    const { first, scrollTo } = geometry();
    act(() => first.focus());
    show(true);
    await settle(0);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 346, behavior: "smooth" });
  });

  it("lets only the owning sheet reveal a nested sheet's focused field", async () => {
    show(true, true);
    const outer = geometry();
    const inner = geometry("inner");
    act(() => inner.first.focus());
    keyboard(300);
    await settle();
    expect(inner.scrollTo).toHaveBeenCalledOnce();
    expect(outer.scrollTo).not.toHaveBeenCalled();
  });

  it("reveals immediately without smooth scrolling when motion is reduced", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    show();
    const { first, scrollTo } = geometry();
    act(() => first.focus());
    keyboard(300);
    await settle(0);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 346, behavior: "auto" });
  });
});
