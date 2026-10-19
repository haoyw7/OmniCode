// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageQueue } from "./MessageQueue";
import { setUiLanguage } from "../../../shared/i18n/language";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
function render(props: Partial<Parameters<typeof MessageQueue>[0]> = {}) {
  const onRestore = vi.fn();
  const onReorder = vi.fn();
  const onDelete = vi.fn();
  const onSteer = vi.fn();
  const onResume = vi.fn();
  act(() =>
    root.render(
      createElement(MessageQueue, {
        messages: [{ id: "row", text: "Queued text", attachments: [] }],
        onRestore,
        onReorder,
        onDelete,
        onSteer,
        onResume,
        ...props,
      }),
    ),
  );
  const click = async (label: string) =>
    act(async () =>
      node
        .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
        .click(),
    );
  return { onRestore, onReorder, onDelete, onSteer, onResume, click };
}
it("returns the complete queued message to the composer without an inline editor", async () => {
  const message = { id: "row", text: "Queued text", attachments: [{ id: "image", name: "image.png", kind: "image" as const, mimeType: "image/png", size: 3, data: "YWJj" }], intent: "plan" as const };
  const s = render({ messages: [message] });
  await s.click("Edit queued message");
  expect(s.onRestore).toHaveBeenCalledExactlyOnceWith(message);
  expect(node.querySelector("textarea")).toBeNull();
  expect(s.onDelete).not.toHaveBeenCalled();
});
it("waits for take-back confirmation and keeps the row on rejection", async () => {
  let reject!: (reason: Error) => void;
  const onRestore = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const s = render({ remote: true, onRestore });
  await s.click("Edit queued message");
  await s.click("Edit queued message");
  expect(onRestore).toHaveBeenCalledTimes(1);
  expect(node.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')?.disabled).toBe(true);
  await act(async () => reject(new Error("Host is offline")));
  expect(node.textContent).toContain("Queued text");
  expect(node.querySelector('[role="alert"]')?.textContent).toContain("Host is offline");
  expect(node.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')?.disabled).toBe(false);
});
const rows = ["a", "b", "c"].map(id => ({ id, text: id, attachments: [] }));
it("supports moving a queued row in both directions with the keyboard", async () => {
  const s = render({ messages: rows });
  const handle = (id: string) => node.querySelector<HTMLButtonElement>(`[data-queue-id="${id}"] button`)!;
  await act(async () => handle("a").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(s.onReorder).toHaveBeenLastCalledWith("a", "c");
  await act(async () => handle("b").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
  expect(s.onReorder).toHaveBeenLastCalledWith("b", "a");
  await act(async () => handle("c").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
  expect(s.onReorder).toHaveBeenLastCalledWith("c", "b");
});
it("keeps a pending remote order visible and rolls it back on rejection", async () => {
  let reject!: (reason: Error) => void;
  const onReorder = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  render({ messages: rows, onReorder });
  await act(async () => node.querySelector('[data-queue-id="b"] button')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(onReorder).toHaveBeenCalledWith("b", undefined);
  expect([...node.querySelectorAll<HTMLElement>("[data-queue-id]")].map(row => row.dataset.queueId)).toEqual(["a", "c", "b"]);
  await act(async () => reject(new Error("Queue changed")));
  expect([...node.querySelectorAll<HTMLElement>("[data-queue-id]")].map(row => row.dataset.queueId)).toEqual(["a", "b", "c"]);
  expect(node.querySelector('[role="alert"]')?.textContent).toContain("Queue changed");
});
it.each([{ disabled: true }, { canReorder: false }])("disables reordering while unavailable: %j", props => {
  render({ messages: rows, ...props });
  expect([...node.querySelectorAll<HTMLButtonElement>('[aria-label="Drag to reorder queued message"]')].every(button => button.disabled)).toBe(true);
});
it("keeps the accepted remote order until the Host snapshot arrives", async () => {
  let accept!: () => void;
  const onReorder = vi.fn(() => new Promise<void>(resolve => { accept = resolve; }));
  render({ messages: rows, remote: true, onReorder });
  await act(async () => node.querySelector('[data-queue-id="b"] button')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => accept());
  expect([...node.querySelectorAll<HTMLElement>("[data-queue-id]")].map(row => row.dataset.queueId)).toEqual(["a", "c", "b"]);
  expect(node.querySelector<HTMLButtonElement>('[aria-label="Drag to reorder queued message"]')?.disabled).toBe(true);
  render({ messages: [rows[0], rows[2], rows[1]], remote: true, onReorder });
  expect(node.querySelector<HTMLButtonElement>('[aria-label="Drag to reorder queued message"]')?.disabled).toBe(false);
});

function dragRows() {
  document.documentElement.dataset.reducedMotion = "on";
  for (const [index, row] of [...node.querySelectorAll<HTMLElement>("[data-queue-id]")].entries()) {
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ x: 0, y: index * 30, left: 0, top: index * 30, right: 300, bottom: index * 30 + 28, width: 300, height: 28, toJSON: () => ({}) });
    row.setPointerCapture = vi.fn();
    row.hasPointerCapture = () => true;
    row.releasePointerCapture = vi.fn();
  }
  return {
    press: (id: string, y: number) => act(() => node.querySelector(`[data-queue-id="${id}"] button`)!.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientY: y, pointerId: 1, bubbles: true }))),
    move: (y: number) => act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: y, pointerId: 1 }))),
    release: (y: number) => act(async () => window.dispatchEvent(new PointerEvent("pointerup", { clientY: y, pointerId: 1 }))),
  };
}
it("commits pointer dragging only on release and supports a second drag in the other direction", async () => {
  const s = render({ messages: rows });
  const pointer = dragRows();
  pointer.press("a", 14);
  pointer.move(74);
  expect(s.onReorder).not.toHaveBeenCalled();
  await pointer.release(74);
  expect(s.onReorder).toHaveBeenLastCalledWith("a", undefined);
  pointer.press("c", 74);
  pointer.move(14);
  await pointer.release(14);
  expect(s.onReorder).toHaveBeenLastCalledWith("c", "a");
  expect(s.onReorder).toHaveBeenCalledTimes(2);
  expect(node.querySelector('[data-dragging="true"]')).toBeNull();
  delete document.documentElement.dataset.reducedMotion;
});
it.each(["Escape", "pointercancel", "blur"])("cancels a queued drag with %s", async reason => {
  const s = render({ messages: rows });
  const pointer = dragRows();
  pointer.press("a", 14);
  pointer.move(74);
  await act(async () => window.dispatchEvent(reason === "Escape" ? new KeyboardEvent("keydown", { key: "Escape" }) : new Event(reason)));
  expect(s.onReorder).not.toHaveBeenCalled();
  expect(node.querySelector('[data-dragging="true"]')).toBeNull();
  delete document.documentElement.dataset.reducedMotion;
});
it("disables unavailable steer while leaving edit and delete usable", async () => {
  const s = render({ canSteer: false });
  expect(
    [...node.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Steer"),
    )?.disabled,
  ).toBe(true);
  await s.click("Remove queued message");
  expect(s.onDelete).toHaveBeenCalledWith("row");
});
it("shows a localized shared paused queue with an explicit resume action", () => {
  setUiLanguage("zh-CN");
  const s = render({ remote: true, status: "paused" });
  expect(node.textContent).toContain("队列已暂停");
  const resume = [...node.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("继续"),
  )!;
  act(() => resume.click());
  expect(s.onResume).toHaveBeenCalledTimes(1);
});
