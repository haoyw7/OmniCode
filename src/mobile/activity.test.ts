// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import {
  MobileActivity,
  loadMobileActivity,
  saveMobileActivity,
} from "./activity";

function session(
  overrides: Partial<HostSessionSummary> = {},
): HostSessionSummary {
  return {
    id: "one",
    projectId: "project",
    title: "Conversation",
    harness: "codex",
    status: "idle",
    revision: 10,
    updatedAt: 100,
    lastReplyRevision: 8,
    lastCompletedRunId: "old",
    ...overrides,
  };
}
beforeEach(() => localStorage.clear());
describe("mobile unread reply cursors", () => {
  it("persists an explicit unread mark without replaying notifications and clears it on read", () => {
    const activity = new MobileActivity();
    activity.observe([session()]);
    activity.markUnread("one", 10);
    expect(activity.unreadIds()).toEqual(["one"]);
    saveMobileActivity("manual-host", activity);
    const restored = loadMobileActivity("manual-host");
    expect(restored.manualUnreadIds()).toEqual(["one"]);
    expect(restored.observe([session({ revision: 11, pinned: true })])).toEqual([]);
    expect(restored.unreadIds()).toEqual(["one"]);
    restored.markRead("one", 11);
    expect(restored.unreadIds()).toEqual([]);
  });
  it("removes manual unread marks for archived and deleted conversations", () => {
    const activity = new MobileActivity();
    activity.observe([session()]);
    activity.markUnread("one", 10);
    activity.observe([session({ archived: true, revision: 11 })]);
    expect(activity.manualUnreadIds()).toEqual([]);
    activity.markUnread("one", 11);
    activity.observe([]);
    expect(activity.manualUnreadIds()).toEqual([]);
  });
  it("acknowledges completion/input identities from a rendered snapshot before a later background poll", () => {
    const activity = new MobileActivity();
    activity.observe([session()]);
    activity.markRead("one", 20, {
      finished: "seen-completion",
      input: "question:seen",
    });
    expect(
      activity.observe([
        session({
          revision: 19,
          lastReplyRevision: 19,
          lastCompletedRunId: "stale",
        }),
      ]),
    ).toEqual([]);
    expect(
      activity.observe([
        session({
          revision: 21,
          lastReplyRevision: 21,
          status: "running",
          lastCompletedRunId: "seen-completion",
          pendingInputKey: "question:seen",
        }),
      ]),
    ).toEqual([]);
    expect(activity.unreadIds()).toEqual(["one"]);
    expect(
      activity.observe([
        session({
          revision: 22,
          lastReplyRevision: 22,
          lastCompletedRunId: "unseen-completion",
        }),
      ]),
    ).toHaveLength(1);
  });
  it("ignores an older archived snapshot without overwriting a delivered completion cursor", () => {
    const activity = new MobileActivity();
    activity.observe([session()]);
    const completed = session({ revision: 20, lastReplyRevision: 20, lastCompletedRunId: "new" });
    expect(activity.observe([completed])).toHaveLength(1);
    expect(activity.observe([session({ revision: 11, archived: true })])).toEqual([]);
    expect(activity.observe([{ ...completed, revision: 21, lastReplyRevision: 21, status: "running" }])).toEqual([]);
    expect(activity.unreadIds()).toEqual(["one"]);
  });
  it("baselines old history and ignores user sends, title changes and other revisions without a new reply", () => {
    const activity = new MobileActivity();
    expect(activity.observe([session()])).toEqual([]);
    expect(activity.unreadIds()).toEqual([]);
    activity.observe([
      session({ revision: 11, title: "Renamed", status: "running" }),
    ]);
    expect(activity.unreadIds()).toEqual([]);
  });
  it("marks streaming replies unread and delivers one notification when the turn completes, even if a queued turn is already running", () => {
    const activity = new MobileActivity();
    activity.observe([session()]);
    expect(
      activity.observe([
        session({ revision: 11, lastReplyRevision: 11, status: "running" }),
      ]),
    ).toEqual([]);
    expect(activity.unreadIds()).toEqual(["one"]);
    const completed = session({
      revision: 13,
      lastReplyRevision: 12,
      lastCompletedRunId: "new",
      status: "running",
      runId: "next-queued-turn",
    });
    expect(activity.observe([completed]).map((notice) => notice.kind)).toEqual([
      "reply",
    ]);
    expect(activity.observe([completed])).toEqual([]);
  });
  it("suppresses banners for the viewed conversation and clears unread only after an explicit read cursor", () => {
    const activity = new MobileActivity();
    activity.observe([session()]);
    activity.observe(
      [
        session({
          revision: 12,
          lastReplyRevision: 12,
          lastCompletedRunId: "new",
        }),
      ],
      "one",
    );
    expect(activity.unreadIds()).toEqual(["one"]);
    activity.markRead("one", 12);
    expect(activity.unreadIds()).toEqual([]);
    expect(
      activity.observe([
        session({
          revision: 12,
          lastReplyRevision: 12,
          lastCompletedRunId: "new",
        }),
      ]),
    ).toEqual([]);
  });
  it("notifies a new input request once and does not replay the preceding completion when the request resolves", () => {
    const activity = new MobileActivity();
    activity.observe([session()]);
    const pending = session({
      revision: 12,
      lastReplyRevision: 12,
      pendingInputKey: "question:1",
    });
    expect(activity.observe([pending]).map((notice) => notice.kind)).toEqual([
      "input",
    ]);
    expect(activity.observe([{ ...pending, revision: 13 }])).toEqual([]);
    expect(
      activity.observe([{ ...pending, revision: 14, pendingInputKey: null }]),
    ).toEqual([]);
    expect(
      activity.observe([
        {
          ...pending,
          revision: 15,
          lastReplyRevision: 15,
          pendingInputKey: "question:2",
        },
      ]),
    ).toHaveLength(1);
  });
  it("preserves unread and notification deduplication across restart and separates Host identities", () => {
    const activity = new MobileActivity();
    activity.observe([session()]);
    const completed = session({
      revision: 12,
      lastReplyRevision: 12,
      lastCompletedRunId: "new",
    });
    activity.observe([completed]);
    saveMobileActivity("host-one", activity);
    const restored = loadMobileActivity("host-one");
    expect(restored.unreadIds()).toEqual(["one"]);
    expect(restored.observe([completed])).toEqual([]);
    expect(loadMobileActivity("host-two").unreadIds()).toEqual([]);
    restored.markRead("one", 12);
    saveMobileActivity("host-one", restored);
    expect(loadMobileActivity("host-one").unreadIds()).toEqual([]);
  });
  it("handles new sessions, deletion, archives, unarchiving and stale polls without replaying old messages", () => {
    const activity = new MobileActivity();
    activity.observe([session()]);
    const newSession = session({ id: "two", lastCompletedRunId: "two-first" });
    expect(activity.observe([session(), newSession])).toHaveLength(1);
    activity.markRead("two", 10);
    expect(
      activity.observe([
        session(),
        { ...newSession, revision: 9, lastCompletedRunId: "stale" },
      ]),
    ).toEqual([]);
    expect(
      activity.observe([
        session(),
        {
          ...newSession,
          archived: true,
          revision: 12,
          lastReplyRevision: 12,
          lastCompletedRunId: "two-second",
        },
      ]),
    ).toEqual([]);
    expect(
      activity.observe([
        session(),
        {
          ...newSession,
          revision: 12,
          lastReplyRevision: 12,
          lastCompletedRunId: "two-second",
        },
      ]),
    ).toEqual([]);
    activity.observe([session()]);
    expect(activity.state.entries.two).toBeUndefined();
  });
  it("survives corrupt or unavailable storage and conversations without new protocol fields", () => {
    localStorage.setItem("monocode.mobileActivity:host", "invalid");
    const activity = loadMobileActivity("host");
    expect(
      activity.observe([
        session({
          lastReplyRevision: undefined,
          lastCompletedRunId: undefined,
        }),
      ]),
    ).toEqual([]);
    expect(activity.unreadIds()).toEqual([]);
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Quota");
      });
    expect(() => saveMobileActivity("host", activity)).not.toThrow();
    write.mockRestore();
  });
});
