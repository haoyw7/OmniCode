import { describe, expect, it } from "vitest";
import type { HostSessionSummary } from "../../connections/model/protocol";
import { RemoteSessionUnread } from "./remoteSessionUnread";

const row = (
  overrides: Partial<HostSessionSummary> = {},
): HostSessionSummary => ({
  id: "chat",
  projectId: "project",
  title: "Chat",
  harness: "codex",
  status: "idle",
  revision: 5,
  lastReplyRevision: 4,
  updatedAt: 100,
  ...overrides,
});

describe("Host session unread replies", () => {
  it("baselines history and ignores metadata-only updates", () => {
    const tracker = new RemoteSessionUnread();
    expect(tracker.observe([row()])).toEqual(new Set());
    expect(
      tracker.observe([row({ revision: 6, title: "Renamed", pinned: true })]),
    ).toEqual(new Set());
  });

  it("marks streaming replies and retains them through a queued turn until focused", () => {
    const tracker = new RemoteSessionUnread();
    tracker.observe([row({ status: "running" })]);
    const reply = row({ status: "running", revision: 7, lastReplyRevision: 7 });
    expect(tracker.observe([reply])).toEqual(new Set(["chat"]));
    const queued = { ...reply, revision: 9, lastCompletedRunId: "turn-1" };
    expect(tracker.observe([queued])).toEqual(new Set(["chat"]));
    expect(tracker.observe([queued], "chat")).toEqual(new Set());
    expect(tracker.observe([queued])).toEqual(new Set());
    expect(
      tracker.observe([{ ...queued, revision: 10, lastReplyRevision: 10 }]),
    ).toEqual(new Set(["chat"]));
  });

  it("detects replies even when polling misses the entire running state", () => {
    const tracker = new RemoteSessionUnread();
    tracker.observe([row()]);
    expect(
      tracker.observe([row({ revision: 12, lastReplyRevision: 11 })]),
    ).toEqual(new Set(["chat"]));
  });

  it("does not re-mark read replies on stale or repeated snapshots", () => {
    const tracker = new RemoteSessionUnread();
    tracker.observe([row()]);
    const latest = row({ revision: 12, lastReplyRevision: 11 });
    tracker.observe([latest], "chat");
    expect(tracker.observe([row()])).toEqual(new Set());
    expect(tracker.observe([latest])).toEqual(new Set());
  });

  it("supports older Hosts via completion transitions and completion identities", () => {
    const tracker = new RemoteSessionUnread();
    const running = row({
      revision: undefined,
      lastReplyRevision: undefined,
      status: "running",
    });
    tracker.observe([running]);
    expect(tracker.observe([{ ...running, status: "idle" }])).toEqual(
      new Set(["chat"]),
    );
    tracker.observe([running], "chat");
    expect(
      tracker.observe([{ ...running, lastCompletedRunId: "queued-turn" }]),
    ).toEqual(new Set(["chat"]));
  });

  it("ignores archived and managed child sessions and removes deleted rows", () => {
    const tracker = new RemoteSessionUnread();
    tracker.observe([]);
    expect(
      tracker.observe([
        row(),
        row({ id: "archived", archived: true }),
        row({ id: "worker", orchestrationLeadId: "lead" }),
        row({ id: "workflow", workflowParentId: "workflow" }),
        row({ id: "assistant", assistantOwnerId: "assistant" }),
      ]),
    ).toEqual(new Set(["chat"]));
    expect(tracker.observe([])).toEqual(new Set());
  });
});
