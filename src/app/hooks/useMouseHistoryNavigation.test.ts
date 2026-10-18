// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMouseHistoryNavigation } from "./useMouseHistoryNavigation";

let root: Root;
let container: HTMLDivElement;
const back = vi.fn();
const forward = vi.fn();

function Harness() {
  useMouseHistoryNavigation(back, forward);
  return createElement("textarea");
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  back.mockClear();
  forward.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([3, 4])(
  "handles side button %s once and cancels native history over an input",
  (button) => {
    const input = container.querySelector("textarea")!;
    const childHandler = vi.fn();
    input.addEventListener("mouseup", childHandler);
    for (const type of ["mousedown", "mouseup", "auxclick"]) {
      const event = new MouseEvent(type, {
        button,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(back).toHaveBeenCalledTimes(button === 3 ? 1 : 0);
    expect(forward).toHaveBeenCalledTimes(button === 4 ? 1 : 0);
    expect(childHandler).not.toHaveBeenCalled();
  },
);

it.each([0, 1, 2])("preserves ordinary mouse button %s", (button) => {
  const input = container.querySelector("textarea")!;
  const childHandler = vi.fn();
  input.addEventListener("mouseup", childHandler);
  for (const type of ["mousedown", "mouseup", "auxclick"]) {
    const event = new MouseEvent(type, {
      button,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(childHandler).toHaveBeenCalledOnce();
  expect(back).not.toHaveBeenCalled();
  expect(forward).not.toHaveBeenCalled();
});

it("removes global handlers when the workspace unmounts", async () => {
  await act(async () => root.render(null));
  for (const type of ["mousedown", "mouseup", "auxclick"]) {
    const event = new MouseEvent(type, {
      button: 3,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(back).not.toHaveBeenCalled();
});
