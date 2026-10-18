// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { combineSidebarDrops, sidebarPinDrop } from "./sidebarPinDrop";

let root: HTMLElement;
let source: HTMLElement;
let section: HTMLElement;
let header: HTMLElement;
const point = (y: number) =>
  new PointerEvent("pointermove", { clientX: 40, clientY: y });

beforeEach(() => {
  root = document.createElement("div");
  root.dataset.projectList = "tree";
  root.innerHTML =
    '<div data-project-section="pinned"><div data-sidebar-section-header></div><div data-project-children></div></div><div data-source></div>';
  document.body.append(root);
  source = root.querySelector("[data-source]")!;
  section = root.querySelector('[data-project-section="pinned"]')!;
  header = root.querySelector("[data-sidebar-section-header]")!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 240, 500),
  );
  vi.spyOn(section, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 240, 150),
  );
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 240, 28),
  );
});

afterEach(() => {
  root.remove();
  document.querySelectorAll(".drag-label").forEach((node) => node.remove());
  vi.restoreAllMocks();
});

it("accepts the whole pinned area, commits only on drop and clears feedback on leaving/cancellation", () => {
  const pin = vi.fn();
  const drop = sidebarPinDrop(source, "Pin", pin)!;
  expect(drop.onMove("session", point(100))).toBe(true);
  expect(section.dataset.sidebarPinDropTarget).toBe("true");
  expect(pin).not.toHaveBeenCalled();
  expect(drop.onMove("session", point(200))).toBe(false);
  expect(section.dataset.sidebarPinDropTarget).toBeUndefined();
  expect(drop.onDrop("session", point(200))).toBe(false);
  drop.onMove("session", point(20));
  drop.onEnd?.("session");
  expect(pin).not.toHaveBeenCalled();
  expect(document.querySelector(".drag-label")).toBeNull();
  expect(drop.onDrop("session", point(20))).toBe(true);
  expect(pin).toHaveBeenCalledOnce();
});

it("requires the header when dragging an ordinary conversation out of a pinned project", () => {
  section.querySelector("[data-project-children]")!.append(source);
  const pin = vi.fn();
  const drop = sidebarPinDrop(source, "Pin", pin)!;
  expect(drop.onMove("session", point(100))).toBe(false);
  expect(drop.onDrop("session", point(100))).toBe(false);
  expect(drop.onDrop("session", point(20))).toBe(true);
  expect(pin).toHaveBeenCalledOnce();
});

it("ignores hidden sidebars and removed drop targets", () => {
  const pin = vi.fn();
  const drop = sidebarPinDrop(source, "Pin", pin)!;
  root.setAttribute("inert", "");
  expect(drop.onMove("session", point(20))).toBe(false);
  root.removeAttribute("inert");
  section.remove();
  expect(drop.onDrop("session", point(20))).toBe(false);
  expect(pin).not.toHaveBeenCalled();
});

it("clears every previous target when switching between pin, group and pane drops", () => {
  const pin = {
    onMove: vi.fn(() => true),
    onDrop: vi.fn(() => true),
    onEnd: vi.fn(),
  };
  const pane = {
    onMove: vi.fn(() => false),
    onDrop: vi.fn(() => true),
    onEnd: vi.fn(),
  };
  const drop = combineSidebarDrops(pin, undefined, pane)!;
  expect(drop.onMove("item", point(20))).toBe(true);
  expect(pane.onMove).toHaveBeenCalledOnce();
  pin.onMove.mockReturnValue(false);
  pane.onMove.mockReturnValue(true);
  drop.onMove("item", point(200));
  expect(pin.onMove).toHaveBeenCalledTimes(2);
  expect(drop.onDrop("item", point(20))).toBe(true);
  expect(pane.onDrop).not.toHaveBeenCalled();
  drop.onEnd?.("item");
  expect(pin.onEnd).toHaveBeenCalledOnce();
  expect(pane.onEnd).toHaveBeenCalledOnce();
});
