// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { SessionCompletionOrder, type SessionCompletionRow } from "./sessionCompletionOrder";
import { loadSessionSidebarOrder, saveSessionSidebarOrder } from "../../features/sessions/model/sessionFolders";
import { loadSidebarChatOrder, saveSidebarChatOrder } from "./sidebarChatOrder";
import { loadSidebarPinnedOrder, saveSidebarPinnedOrder } from "./sidebarPinnedOrder";

afterEach(() => localStorage.clear());
const row = (id: string, extra: Partial<SessionCompletionRow> = {}): SessionCompletionRow => ({
  id, cwd: "/work", updatedAt: 100, activityAt: 100, running: false, ...extra,
});

it("moves a finished reply ahead of manual slots while keeping other and unloaded rows in order", () => {
  saveSessionSidebarOrder("/work", ["a", "unloaded", "b", "c"]);
  const tracker = new SessionCompletionOrder();
  const rows = [row("a"), row("b"), row("c", { running: true })];
  tracker.observe(rows);
  tracker.observe([rows[0], rows[1], row("c", { running: true, activityAt: 150 })]);
  expect(loadSessionSidebarOrder("/work")).toEqual(["a", "unloaded", "b", "c"]);
  const finished = [rows[0], rows[1], row("c", { activityAt: 200 })];
  tracker.observe(finished);
  expect(loadSessionSidebarOrder("/work")).toEqual(["c", "a", "unloaded", "b"]);
  saveSessionSidebarOrder("/work", ["b", "c", "a", "unloaded"]);
  tracker.observe(finished);
  expect(loadSessionSidebarOrder("/work")).toEqual(["b", "c", "a", "unloaded"]);
});

it("does not promote initial history, input waits or metadata-only refreshes", () => {
  saveSessionSidebarOrder("/work", ["a", "b"]);
  const tracker = new SessionCompletionOrder();
  tracker.observe([row("a"), row("b", { running: true })]);
  tracker.observe([row("a"), row("b", { needsInput: true })]);
  tracker.observe([row("a"), row("b", { updatedAt: 500 })]);
  expect(loadSessionSidebarOrder("/work")).toEqual(["a", "b"]);
  tracker.observe([row("a"), row("b", { activityAt: 600 })]);
  expect(loadSessionSidebarOrder("/work")).toEqual(["b", "a"]);
});

it("handles a queued Host reply while the next turn runs and ignores stale revisions or another Host", () => {
  saveSessionSidebarOrder("/work", ["a", "b"]);
  const tracker = new SessionCompletionOrder();
  const host = { source: "host", running: true, revision: 2 };
  tracker.observe([row("a"), row("b", host)]);
  const finished = row("b", { ...host, revision: 3, completedRunId: "reply-1" });
  tracker.observe([row("a"), finished]);
  expect(loadSessionSidebarOrder("/work")).toEqual(["b", "a"]);
  saveSessionSidebarOrder("/work", ["a", "b"]);
  tracker.observe([row("a"), row("b", { ...host, revision: 1, completedRunId: "old" })]);
  tracker.observe([row("a"), finished]);
  tracker.observe([row("a"), { ...finished, source: "another-host", completedRunId: "other" }]);
  expect(loadSessionSidebarOrder("/work")).toEqual(["a", "b"]);
});

it("scopes colliding Host conversation ids to their project", () => {
  saveSessionSidebarOrder("/work", ["a", "same"]);
  saveSessionSidebarOrder("/other", ["b", "same"]);
  const tracker = new SessionCompletionOrder();
  const rows = [row("a"), row("same"), row("b", { cwd: "/other" }), row("same", { cwd: "/other", running: true })];
  tracker.observe(rows);
  tracker.observe([...rows.slice(0, 3), row("same", { cwd: "/other" })]);
  expect(loadSessionSidebarOrder("/work")).toEqual(["a", "same"]);
  expect(loadSessionSidebarOrder("/other")).toEqual(["same", "b"]);
});

it("preserves Windows project spelling when promoting a completed Host reply", () => {
  const cwd = "D:/A-Projects/OmniCode";
  saveSessionSidebarOrder(cwd, ["a", "b"]);
  const tracker = new SessionCompletionOrder();
  const rows = [row("a", { cwd }), row("b", { cwd, source: "host", running: true })];
  tracker.observe(rows);
  tracker.observe([rows[0], { ...rows[1], running: false, completedRunId: "reply-1" }]);
  expect(loadSessionSidebarOrder(cwd)).toEqual(["b", "a"]);
});

it("promotes chats and pinned conversations within their own sidebar section", () => {
  const chatA = "chat:~:a", chatB = "chat:~:b";
  const pinA = 'session:["/work","a"]', pinB = 'session:["/work","b"]';
  saveSidebarChatOrder([chatA, chatB]);
  saveSidebarPinnedOrder(["/pinned-project", pinA, pinB, "/other-project"]);
  const tracker = new SessionCompletionOrder();
  const rows = [row("a", { cwd: "~" }), row("b", { cwd: "~", running: true }), row("a", { pinned: true }), row("b", { pinned: true, running: true })];
  tracker.observe(rows);
  tracker.observe(rows.map((entry) => ({ ...entry, running: false })));
  expect(loadSidebarChatOrder()).toEqual([chatB, chatA]);
  expect(loadSidebarPinnedOrder()).toEqual([pinB, "/pinned-project", pinA, "/other-project"]);
});

it("leaves automatic ordering automatic and excludes archived or internal conversations", () => {
  const tracker = new SessionCompletionOrder();
  tracker.observe([row("a", { running: true }), row("b", { running: true, archived: true })]);
  tracker.observe([row("a"), row("b", { archived: true })]);
  expect(loadSessionSidebarOrder("/work")).toEqual([]);
  saveSessionSidebarOrder("/work", ["a", "b"]);
  tracker.observe([row("a"), row("b", { orchestrationLeadId: "lead", running: true })]);
  tracker.observe([row("a"), row("b", { orchestrationLeadId: "lead" })]);
  expect(loadSessionSidebarOrder("/work")).toEqual(["a", "b"]);
});
