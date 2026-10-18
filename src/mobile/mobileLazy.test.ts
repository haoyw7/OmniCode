import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement, createRef, useImperativeHandle, type ComponentType, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobilePageOverlay } from "./MobilePageTransition";
import { MobileSheet } from "./MobileSheet";
import { MobileSheetPresence } from "./MobileSheetPresence";
import { lazyMobilePage, lazyMobileSheet } from "./mobileLazy";

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  startMotionClock();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
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

function deferred<Props>() {
  let resolve!: (value: { default: ComponentType<Props> }) => void;
  const promise = new Promise<{ default: ComponentType<Props> }>((done) => { resolve = done; });
  return { resolve, load: vi.fn(() => promise) };
}

it("closes a still-loading sheet and does not resurrect it when the chunk arrives", async () => {
  type Props = { open?: boolean; onExited?: () => void; onClose: () => void };
  const module = deferred<Props>();
  const Sheet = lazyMobileSheet(module.load);
  const onClose = vi.fn();
  const show = async (open: boolean) => act(async () => root.render(createElement(
    MobileSheetPresence, { open, children: createElement(Sheet, { onClose }) },
  )));
  await show(false);
  expect(module.load).not.toHaveBeenCalled();
  await show(true);
  await advanceMotionTimers(600);
  expect(node.querySelector("[role=status]")).not.toBeNull();
  act(() => node.querySelector<HTMLButtonElement>("button")!.click());
  expect(onClose).toHaveBeenCalledOnce();
  await show(false);
  expect(node.querySelector<HTMLElement>(".mobile-sheet-backdrop")?.inert).toBe(true);
  await advanceMotionTimers(1000);
  await act(async () => module.resolve({ default: props => createElement(MobileSheet, {
    ...props, title: "Loaded sheet", children: "Loaded content",
  }) }));
  expect(node.querySelector(".mobile-sheet")).toBeNull();
  await show(true);
  expect(node.textContent).toContain("Loaded content");
});

it.each([false, true])("finishes a closing import race and supports reversal: %s", async (reverse) => {
  type Props = { open?: boolean; onExited?: () => void; onClose: () => void };
  const module = deferred<Props>();
  const Sheet = lazyMobileSheet(module.load);
  const onExited = vi.fn();
  const show = async (open: boolean) => act(async () => root.render(createElement(
    MobileSheetPresence, { open, children: createElement(Sheet, { onClose: () => {}, onExited }) },
  )));
  await show(true);
  await advanceMotionTimers(600);
  await show(false);
  await advanceMotionTimers(50);
  if (reverse) await show(true);
  await act(async () => module.resolve({ default: props => createElement(MobileSheet, {
    ...props, title: "Loaded sheet", children: "Loaded content",
  }) }));
  await advanceMotionTimers(1000);
  if (reverse) {
    expect(node.textContent).toContain("Loaded content");
    expect(onExited).not.toHaveBeenCalled();
    await show(false);
    await advanceMotionTimers(1000);
  }
  expect(onExited).toHaveBeenCalledOnce();
  expect(node.querySelector(".mobile-sheet")).toBeNull();
});

it("loads an overlay only on first open and preserves its imperative ref and mounted state", async () => {
  type Handle = { value: number };
  type Props = { ref: Ref<Handle> };
  const module = deferred<Props>();
  const Page = lazyMobilePage(module.load);
  const ref = createRef<Handle>();
  const show = async (open: boolean) => act(async () => root.render(createElement(
    MobilePageOverlay, { open, keepMounted: true, children: createElement(Page, { ref }) },
  )));
  await show(false);
  expect(module.load).not.toHaveBeenCalled();
  await show(true);
  await act(async () => module.resolve({ default: props => {
    useImperativeHandle(props.ref, () => ({ value: 42 }), []);
    return createElement("div", null, "Loaded page");
  } }));
  const handle = ref.current;
  expect(handle?.value).toBe(42);
  await show(false);
  await advanceMotionTimers(1000);
  expect(node.querySelector<HTMLElement>(".mobile-page-overlay")?.hidden).toBe(true);
  await show(true);
  expect(ref.current).toBe(handle);
  expect(module.load).toHaveBeenCalledOnce();
});
