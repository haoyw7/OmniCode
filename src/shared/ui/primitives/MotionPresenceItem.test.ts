// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startMotionClock, stopMotionClock, finishMotion } from "../../../../tests/helpers/sharedMotionClock";
import { applyReducedMotion } from "../../lib/reducedMotion";
import { SurfaceVisibilityContext } from "../SurfaceVisibility";
import { Dialog, DialogContent, DialogTrigger } from "./Dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  applyReducedMotion("system");
  stopMotionClock();
  vi.unstubAllGlobals();
});
function Example({ dialog = false, visible = true }: { dialog?: boolean; visible?: boolean }) {
  const [open, setOpen] = useState(false);
  const draft = createElement("input", { "aria-label": "Retained draft", defaultValue: "draft" });
  const close = createElement("button", { onClick: () => setOpen(false) }, "Close fixture");
  const example = dialog
    ? createElement(Dialog, { open, onOpenChange: setOpen }, createElement(DialogTrigger, null, "Open"), createElement(DialogContent, { "aria-label": "Fixture surface" }, draft, close))
    : createElement(Popover, { open, onOpenChange: setOpen }, createElement(PopoverTrigger, null, "Open"), createElement(PopoverContent, { "aria-label": "Fixture surface" }, draft, close));
  return createElement(SurfaceVisibilityContext.Provider, { value: visible }, example);
}
async function mount(dialog = false, visible = true) {
  await act(async () => root.render(createElement(Example, { dialog, visible })));
}
async function open() {
  await act(async () => node.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => finishMotion());
}
it.each([false, true])("preserves an open draft when the live motion policy changes (dialog=%s)", async (dialog) => {
  await mount(dialog);
  await open();
  const input = document.querySelector<HTMLInputElement>('[aria-label="Retained draft"]')!;
  expect(input).not.toBeNull();
  input.value = "unsent edit";
  for (const policy of ["on", "off"] as const) {
    await act(async () => applyReducedMotion(policy));
    expect(document.querySelector('[aria-label="Retained draft"]')).toBe(input);
    expect(input.value).toBe("unsent edit");
  }
  await act(async () => applyReducedMotion("on"));
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Close fixture")!.click());
  expect(document.querySelector('[aria-label="Retained draft"]')).toBeNull();
});
it("releases a forced Radix portal when its retained parent is hidden", async () => {
  await mount();
  await open();
  expect(document.querySelector('[aria-label="Retained draft"]')).not.toBeNull();
  await mount(false, false);
  expect(document.querySelector('[aria-label="Retained draft"]')).toBeNull();
});
