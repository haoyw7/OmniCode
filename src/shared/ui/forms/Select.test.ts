// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finishMotion, startMotionClock, stopMotionClock } from "../../../../tests/helpers/sharedMotionClock";
import { applyReducedMotion } from "../../lib/reducedMotion";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../SurfaceVisibility";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  applyReducedMotion("system");
  stopMotionClock();
  vi.unstubAllGlobals();
});

function NestedPortal() {
  return useSurfaceVisibility() ? createPortal(createElement("span", { "data-select-nested-portal": "" }, "Nested surface"), document.body) : null;
}
function Example({ controlled = false, visible = true }: { controlled?: boolean; visible?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("one");
  return createElement(SurfaceVisibilityContext.Provider, { value: visible },
    createElement("button", { "data-open": "", onClick: () => setOpen(true) }, "Open"),
    createElement("button", { "data-reset": "", onClick: () => setValue("one") }, "Set first"),
    createElement(Select, { open, onOpenChange: setOpen, ...(controlled ? { value, onValueChange: setValue } : { defaultValue: "one" }) },
      createElement(SelectTrigger, { "aria-label": "Workflow" }, createElement(SelectValue)),
      createElement(SelectContent, { position: "popper" },
        createElement(SelectItem, { value: "one" }, "First workflow"),
        createElement(SelectItem, { value: "two" }, "Second workflow"),
        createElement(NestedPortal),
      ),
    ),
  );
}
async function render(controlled = false, visible = true) {
  await act(async () => root.render(createElement(Example, { controlled, visible })));
}
async function open() {
  await act(async () => container.querySelector<HTMLButtonElement>("[data-open]")!.click());
  await act(async () => finishMotion());
}

it.each([false, true])("keeps the selected label before opening and after animated close (controlled=%s)", async controlled => {
  await render(controlled);
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain("First workflow");
  expect(document.querySelector('[role="option"]')).toBeNull();
  await open();
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  expect(document.querySelector('[data-select-nested-portal]')).not.toBeNull();
  await act(async () => document.querySelectorAll('[role="option"]')[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const closing = document.querySelector<HTMLElement>('[data-slot="select-content"]')!;
  expect(closing).not.toBeNull();
  expect(closing.getAttribute("data-fold-state")).toBe("closing");
  expect(closing.hasAttribute("inert")).toBe(true);
  expect(document.querySelector('[data-select-nested-portal]')).toBeNull();
  await act(async () => finishMotion());
  expect(document.querySelector('[role="option"]')).toBeNull();
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain("Second workflow");
  if (controlled) {
    await act(async () => container.querySelector<HTMLButtonElement>("[data-reset]")!.click());
    expect(container.querySelector('[role="combobox"]')?.textContent).toContain("First workflow");
  }
});

it("releases the menu when its parent becomes hidden and supports reduced-motion close", async () => {
  await render(true);
  await open();
  await render(true, false);
  expect(document.querySelector('[role="option"]')).toBeNull();
  expect(document.querySelector('[data-select-nested-portal]')).toBeNull();
  await render(true, true);
  await act(async () => applyReducedMotion("on"));
  await act(async () => document.querySelectorAll('[role="option"]')[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(document.querySelector('[role="option"]')).toBeNull();
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain("Second workflow");
});
