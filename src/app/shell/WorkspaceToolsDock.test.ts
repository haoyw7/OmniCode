// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSurfaceVisibility } from "../../shared/ui/SurfaceVisibility";
import { applyReducedMotion } from "../../shared/lib/reducedMotion";
import { WorkspaceToolsDock } from "./WorkspaceToolsDock";
import type { SidebarProps } from "./Sidebar.types";

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0, renders: 0 }));
vi.mock("./ProjectToolsPanel", () => ({
  ProjectToolsPanel: function Tools({ tab }: { tab: "files" | "changes" }) {
    lifecycle.renders++;
    const visible = useSurfaceVisibility();
    useEffect(() => {
      lifecycle.mounts++;
      return () => {
        lifecycle.unmounts++;
      };
    }, []);
    return createElement("input", {
      "data-tools-visible": visible,
      "data-tools-tab": tab,
      defaultValue: "Retained search",
    });
  },
}));
let root: Root;
let container: HTMLDivElement;
const noop = () => {};
beforeEach(() => {
  lifecycle.mounts = 0;
  lifecycle.unmounts = 0;
  lifecycle.renders = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  act(() => applyReducedMotion("system"));
  vi.unstubAllGlobals();
});
function render(tab: SidebarProps["tab"], visible = true) {
  const sidebar = {
    cwd: "/repo",
    open: true,
    tab,
    sessions: [],
    busySessionIds: new Set<string>(),
    approvalSessionIds: new Set<string>(),
    status: "idle",
    pending: false,
    onSelectSession: noop,
    onOpenFile: noop,
    onTabChange: noop,
    filesSearchOpen: false,
    onFilesSearchOpenChange: noop,
  } satisfies SidebarProps;
  act(() =>
    root.render(
      createElement(WorkspaceToolsDock, {
        sidebar,
        visible,
        children: createElement("textarea", {
          "aria-label": "Workspace draft",
          defaultValue: "Keep my draft",
        }),
      }),
    ),
  );
}
function finish() {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", {
    value: "grid-template-columns",
  });
  act(() =>
    container.querySelector(".desktop-tools-layout")!.dispatchEvent(event),
  );
}

it("loads tools on demand, retains workspace and search through closing and reversal", () => {
  render("sessions");
  expect(lifecycle.mounts).toBe(0);
  const workspace = container.querySelector("textarea");
  render("changes");
  finish();
  const search = container.querySelector<HTMLInputElement>("input")!;
  search.value = "draft query";
  expect(lifecycle.mounts).toBe(1);
  render("sessions");
  const panel = container.querySelector<HTMLElement>("aside")!;
  expect(panel.inert).toBe(true);
  expect(search.dataset.toolsVisible).toBe("false");
  expect(
    container
      .querySelector(".desktop-tools-layout")
      ?.getAttribute("data-fold-state"),
  ).toBe("closing");
  render("changes");
  finish();
  expect(search.value).toBe("draft query");
  expect(panel.inert).toBe(false);
  render("sessions");
  finish();
  expect(panel.hidden).toBe(true);
  expect(lifecycle.unmounts).toBe(0);
  expect(container.querySelector("textarea")).toBe(workspace);
});

it("settles immediately when reduced motion changes during closing", () => {
  render("changes");
  render("sessions");
  act(() => applyReducedMotion("on"));
  expect(
    container
      .querySelector(".desktop-tools-layout")
      ?.getAttribute("data-fold-state"),
  ).toBe("closed");
  expect(container.querySelector<HTMLElement>("aside")?.hidden).toBe(true);
  expect(container.querySelector("textarea")?.value).toBe("Keep my draft");
});

it("supports keyboard sizing and disables hidden tools while another page is active", () => {
  render("changes");
  finish();
  const separator = container.querySelector('[role="separator"]')!;
  act(() =>
    separator.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "ArrowLeft",
        shiftKey: true,
      }),
    ),
  );
  expect(
    container.querySelector(".desktop-tools-layout")?.getAttribute("style"),
  ).toContain("336px");
  render("changes", false);
  expect(container.querySelector<HTMLElement>("aside")?.inert).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>("input")?.dataset.toolsVisible,
  ).toBe("false");
});

it("retains the changes draft and never renders a files tab in the changes dock", () => {
  render("changes");
  finish();
  const changes = container.querySelector<HTMLInputElement>('[data-tools-tab="changes"]')!;
  changes.value = "commit draft";
  render("sessions");
  finish();
  render("files");
  expect(container.querySelector('[data-tools-tab="files"]')).toBeNull();
  expect(container.querySelector<HTMLElement>("aside")?.inert).toBe(true);
  render("changes");
  finish();
  expect(changes.value).toBe("commit draft");
  expect(changes.dataset.toolsVisible).toBe("true");
  expect(lifecycle.unmounts).toBe(0);
});

function moveHandle() {
  return container.querySelector<HTMLButtonElement>(".desktop-tools-move")!;
}

function startMove() {
  const grid = container.querySelector<HTMLElement>(".desktop-tools-layout")!;
  grid.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800);
  moveHandle().setPointerCapture = vi.fn();
  moveHandle().releasePointerCapture = vi.fn();
  act(() => moveHandle().dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true, button: 0, pointerId: 1, clientX: 850, clientY: 8,
  })));
}

function movePointer(type: string, x: number, y: number, pointerId = 1) {
  act(() => window.dispatchEvent(new PointerEvent(type, { pointerId, clientX: x, clientY: y })));
}

it("drags the retained tools to all four edges without remounting the workspace or search", () => {
  render("changes");
  finish();
  const search = container.querySelector<HTMLInputElement>("input")!;
  const workspace = container.querySelector("textarea");
  search.value = "keep filter";
  for (const [side, x, y] of [["left", 2, 400], ["top", 500, 2], ["bottom", 500, 798], ["right", 998, 400]] as const) {
    startMove();
    movePointer("pointermove", x, y);
    expect(container.querySelector(".desktop-tools-layout")?.getAttribute("data-moving")).toBe("true");
    movePointer("pointerup", x, y);
    expect(container.querySelector(".desktop-tools-layout")?.getAttribute("data-tools-side")).toBe(side);
    expect(container.querySelector("input")).toBe(search);
    expect(search.value).toBe("keep filter");
    expect(container.querySelector("textarea")).toBe(workspace);
    expect(document.querySelector(".drag-ghost")).toBeNull();
  }
  expect(lifecycle.mounts).toBe(1);
  expect(lifecycle.unmounts).toBe(0);
});

it.each(["escape", "pointercancel", "blur", "lostcapture", "outside", "close", "unmount"])("cancels a tools move on %s and cleans up the drag", (reason) => {
  render("changes");
  finish();
  startMove();
  movePointer("pointermove", 2, 400);
  expect(document.querySelector(".drag-ghost")).not.toBeNull();
  if (reason === "escape") act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  if (reason === "pointercancel") movePointer("pointercancel", 2, 400);
  if (reason === "blur") act(() => window.dispatchEvent(new Event("blur")));
  if (reason === "lostcapture") act(() => moveHandle().dispatchEvent(new Event("lostpointercapture")));
  if (reason === "outside") movePointer("pointerup", -10, 400);
  if (reason === "close") render("sessions");
  if (reason === "unmount") act(() => root.render(null));
  expect(document.querySelector(".drag-ghost")).toBeNull();
  expect(document.documentElement.classList.contains("is-reordering")).toBe(false);
  expect(document.body.style.cursor).not.toBe("grabbing");
  movePointer("pointerup", 2, 400);
  if (reason !== "unmount") expect(container.querySelector(".desktop-tools-layout")?.getAttribute("data-tools-side")).toBe("right");
});

it("moves by keyboard and keeps vertical tools mounted until closing finishes", () => {
  render("changes");
  finish();
  act(() => moveHandle().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })));
  expect(container.querySelector(".desktop-tools-layout")?.getAttribute("data-tools-side")).toBe("top");
  render("sessions");
  expect(container.querySelector<HTMLElement>("aside")?.inert).toBe(true);
  expect(container.querySelector<HTMLElement>("aside")?.hidden).toBe(false);
  const end = new Event("transitionend", { bubbles: true });
  Object.defineProperty(end, "propertyName", { value: "grid-template-rows" });
  act(() => container.querySelector(".desktop-tools-layout")!.dispatchEvent(end));
  expect(container.querySelector<HTMLElement>("aside")?.hidden).toBe(true);
  expect(lifecycle.unmounts).toBe(0);
});

it("drags only the heading and coalesces pointer bursts without rerendering tools", () => {
  render("changes");
  finish();
  const renders = lifecycle.renders;
  const content = document.createElement("div");
  content.dataset.largeFileTree = "";
  for (let index = 0; index < 1000; index++) content.append(document.createElement("span"));
  container.querySelector("aside")!.append(content);
  let frame: FrameRequestCallback | undefined;
  const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 42; });
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  startMove();
  movePointer("pointermove", 2, 400);
  const ghost = document.querySelector<HTMLElement>(".drag-ghost-card")!;
  expect(ghost.querySelector("[data-large-file-tree]")).toBeNull();
  expect(ghost.querySelectorAll("*").length).toBeLessThan(20);
  const before = ghost.style.transform;
  movePointer("pointermove", 450, 2);
  movePointer("pointermove", 500, 2);
  movePointer("pointermove", 550, 2);
  expect(request).toHaveBeenCalledTimes(1);
  expect(ghost.style.transform).toBe(before);
  act(() => frame?.(0));
  expect(ghost.style.transform).not.toBe(before);
  expect(lifecycle.renders).toBe(renders);
  movePointer("pointermove", 500, 798);
  // Release wins even if the final paint hasn't run.
  movePointer("pointerup", 998, 400);
  expect(container.querySelector(".desktop-tools-layout")?.getAttribute("data-tools-side")).toBe("right");
  expect(cancel).toHaveBeenCalledWith(42);
  expect(document.querySelector(".drag-ghost")).toBeNull();
});
