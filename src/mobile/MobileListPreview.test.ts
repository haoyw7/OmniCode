import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileListPreview } from "./MobileListPreview";
import { MobilePageStateContext, type MobilePageState } from "./mobilePageState";

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
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
  vi.unstubAllGlobals();
});

it("prepares only visible rows and the next batch for a large history", () => {
  const items = Array.from({ length: 5000 }, (_, index) => index);
  const renderItem = vi.fn((item: number) =>
    createElement("span", { key: item, "data-row": item }, item),
  );
  act(() =>
    root.render(
      createElement(MobileListPreview<number>, { items, renderItem }),
    ),
  );
  expect(renderItem.mock.calls.map(([item]) => item)).toEqual([0, 1, 2, 3, 4]);
  expect(node.querySelectorAll(".zen-fold-item")).toHaveLength(0);
  act(() => node.querySelector<HTMLButtonElement>("button")!.click());
  expect(node.querySelectorAll("[data-row]")).toHaveLength(10);
  expect(node.querySelectorAll(".zen-fold-item")).toHaveLength(1);
  expect(renderItem.mock.calls.every(([item]) => item < 10)).toBe(true);
});

it("retains closing rows and reverses a rapid collapse without rebuilding untouched batches", async () => {
  const items = Array.from({ length: 12 }, (_, index) => index);
  const renderItem = (item: number) =>
    createElement("button", { key: item, "data-row": item }, item);
  act(() =>
    root.render(
      createElement(MobileListPreview<number>, { items, renderItem }),
    ),
  );
  const toggle = () =>
    act(() =>
      node.querySelector<HTMLButtonElement>(".mobile-list-more")!.click(),
    );
  toggle();
  toggle();
  await advanceMotionTimers(350);
  const row = node.querySelector('[data-row="5"]');
  toggle();
  expect(node.querySelectorAll("[data-row]")).toHaveLength(12);
  expect(row?.closest<HTMLElement>(".zen-fold-item")?.inert).toBe(true);
  toggle();
  expect(node.querySelector('[data-row="5"]')).toBe(row);
  expect(row?.closest<HTMLElement>(".zen-fold-item")?.inert).toBe(false);
  await advanceMotionTimers(350);
  expect(node.querySelectorAll("[data-row]")).toHaveLength(10);
});

it("restores visited route batches while keeping search previews transient", () => {
  const page: MobilePageState = { scroll: new Map(), values: new Map() };
  const items = Array.from({ length: 15 }, (_, index) => index);
  const renderItem = (item: number) => createElement("span", { key: item, "data-row": item }, item);
  const render = (key: string, stateKey?: string) => act(() => root.render(
    createElement(MobilePageStateContext.Provider, { value: page },
      createElement(MobileListPreview<number>, { key, stateKey, items, renderItem })),
  ));
  render("initial", "recent");
  act(() => node.querySelector<HTMLButtonElement>("button")!.click());
  expect(page.values.get("recent")).toBe(10);
  render("returned", "recent");
  expect(node.querySelectorAll("[data-row]")).toHaveLength(10);
  render("search");
  expect(node.querySelectorAll("[data-row]")).toHaveLength(5);
  act(() => node.querySelector<HTMLButtonElement>("button")!.click());
  expect(page.values.size).toBe(1);
  render("next-search");
  expect(node.querySelectorAll("[data-row]")).toHaveLength(5);
});
