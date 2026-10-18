// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { projectGroupDrop } from "./projectGroupDrop";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  saveProjectGroups,
  setProjectGroupAssignment,
} from "../../features/projects/model/projectGroups";
import {
  loadPinnedProjects,
  savePinnedProjects,
} from "../../features/projects/model/recents";

let root: HTMLElement;
let source: HTMLElement;
let target: HTMLElement;
const path = "/work/project";
const point = (x = 100, y = 60) =>
  new PointerEvent("pointermove", { clientX: x, clientY: y });

beforeEach(() => {
  localStorage.clear();
  saveProjectGroups([
    { id: "source", name: "Source", collapsed: false },
    { id: "target", name: "Target", collapsed: true },
  ]);
  root = document.createElement("div");
  root.dataset.projectList = "tree";
  root.innerHTML =
    '<div data-project-group="source"><div data-project-group-header="source"></div><div data-project-header></div></div><div data-project-group="target"><div data-project-group-header="target"></div></div>';
  document.body.append(root);
  source = root.querySelector("[data-project-header]")!;
  target = root.querySelector('[data-project-group-header="target"]')!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 300, 200),
  );
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
    new DOMRect(10, 40, 280, 32),
  );
  vi.spyOn(
    root.querySelector<HTMLElement>('[data-project-group-header="source"]')!,
    "getBoundingClientRect",
  ).mockReturnValue(new DOMRect(10, 0, 280, 32));
});

afterEach(() => {
  root.remove();
  document.querySelectorAll(".drag-label").forEach((node) => node.remove());
  localStorage.clear();
  vi.restoreAllMocks();
});

it("highlights without moving on hover, then persists membership and expands the destination", () => {
  setProjectGroupAssignment(path, "source");
  setProjectGroupAssignment("/work/other", "source");
  const drop = projectGroupDrop(source, "Move to group")!;
  expect(drop.onMove(path, point())).toBe(true);
  expect(target.dataset.projectGroupDropTarget).toBe("true");
  expect(document.querySelector(".drag-label")?.textContent).toBe(
    "Move to group",
  );
  expect(loadProjectGroupAssignments()[path]).toBe("source");
  expect(drop.onDrop(path, point())).toBe(true);
  drop.onEnd?.(path);
  expect(loadProjectGroupAssignments()).toEqual({
    [path]: "target",
    "/work/other": "source",
  });
  expect(
    loadProjectGroups().find((group) => group.id === "target")?.collapsed,
  ).toBe(false);
  expect(target.dataset.projectGroupDropTarget).toBeUndefined();
  expect(document.querySelector(".drag-label")).toBeNull();
});

it("clears feedback on leaving or cancellation without changing membership", () => {
  const drop = projectGroupDrop(source, "Move to group")!;
  drop.onMove(path, point());
  expect(drop.onMove(path, point(400, 60))).toBe(false);
  expect(target.dataset.projectGroupDropTarget).toBeUndefined();
  drop.onMove(path, point());
  drop.onEnd?.(path);
  expect(loadProjectGroupAssignments()).toEqual({});
  expect(document.querySelector(".drag-label")).toBeNull();
  expect(drop.onDrop(path, point(400, 60))).toBe(false);
});

it("ignores the source group, hidden sections, clipped headers and removed groups", () => {
  const drop = projectGroupDrop(source, "Move to group")!;
  expect(drop.onMove(path, point(100, 16))).toBe(false);
  target.parentElement!.setAttribute("inert", "");
  expect(drop.onMove(path, point())).toBe(false);
  expect(drop.onDrop(path, point())).toBe(false);
  target.parentElement!.removeAttribute("inert");
  vi.mocked(target.getBoundingClientRect).mockReturnValue(
    new DOMRect(10, 220, 280, 32),
  );
  expect(drop.onMove(path, point(100, 230))).toBe(false);
  vi.mocked(target.getBoundingClientRect).mockReturnValue(
    new DOMRect(10, 40, 280, 32),
  );
  drop.onMove(path, point());
  saveProjectGroups([]);
  expect(drop.onDrop(path, point())).toBe(false);
  drop.onEnd?.(path);
  expect(loadProjectGroupAssignments()).toEqual({});
});

it("moves a pinned project into the destination while preserving other pins", () => {
  savePinnedProjects([path, "/work/other"]);
  const drop = projectGroupDrop(source, "Move to group")!;
  drop.onDrop(path, point());
  expect(loadProjectGroupAssignments()[path]).toBe("target");
  expect(loadPinnedProjects()).toEqual(["/work/other"]);
});

it("keeps pins and group expansion unchanged when assignment cannot be saved", () => {
  savePinnedProjects([path]);
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("Storage full");
  });
  const drop = projectGroupDrop(source, "Move to group")!;
  expect(drop.onDrop(path, point())).toBe(true);
  expect(loadProjectGroupAssignments()).toEqual({});
  expect(loadPinnedProjects()).toEqual([path]);
  expect(
    loadProjectGroups().find((group) => group.id === "target")?.collapsed,
  ).toBe(true);
});
