// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLivePhaseScroll } from "./useLivePhaseScroll";

let root: Root;
let container: HTMLDivElement;
let resize: () => void;
let targets: Element[];

function Fixture() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useLivePhaseScroll(el, true, 1);
  return createElement("div", { ref: setEl }, createElement("div"));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  targets = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(target: Element) {
        targets.push(target);
      }
      disconnect() {
        targets = [];
      }
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mountScroller() {
  act(() => root.render(createElement(Fixture)));
  const el = container.firstElementChild as HTMLDivElement;
  const geometry = { height: 1000, viewport: 280, top: 0 };
  Object.defineProperties(el, {
    scrollHeight: { get: () => geometry.height },
    clientHeight: { get: () => geometry.viewport },
    scrollTop: {
      get: () => geometry.top,
      set: (value: number) => {
        geometry.top = Math.max(
          0,
          Math.min(value, geometry.height - geometry.viewport),
        );
      },
    },
  });
  act(() => resize());
  expect(geometry.top).toBe(720);
  const scroll = (top: number) =>
    act(() => {
      geometry.top = top;
      el.dispatchEvent(new Event("scroll"));
    });
  return { el, geometry, scroll };
}

it.each(["scroll event", "resize"])(
  "resumes at the previous bottom when output grows before the %s",
  (event) => {
    const { geometry, scroll, el } = mountScroller();
    scroll(400);
    geometry.top = 720; // The reader reaches the end before the queued event.
    geometry.height = 1100;
    act(() => {
      if (event === "scroll event") el.dispatchEvent(new Event("scroll"));
      resize();
    });
    expect(geometry.top).toBe(820);
    geometry.height = 1200;
    act(() => resize());
    expect(geometry.top).toBe(920);
  },
);

it("keeps following when a downward move and output growth arrive together", () => {
  const { el, geometry } = mountScroller();
  geometry.top = 740;
  geometry.height = 1100;
  act(() => el.dispatchEvent(new Event("scroll")));
  act(() => resize());
  expect(geometry.top).toBe(820);
});

it("observes the window as well as content and follows viewport resizing", () => {
  const { el, geometry } = mountScroller();
  expect(targets).toContain(el);
  expect(targets).toContain(el.firstElementChild);
  geometry.viewport = 200;
  act(() => resize());
  expect(geometry.top).toBe(800);
});

it("keeps a reader paused on an upward move or small downward reversal", () => {
  const { geometry, scroll } = mountScroller();
  scroll(710);
  scroll(712);
  geometry.height = 1100;
  act(() => resize());
  expect(geometry.top).toBe(712);
  scroll(820);
  geometry.height = 1200;
  act(() => resize());
  expect(geometry.top).toBe(920);
});

it("does not resume when a resize clamps a paused reader to the bottom", () => {
  const { geometry, scroll } = mountScroller();
  scroll(700);
  geometry.height = 900;
  scroll(620);
  act(() => resize());
  geometry.height = 1100;
  act(() => resize());
  expect(geometry.top).toBe(620);
});
