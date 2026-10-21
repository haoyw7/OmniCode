// @vitest-environment happy-dom
import { act, createElement, memo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DragDropProvider, DragHandleContext, SortableItem, SortableList, useActiveDragPayloadRef, useDragHandle } from "./Sortable";

let root: Root;
let container: HTMLDivElement;
const renderHandle = vi.fn();
const clickHandle = vi.fn();
const Handle = memo(function Handle() {
  const handle = useDragHandle();
  renderHandle();
  return createElement("button", { ...handle, onClick: clickHandle }, "Move item");
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  renderHandle.mockClear();
  clickHandle.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(disabled = false) {
  await act(async () => root.render(createElement(SortableList, {
    ids: ["item"], onReorder: () => {}, renderOverlay: () => "Moving",
    children: createElement(SortableItem, {
      id: "item", disabled,
      children: item => createElement("div", { ref: item.ref, style: item.style },
        createElement(DragHandleContext.Provider, { value: item.handleProps }, createElement(Handle))),
    }),
  })));
}

it("keeps unchanged handles out of parent updates and still applies disabled changes", async () => {
  await render();
  renderHandle.mockClear();
  await render();
  expect(renderHandle).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.getAttribute("aria-disabled")).toBe("false");
  await render(true);
  expect(renderHandle).toHaveBeenCalled();
  expect(container.querySelector("button")?.getAttribute("aria-disabled")).toBe("true");
});

it("keeps layout coordinators and unchanged item contents out of drag initialization updates", async () => {
  const layoutRender = vi.fn(), unrelatedRender = vi.fn();
  let active: ReturnType<typeof useActiveDragPayloadRef>;
  function Coordinator() { active = useActiveDragPayloadRef(); layoutRender(); return null; }
  const list = (id: string) => createElement(SortableList, {
    ids: [id], onReorder: () => {}, renderOverlay: () => id,
    children: createElement(SortableItem, {
      id, payload: { type: "workspace-pane", paneId: id },
      children: item => {
        if (id === "unrelated") unrelatedRender();
        return createElement("div", { ref: item.ref, style: item.style },
          createElement("button", { ...item.handleProps, "data-pickup": id }, id));
      },
    }),
  });
  await act(async () => root.render(createElement(DragDropProvider, null,
    createElement(Coordinator), list("source"), list("unrelated"))));
  layoutRender.mockClear(); unrelatedRender.mockClear();
  const button = container.querySelector<HTMLElement>('[data-pickup="source"]')!;
  await act(async () => {
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(active!.current).toMatchObject({ type: "workspace-pane", paneId: "source" });
  expect(layoutRender).not.toHaveBeenCalled();
  expect(unrelatedRender).toHaveBeenCalledTimes(1);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  });
  expect(active!.current).toBeNull();
  expect(layoutRender).not.toHaveBeenCalled();
});

it("keeps a stationary mouse press clickable and picks up on the first one-pixel movement", async () => {
  await render();
  const handle = container.querySelector("button")!;
  const pointer = async (type: string, x = 100) => act(async () => {
    (type === "pointerdown" ? handle : document).dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0,
      buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: 100,
      bubbles: true, cancelable: true,
    }));
  });
  await pointer("pointerdown");
  expect(document.querySelector("[data-drag-preview]")).toBeNull();
  await pointer("pointerup");
  await act(async () => { handle.click(); });
  expect(clickHandle).toHaveBeenCalledOnce();
  await pointer("pointerdown");
  await pointer("pointermove", 101);
  expect(document.querySelector("[data-drag-preview]")).not.toBeNull();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  });
  expect(document.querySelector("[data-drag-preview]")).toBeNull();
});
