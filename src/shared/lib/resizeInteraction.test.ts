// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { beginResizeInteraction } from "./resizeInteraction";
import { isPaneResizing } from "./paneResize";

const cleanup: (() => void)[] = [];
const start = (cursor: "col-resize" | "row-resize") => {
  const end = beginResizeInteraction(cursor);
  cleanup.push(end);
  return end;
};
afterEach(() => {
  cleanup.splice(0).reverse().forEach(end => end());
  document.documentElement.classList.remove("is-resizing");
  document.body.style.cursor = "";
});

it("blocks selection without changing inherited cursor or reorder styles, then fully cleans up", () => {
  document.body.style.cursor = "crosshair";
  const end = start("col-resize");
  expect(document.body.style.cursor).toBe("crosshair");
  expect(document.documentElement.style.getPropertyValue("--resize-cursor")).toBe("");
  expect(document.documentElement.classList.contains("is-reordering")).toBe(false);
  expect(document.querySelector<HTMLElement>("[data-resize-cursor]")?.style.cursor).toBe("col-resize");
  expect(window.dispatchEvent(new Event("selectstart", { cancelable: true }))).toBe(false);
  expect(isPaneResizing()).toBe(true);
  end();
  end();
  expect(window.dispatchEvent(new Event("selectstart", { cancelable: true }))).toBe(true);
  expect(document.querySelector("[data-resize-cursor]")).toBeNull();
  expect(document.documentElement.classList.contains("is-resizing")).toBe(false);
  expect(isPaneResizing()).toBe(false);
  expect(document.body.style.cursor).toBe("crosshair");
});

it("keeps a second interaction active when the first one ends", () => {
  const endFirst = start("col-resize");
  const endSecond = start("row-resize");
  endFirst();
  expect(isPaneResizing()).toBe(true);
  expect(document.documentElement.classList.contains("is-resizing")).toBe(true);
  expect(document.querySelector<HTMLElement>("[data-resize-cursor]")?.style.cursor).toBe("row-resize");
  endSecond();
  expect(isPaneResizing()).toBe(false);
  expect(document.documentElement.classList.contains("is-resizing")).toBe(false);
});

it("preserves a resize class owned by another interaction", () => {
  document.documentElement.classList.add("is-resizing");
  start("row-resize")();
  expect(document.documentElement.classList.contains("is-resizing")).toBe(true);
});
