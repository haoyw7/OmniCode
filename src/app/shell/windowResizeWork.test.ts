// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { beginPaneResize, isPaneResizing, onPaneResizeSettled } from "../../shared/lib/paneResize";
import { deferredWindowRefresh, suspendTerminalFitsDuringWindowResize, WINDOW_RESIZE_IDLE_MS } from "./windowResizeWork";

afterEach(() => vi.useRealTimers());

it("fits once at the final window size and releases the guard on disposal", () => {
  vi.useFakeTimers();
  const settled = vi.fn();
  const unsubscribe = onPaneResizeSettled(settled);
  const dispose = suspendTerminalFitsDuringWindowResize();
  try {
    for (let i = 0; i < 40; i++) {
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(16);
      expect(isPaneResizing()).toBe(true);
    }
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(WINDOW_RESIZE_IDLE_MS);
    expect(isPaneResizing()).toBe(false);
    expect(settled).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains("is-native-window-resizing")).toBe(false);
    window.dispatchEvent(new Event("resize"));
    dispose();
    expect(isPaneResizing()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
    window.dispatchEvent(new Event("resize"));
    expect(settled).toHaveBeenCalledTimes(2);
  } finally { dispose(); unsubscribe(); }
});

it("does not release another active pane-resize guard", () => {
  vi.useFakeTimers();
  const endPane = beginPaneResize();
  const dispose = suspendTerminalFitsDuringWindowResize();
  try {
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(WINDOW_RESIZE_IDLE_MS);
    expect(isPaneResizing()).toBe(true);
  } finally { dispose(); endPane(); }
  expect(isPaneResizing()).toBe(false);
});

it("keeps only the last refresh and cancels pending work on disposal", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const work = deferredWindowRefresh(refresh);
  for (let i = 0; i < 100; i++) work.schedule();
  vi.advanceTimersByTime(WINDOW_RESIZE_IDLE_MS);
  expect(refresh).toHaveBeenCalledOnce();
  work.schedule(); work.dispose(); vi.runAllTimers();
  expect(refresh).toHaveBeenCalledOnce();
});
