// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_SIDEBAR_SECTION_ORDER,
  loadSidebarSectionOrder,
  reorderSidebarSections,
  saveSidebarSectionOrder,
  subscribeSidebarSectionOrder,
} from "./sidebarSectionOrder";

afterEach(() => localStorage.clear());

it("recovers defaults from corrupt storage and fills missing sections without duplicates", () => {
  const key = "omnicode.sidebarSectionOrder.v1";
  localStorage.setItem(key, "invalid");
  expect(loadSidebarSectionOrder()).toEqual(DEFAULT_SIDEBAR_SECTION_ORDER);
  localStorage.setItem(
    key,
    JSON.stringify(["projects", "remote-control", "unknown", null, "projects", "chats"]),
  );
  expect(loadSidebarSectionOrder()).toEqual([
    "projects",
    "chats",
    "pinned",
    "workflows",
    "groups",
  ]);
});

it("preserves hidden sections while saving a reordered visible subset", () => {
  const next = reorderSidebarSections(
    [...DEFAULT_SIDEBAR_SECTION_ORDER],
    ["projects", "workflows", "chats"],
  );
  expect(next).toEqual(["pinned", "projects", "workflows", "groups", "chats"]);
  saveSidebarSectionOrder(next);
  expect(loadSidebarSectionOrder()).toEqual(next);
});

it("notifies mounted sidebars of local and cross-window changes only once", () => {
  const notify = vi.fn();
  const stop = subscribeSidebarSectionOrder(notify);
  const next = [...DEFAULT_SIDEBAR_SECTION_ORDER].reverse();
  saveSidebarSectionOrder(next);
  saveSidebarSectionOrder(next);
  expect(notify).toHaveBeenCalledTimes(1);
  localStorage.removeItem("omnicode.sidebarSectionOrder.v1");
  window.dispatchEvent(
    new StorageEvent("storage", { key: "omnicode.sidebarSectionOrder.v1" }),
  );
  expect(notify).toHaveBeenCalledTimes(2);
  stop();
  saveSidebarSectionOrder(next);
  expect(notify).toHaveBeenCalledTimes(2);
});
