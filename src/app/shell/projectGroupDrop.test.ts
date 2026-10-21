// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDropTarget } from "../../shared/ui/primitives/Sortable";
import { useProjectGroupDrop } from "./projectGroupDrop";
import { loadProjectGroupAssignments, loadProjectGroups, saveProjectGroups, setProjectGroupAssignment } from "../../features/projects/model/projectGroups";
import { loadPinnedProjects, savePinnedProjects } from "../../features/projects/model/recents";
vi.mock("../../shared/ui/primitives/Sortable", () => ({ useDropTarget: vi.fn(() => ({ ref: () => {}, isOver: false })) }));
const path = "/work/project";
const payload = { type: "sidebar-project", path, groupId: "source" };
const options = () => { useProjectGroupDrop("target"); return vi.mocked(useDropTarget).mock.lastCall![0]; };
beforeEach(() => {
  localStorage.clear();
  saveProjectGroups([{ id: "source", name: "Source", collapsed: false }, { id: "target", name: "Target", collapsed: true }]);
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
it("persists membership on drop and expands the destination while preserving other entries", () => {
  setProjectGroupAssignment(path, "source");
  setProjectGroupAssignment("/work/other", "source");
  savePinnedProjects([path, "/work/other"]);
  const drop = options();
  expect(drop.accepts(payload)).toBe(true);
  expect(loadProjectGroupAssignments()[path]).toBe("source");
  drop.onDrop(payload);
  expect(loadProjectGroupAssignments()).toEqual({ [path]: "target", "/work/other": "source" });
  expect(loadPinnedProjects()).toEqual(["/work/other"]);
  expect(loadProjectGroups().find(group => group.id === "target")?.collapsed).toBe(false);
});
it("rejects its own group and other payloads and ignores a destination removed during the drag", () => {
  const drop = options();
  expect(drop.accepts({ ...payload, groupId: "target" })).toBe(false);
  expect(drop.accepts({ type: "sidebar-session", path })).toBe(false);
  saveProjectGroups([]);
  drop.onDrop(payload);
  expect(loadProjectGroupAssignments()).toEqual({});
});
it("keeps pins and expansion unchanged when assignment cannot be saved", () => {
  savePinnedProjects([path]);
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  options().onDrop(payload);
  expect(loadProjectGroupAssignments()).toEqual({});
  expect(loadPinnedProjects()).toEqual([path]);
  expect(loadProjectGroups().find(group => group.id === "target")?.collapsed).toBe(true);
});
