// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearProjectTreeExpanded,
  loadProjectTreeExpanded,
  rebaseProjectTreeExpanded,
  saveProjectTreeExpanded,
  subscribeProjectTreeExpanded,
} from "./projectTree";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("opens only the current project on first use and preserves an explicitly collapsed tree", () => {
  expect([...loadProjectTreeExpanded("/work/app/")]).toEqual(["/work/app"]);
  expect([...loadProjectTreeExpanded("~")]).toEqual([]);
  saveProjectTreeExpanded([]);
  expect([...loadProjectTreeExpanded("/work/app")]).toEqual([]);
});

it("round-trips multiple normalized paths and ignores invalid saved entries", () => {
  saveProjectTreeExpanded([
    "/work/a/",
    "C:\\Work\\App",
    "c:/work/app/",
    "/work/b",
  ]);
  expect([...loadProjectTreeExpanded("/other")]).toEqual([
    "/work/a",
    "c:/work/app",
    "/work/b",
  ]);
  localStorage.setItem(
    "monocode.projectTreeExpanded.v1",
    '[null, false, "/work/a/", ""]',
  );
  expect([...loadProjectTreeExpanded("/other")]).toEqual(["/work/a"]);
});

it("falls back to the current project for unreadable storage without throwing", () => {
  localStorage.setItem("monocode.projectTreeExpanded.v1", "broken");
  expect([...loadProjectTreeExpanded("/work/a")]).toEqual(["/work/a"]);
  vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => saveProjectTreeExpanded(["/work/b"])).not.toThrow();
  expect([...loadProjectTreeExpanded("/work/a")]).toEqual(["/work/a"]);
});

it("moves renamed project expansion and clears only removed projects", () => {
  saveProjectTreeExpanded(["/work/a", "/work/b"]);
  rebaseProjectTreeExpanded("/work/a/", "/work/renamed/");
  expect([...loadProjectTreeExpanded("/other")]).toEqual([
    "/work/b",
    "/work/renamed",
  ]);
  clearProjectTreeExpanded("/work/renamed/");
  expect([...loadProjectTreeExpanded("/other")]).toEqual(["/work/b"]);
});

it("does not initialize tree preferences when a project is removed before first use", () => {
  clearProjectTreeExpanded("/work/a");
  rebaseProjectTreeExpanded("/work/a", "/work/b");
  expect([...loadProjectTreeExpanded("/current")]).toEqual(["/current"]);
});

it("notifies mounted trees about same-window and other-window preference changes", () => {
  const onChange = vi.fn();
  const unsubscribe = subscribeProjectTreeExpanded(onChange);
  saveProjectTreeExpanded(["/work/a"]);
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
  expect(onChange).toHaveBeenCalledOnce();
  window.dispatchEvent(
    new StorageEvent("storage", { key: "monocode.projectTreeExpanded.v1" }),
  );
  expect(onChange).toHaveBeenCalledTimes(2);
  unsubscribe();
  saveProjectTreeExpanded([]);
  expect(onChange).toHaveBeenCalledTimes(2);
});
