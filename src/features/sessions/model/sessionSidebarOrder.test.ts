// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  buildSessionList,
  loadSessionSidebarOrder,
  rebaseSessionFolderSettings,
  saveSessionSidebarOrder,
  sessionSidebarOrder,
  subscribeSessionSidebarOrder,
} from "./sessionFolders";
import { mergeOrderedSubset } from "../../../shared/lib/reorder";
import type { SessionSummary } from "../data/sessionStore";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("keeps unloaded saved slots and puts new conversations first", () => {
  const full = sessionSidebarOrder(
    ["new", "a", "c"],
    ["a", "unloaded", "b", "c"],
  );
  expect(full).toEqual(["new", "a", "unloaded", "b", "c"]);
  expect(
    mergeOrderedSubset(
      full.map((id) => ({ id })),
      [{ id: "c" }, { id: "a" }],
    ).map(({ id }) => id),
  ).toEqual(["new", "c", "unloaded", "b", "a"]);
});

it("persists project-scoped ordering and moves it when the project is renamed", () => {
  saveSessionSidebarOrder("/work/a/", ["b", "a"]);
  saveSessionSidebarOrder("/work/b", ["a", "b"]);
  expect(loadSessionSidebarOrder("/work/a")).toEqual(["b", "a"]);
  rebaseSessionFolderSettings("/work/a", "/work/renamed");
  expect(loadSessionSidebarOrder("/work/renamed")).toEqual(["b", "a"]);
  expect(loadSessionSidebarOrder("/work/a")).toEqual([]);
  expect(loadSessionSidebarOrder("/work/b")).toEqual(["a", "b"]);
});

it("synchronizes the affected project and storage changes with detachable listeners", () => {
  const changed = vi.fn();
  const unsubscribe = subscribeSessionSidebarOrder("/work/a", changed);
  saveSessionSidebarOrder("/work/b", ["a"]);
  expect(changed).not.toHaveBeenCalled();
  saveSessionSidebarOrder("/work/a", ["a"]);
  expect(changed).toHaveBeenCalledTimes(1);
  window.dispatchEvent(
    new StorageEvent("storage", { key: "monocode.sessionSidebarOrder.v1" }),
  );
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribe();
  saveSessionSidebarOrder("/work/a", ["b", "a"]);
  expect(changed).toHaveBeenCalledTimes(2);
});

it("ignores malformed order data and tolerates unavailable storage", () => {
  localStorage.setItem(
    "monocode.sessionSidebarOrder.v1",
    JSON.stringify({ "/work/a": ["a", 42, "a", "b"] }),
  );
  expect(loadSessionSidebarOrder("/work/a")).toEqual(["a", "b"]);
  localStorage.setItem("monocode.sessionSidebarOrder.v1", "invalid");
  expect(loadSessionSidebarOrder("/work/a")).toEqual([]);
  saveSessionSidebarOrder("/work/a", ["a"]);
  expect(loadSessionSidebarOrder("/work/a")).toEqual(["a"]);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  expect(() => saveSessionSidebarOrder("/work/a", ["a"])).not.toThrow();
});

it("keeps flat project rows in manual order across pinned and regular sessions", () => {
  const regular = { id: "regular" } as SessionSummary;
  const pinned = { id: "pinned", pinned: true } as SessionSummary;
  const sessions = [regular, pinned];
  expect(
    buildSessionList(sessions, [], sessions, false, undefined, true),
  ).toEqual([
    { kind: "session", session: regular },
    { kind: "session", session: pinned },
  ]);
});
