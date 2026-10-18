// @vitest-environment happy-dom
import { act, createElement, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectTerminalDock } from "./ProjectTerminalDock";
import { createProjectTerminal } from "../../projects/model/projectTerminal";
import { newTerminalFile } from "../../workspace/model/layout";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { isPaneResizing, onPaneResizeSettled } from "../../../shared/lib/paneResize";

const lifetime = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("./TerminalView", () => ({
  TerminalView: ({ active }: { active: boolean }) => {
    useEffect(() => {
      lifetime.mount();
      return lifetime.unmount;
    }, []);
    return createElement("div", { "data-terminal-active": active });
  },
}));
vi.mock("../../../app/shell/WindowChrome", () => ({
  IconButton: ({ label, onClick }: { label: string; onClick: () => void }) =>
    createElement("button", { "aria-label": label, onClick }, label),
}));

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof ProjectTerminalDock>;
async function render(visible: boolean) {
  await act(async () => {
    root.render(
      createElement(
        SurfaceVisibilityContext.Provider,
        { value: visible },
        createElement(ProjectTerminalDock, props),
      ),
    );
    await vi.dynamicImportSettled();
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  lifetime.mount.mockClear();
  lifetime.unmount.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    dock: createProjectTerminal("/repo", newTerminalFile("/repo")),
    focused: true,
    onFocus: vi.fn(),
    onHide: vi.fn(),
    onSideChange: vi.fn(),
    onSizePaint: vi.fn(),
    onSizeCommit: vi.fn(),
    onAddTerminal: vi.fn(),
    onSelectTerminal: vi.fn(),
    onCloseTerminal: vi.fn(),
    onCloseOtherTerminals: vi.fn(),
    onReorderTerminals: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["pointerup", "pointercancel", "lostpointercapture", "blur", "unmount"])("releases deferred terminal fitting on %s", async (reason) => {
  await render(true);
  const sash = container.querySelector<HTMLElement>('[role="separator"]')!;
  sash.setPointerCapture = vi.fn();
  sash.hasPointerCapture = vi.fn(() => true);
  sash.releasePointerCapture = vi.fn();
  const settled = vi.fn();
  const unsubscribe = onPaneResizeSettled(settled);
  try {
    act(() => sash.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, clientY: 200, bubbles: true })));
    expect(isPaneResizing()).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    if (reason === "unmount") await act(async () => root.render(null));
    else if (reason === "blur") act(() => window.dispatchEvent(new Event("blur")));
    else act(() => sash.dispatchEvent(new PointerEvent(reason, { pointerId: 7, clientY: 180, bubbles: true })));
    expect(isPaneResizing()).toBe(false);
    expect(settled).toHaveBeenCalledOnce();
  } finally { unsubscribe(); }
});

it("exposes the terminal dock side to its own layout", async () => {
  await render(true);
  expect(container.querySelector(".project-terminal-card")?.getAttribute("data-dock-side")).toBe(props.dock.side);
  props.dock = { ...props.dock, side: "right" };
  await render(true);
  expect(container.querySelector(".project-terminal-card")?.getAttribute("data-dock-side")).toBe("right");
});

it("keeps running content mounted, suppresses focus and hides the move menu during collapse", async () => {
  await render(true);
  const terminal = container.querySelector<HTMLElement>(
    "[data-terminal-active]",
  )!;
  expect(terminal.dataset.terminalActive).toBe("true");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Move Terminal"]')!
      .click(),
  );
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await render(false);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(terminal.dataset.terminalActive).toBe("false");
  act(() =>
    terminal.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
  );
  expect(props.onFocus).not.toHaveBeenCalled();
  await render(true);
  expect(container.querySelector("[data-terminal-active]")).toBe(terminal);
  expect(lifetime.mount).toHaveBeenCalledTimes(1);
  expect(lifetime.unmount).not.toHaveBeenCalled();
});

it("keeps inactive terminal tabs laid out but inert when switching the shared strip", async () => {
  const first = props.dock.pane.files[0];
  const second = newTerminalFile("/repo");
  props.dock.pane.files = [first, second];
  props.dock.pane.activeFileId = first.id;
  await render(true);
  const terminals = [...container.querySelectorAll<HTMLElement>("[data-terminal-active]")];
  const panels = terminals.map((terminal) => terminal.parentElement!);
  expect(panels[1].classList.contains("hidden")).toBe(false);
  expect(panels[1].classList.contains("invisible")).toBe(true);
  expect(panels[1].hasAttribute("inert")).toBe(true);

  props.dock = { ...props.dock, pane: { ...props.dock.pane, activeFileId: second.id } };
  await render(true);
  expect(panels[0].classList.contains("hidden")).toBe(false);
  expect(panels[0].classList.contains("invisible")).toBe(true);
  expect(panels[0].hasAttribute("inert")).toBe(true);
  expect(panels[1].hasAttribute("inert")).toBe(false);
  expect(panels[1].classList.contains("invisible")).toBe(false);
  expect(terminals[1].dataset.terminalActive).toBe("true");
  expect(lifetime.mount).toHaveBeenCalledTimes(2);
  expect(lifetime.unmount).not.toHaveBeenCalled();
});

it("commits and releases an active resize before closing", async () => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 42),
  );
  const cancel = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancel);
  await render(true);
  const sash = container.querySelector<HTMLElement>('[role="separator"]')!;
  sash.setPointerCapture = vi.fn();
  sash.hasPointerCapture = vi.fn(() => true);
  sash.releasePointerCapture = vi.fn();
  act(() => {
    sash.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 7,
        clientY: 100,
        bubbles: true,
      }),
    );
    sash.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 7,
        clientY: 80,
        bubbles: true,
      }),
    );
  });
  expect(document.body.style.cursor).toBe("row-resize");
  await render(false);
  expect(props.onSizeCommit).toHaveBeenCalledExactlyOnceWith(240);
  expect(props.onSizePaint).toHaveBeenCalledExactlyOnceWith(240);
  expect(cancel).not.toHaveBeenCalled();
  expect(sash.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(document.body.style.cursor).not.toBe("row-resize");
});

it("flushes the final pointer sample before committing, ignores other pointers and keeps the terminal mounted", async () => {
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 42;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = undefined;
  });
  await render(true);
  const sash = container.querySelector<HTMLElement>('[role="separator"]')!;
  sash.setPointerCapture = vi.fn();
  sash.hasPointerCapture = vi.fn(() => true);
  sash.releasePointerCapture = vi.fn();
  const pointer = (type: string, clientY: number, pointerId = 7) =>
    act(() => {
      sash.dispatchEvent(
        new PointerEvent(type, { pointerId, clientY, bubbles: true }),
      );
    });
  pointer("pointerdown", 100);
  pointer("pointermove", 0, 2);
  pointer("pointerup", 0, 2);
  expect(props.onSizePaint).not.toHaveBeenCalled();
  expect(props.onSizeCommit).not.toHaveBeenCalled();
  pointer("pointermove", 80);
  pointer("pointermove", 60);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  expect(vi.mocked(props.onSizePaint).mock.calls).toEqual([[240], [260]]);
  expect(props.onSizeCommit).not.toHaveBeenCalled();
  pointer("pointerup", 40);
  expect(vi.mocked(props.onSizePaint).mock.calls).toEqual([[240], [260], [280]]);
  expect(props.onSizeCommit).toHaveBeenCalledExactlyOnceWith(280);
  expect(vi.mocked(props.onSizePaint).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(props.onSizeCommit).mock.invocationCallOrder[0],
  );
  expect(frame).toBeUndefined();
  expect(sash.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(lifetime.mount).toHaveBeenCalledTimes(1);
  expect(lifetime.unmount).not.toHaveBeenCalled();
});
