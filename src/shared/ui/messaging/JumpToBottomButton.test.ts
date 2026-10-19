// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JumpToBottomButton, useJumpToBottomVisibility } from "./JumpToBottomButton";

let node: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("responds to the first click and ignores repeat clicks for 300ms", () => {
  const click = vi.fn();
  act(() => root.render(createElement(JumpToBottomButton, { label: "Jump to latest", onClick: click })));
  const button = node.querySelector("button")!;
  act(() => { button.click(); button.click(); });
  expect(click).toHaveBeenCalledTimes(1);
  act(() => { vi.advanceTimersByTime(299); button.click(); });
  expect(click).toHaveBeenCalledTimes(1);
  act(() => { vi.advanceTimersByTime(1); button.click(); });
  expect(click).toHaveBeenCalledTimes(2);
});

it("cancels a pending reveal when hidden or unmounted", () => {
  function Probe({ active }: { active: boolean }) {
    const visible = useJumpToBottomVisibility(true, active);
    return createElement("span", null, String(visible));
  }
  act(() => root.render(createElement(Probe, { active: true })));
  act(() => vi.advanceTimersByTime(100));
  act(() => root.render(createElement(Probe, { active: false })));
  act(() => vi.advanceTimersByTime(200));
  expect(node.textContent).toBe("false");
  act(() => root.render(createElement(Probe, { active: true })));
  act(() => vi.advanceTimersByTime(150));
  expect(node.textContent).toBe("true");
  act(() => root.render(createElement(Probe, { active: false })));
  expect(node.textContent).toBe("false");
  act(() => root.render(createElement(Probe, { active: true })));
  const timers = vi.getTimerCount();
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(timers - 1);
});
