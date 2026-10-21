// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMotionClock, stopMotionClock, finishMotion } from "../../../tests/helpers/sharedMotionClock";
import { SidebarTransition } from "./SidebarTransition";
import { useSurfaceVisibility } from "../../shared/ui/SurfaceVisibility";
import { isPaneResizing, onPaneResizeSettled } from "../../shared/lib/paneResize";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  stopMotionClock();
  vi.unstubAllGlobals();
});

it("starts closed at zero width and reopens at the current saved width", async () => {
  const committed = vi.fn();
  function Harness({ open, savedWidth }: { open: boolean; savedWidth: number }) {
    const [width, setWidth] = useState(savedWidth);
    useEffect(() => setWidth(savedWidth), [savedWidth]);
    return createElement(SidebarTransition, { open, width,
      dragging: false, setPaneRef: () => {},
      resizeHandle: createElement("button", { onDoubleClick: () => { setWidth(288); committed(288); } }, "Reset width"),
      children: createElement("input", { defaultValue: "Retained draft" }) });
  }
  const render = (open: boolean, savedWidth: number) => act(() => root.render(createElement(Harness, { open, savedWidth })));
  const width = () => container.querySelector<HTMLElement>("[data-sidebar-transition]")!.style.width;
  render(false, 360);
  expect(width()).toBe("0px");
  expect(committed).not.toHaveBeenCalled();
  render(true, 360);
  await act(async () => { await finishMotion(); });
  expect(width()).toBe("360px");
  const input = container.querySelector("input");
  render(false, 420);
  await act(async () => { await finishMotion(); });
  expect(width()).toBe("0px");
  render(true, 420);
  await act(async () => { await finishMotion(); });
  expect(width()).toBe("420px");
  expect(container.querySelector("input")).toBe(input);
  act(() => container.querySelector("button")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await act(async () => { await finishMotion(); });
  expect(width()).toBe("288px");
  expect(committed).toHaveBeenLastCalledWith(288);
});

it("defers workspace fitting throughout folding and rapid reversal, and releases it on unmount", async () => {
  const settled = vi.fn();
  const unsubscribe = onPaneResizeSettled(settled);
  const render = (open: boolean) => act(() => root.render(createElement(SidebarTransition, {
    open, width: 320, dragging: false, setPaneRef: () => {}, children: "Sidebar",
  })));
  try {
    render(false);
    expect(isPaneResizing()).toBe(false);
    render(true);
    expect(isPaneResizing()).toBe(true);
    render(false);
    render(true);
    expect(isPaneResizing()).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    await act(async () => { await finishMotion(); });
    expect(isPaneResizing()).toBe(false);
    expect(settled).toHaveBeenCalledOnce();
    render(false);
    expect(isPaneResizing()).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    expect(isPaneResizing()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
  }
});

describe("retained sidebar content", () => {
  it("defers the first mount, stops hidden parent updates and refreshes on reopening", async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const rendered = vi.fn();
    function Content({ open, text }: { open: boolean; text: string }) {
      const visible = useSurfaceVisibility();
      rendered({ open, visible, text });
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return createElement("input", {
        defaultValue: "saved draft",
        "data-text": text,
      });
    }
    const setPaneRef = vi.fn();
    const finishDrag = vi.fn();
    const render = (open: boolean, text: string) =>
      act(() => {
        const children = createElement(Content, { open, text });
        root.render(
          createElement(SidebarTransition, {
            open,
            width: 280,
            dragging: false,
            setPaneRef,
            finishDrag,
            children,
          }),
        );
      });
    render(false, "initial");
    expect(mounted).not.toHaveBeenCalled();
    render(true, "first");
    const input = container.querySelector("input")!;
    input.value = "keep this edit";
    expect(mounted).toHaveBeenCalledOnce();

    render(false, "closing");
    expect(rendered).toHaveBeenLastCalledWith({
      open: false,
      visible: false,
      text: "closing",
    });
    expect(input.closest("[hidden]")).toBeNull();
    expect(input.closest("[inert]")).not.toBeNull();
    await act(async () => { await finishMotion(); });
    expect(input.closest("[hidden]")).not.toBeNull();
    rendered.mockClear();
    render(false, "latest");
    expect(rendered).not.toHaveBeenCalled();
    expect(unmounted).not.toHaveBeenCalled();

    render(true, "latest");
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("keep this edit");
    expect(input.dataset.text).toBe("latest");
    expect(input.closest("[hidden], [inert]")).toBeNull();
    expect(mounted).toHaveBeenCalledOnce();
    expect(rendered).toHaveBeenLastCalledWith({
      open: true,
      visible: true,
      text: "latest",
    });
  });
});
