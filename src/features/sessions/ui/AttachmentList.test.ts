// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finishMotion, startMotionClock, stopMotionClock } from "../../../../tests/helpers/sharedMotionClock";
import type { Attachment } from "../model/session";
import { AttachmentList } from "./AttachmentList";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  stopMotionClock();
  vi.unstubAllGlobals();
});
async function render(ids: string[]) {
  await act(async () => root.render(createElement(AttachmentList, {
    attachments: ids.map(id => ({ id, name: id, kind: "file" }) as Attachment),
    animated: true,
    renderAttachment: file => createElement(Preview, { name: file.name }),
  })));
}
function Preview({ name }: { name: string }) {
  const visible = useSurfaceVisibility();
  return createElement(Fragment, null, createElement("button", null, name),
    visible ? createPortal(createElement("span", { "data-preview": name }, name), document.body) : null);
}
const chip = (id: string) => node.querySelector<HTMLElement>(`[data-attachment-id="${id}"]`);

it("retains removed chips inert until their exit completes without remounting siblings", async () => {
  await render(["a", "b"]);
  const sibling = chip("b");
  await render(["b"]);
  expect(chip("a")?.inert).toBe(true);
  expect(chip("a")?.getAttribute("aria-hidden")).toBe("true");
  expect(document.querySelector('[data-preview="a"]')).toBeNull();
  expect(chip("b")).toBe(sibling);
  await act(async () => finishMotion());
  expect(chip("a")).toBeNull();
  expect(chip("b")).toBe(sibling);
});

it("restores a chip re-added before its exit completes", async () => {
  await render(["a", "b"]);
  await render(["b"]);
  await render(["a", "b"]);
  await act(async () => finishMotion());
  expect(chip("a")).not.toBeNull();
  expect(chip("a")?.inert).toBe(false);
  expect(chip("a")?.hasAttribute("aria-hidden")).toBe(false);
});
