// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarMain } from "./SidebarMain";
import { isPaneResizing } from "../../shared/lib/paneResize";
import { startMotionClock, stopMotionClock, finishMotion, motionFrame } from "../../../tests/helpers/sharedMotionClock";
let root: Root, container: HTMLDivElement;
let reduced = false;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({get matches(){return reduced;}, addEventListener: vi.fn(), removeEventListener: vi.fn()}));
  reduced = false; startMotionClock();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const open = this.closest("[data-open]")?.getAttribute("data-open") !== "false";
    return {x: open ? 280 : 48, y: 0, left: open ? 280 : 48, top: 0, right: 1000, bottom: 900, width: open ? 720 : 952, height: 900} as DOMRect;
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); stopMotionClock(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = (open: boolean, text = "Conversation") => act(() => root.render(createElement("div", {"data-open": String(open)}, createElement(SidebarMain, {open, children: createElement("input", {defaultValue: text})}))));
it("retains the conversation surface when sidebar layout changes in both directions", async () => {
  render(true); await act(async () => { await finishMotion(); });
  const input = container.querySelector("input")!; input.value = "draft";
  render(false); await act(async () => { await finishMotion(); });
  render(true); await act(async () => { await finishMotion(); });
  expect(container.querySelector("input")).toBe(input); expect(input.value).toBe("draft");
  expect(isPaneResizing()).toBe(false);
});
it("releases a pending terminal refit when the animated surface unmounts", async () => {
  render(true); await act(async () => { await finishMotion(); });
  render(false); await act(async () => { motionFrame(); await Promise.resolve(); });
  act(() => root.render(null)); expect(isPaneResizing()).toBe(false);
});
it("settles sidebar changes immediately with reduced motion", async () => {
  reduced = true; render(true); render(false); await act(async () => { await finishMotion(); });
  expect(container.querySelector<HTMLElement>("[data-sidebar-main]")?.style.transform ?? "").not.toContain("translate");
  expect(isPaneResizing()).toBe(false);
});
