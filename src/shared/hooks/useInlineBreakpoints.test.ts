// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInlineBreakpoints } from "./useInlineBreakpoints";

let container: HTMLDivElement;
let root: Root;
let callback: ResizeObserverCallback;
const disconnect = vi.fn();
const points = [220, 280, 360, 480];
function Fixture({ enabled = true, unit = "px", thresholds = points }: { enabled?: boolean; unit?: "px" | "rem"; thresholds?: number[] }) {
  const ref = useInlineBreakpoints(thresholds, unit, enabled);
  return createElement("div", { ref });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(next: ResizeObserverCallback) { callback = next; }
    observe() {}
    disconnect = disconnect;
  });
  disconnect.mockClear();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  document.documentElement.style.removeProperty("font-size");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const measure = (width: number) => act(() => callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
it("updates responsive rules only when crossing a boundary in either direction", () => {
  act(() => root.render(createElement(Fixture)));
  const element = container.firstElementChild!;
  measure(500);
  expect(element.getAttribute("data-inline-below")).toBe("");
  const write = vi.spyOn(element, "setAttribute");
  measure(510); measure(550); measure(500);
  expect(write).not.toHaveBeenCalled();
  measure(359);
  expect(element.getAttribute("data-inline-below")).toBe("360 480");
  expect(element.getAttribute("data-inline-at-least")).toBe("220 280");
  measure(360);
  expect(element.getAttribute("data-inline-below")).toBe("480");
  measure(0);
  expect(element.getAttribute("data-inline-below")).toBe("480");
  measure(480);
  expect(element.getAttribute("data-inline-below")).toBe("");
});
it("uses the root font size for rem breakpoints", () => {
  document.documentElement.style.fontSize = "20px";
  act(() => root.render(createElement(Fixture, { unit: "rem", thresholds: [28] })));
  const element = container.firstElementChild!;
  measure(559); expect(element.getAttribute("data-inline-below")).toBe("28");
  measure(560); expect(element.getAttribute("data-inline-at-least")).toBe("28");
});
it("disconnects and ignores queued measurements when disabled", () => {
  act(() => root.render(createElement(Fixture)));
  const element = container.firstElementChild!;
  measure(300);
  act(() => root.render(createElement(Fixture, { enabled: false })));
  expect(disconnect).toHaveBeenCalledOnce();
  measure(200);
  expect(element.hasAttribute("data-inline-below")).toBe(false);
  expect(element.hasAttribute("data-inline-at-least")).toBe(false);
});
