import { expect, it } from "vitest";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import { NativeActivitySync } from "./nativeActivitySync";

function session(id: string, revision: number): HostSessionSummary {
  return {
    id,
    projectId: "project",
    title: `Conversation ${id}`,
    harness: "codex",
    revision,
    status: "idle",
    updatedAt: 1,
    lastCompletedRunId: null,
    pendingInputKey: null,
    nativeSession: { large: "x".repeat(1000) },
    cwd: "/app",
  } as unknown as HostSessionSummary;
}

it("sends the full list first, then only changed and removed conversations", () => {
  const sync = new NativeActivitySync();
  const first = sync.plan("host", [session("a", 1), session("b", 1)]);
  expect(first.update.full).toBe(true);
  // Only what the tracker reads crosses the bridge.
  expect(first.update.sessions[0]).not.toHaveProperty("nativeSession");
  expect(first.update.sessions[0]).not.toHaveProperty("cwd");
  expect(first.update.sessions[0]).toMatchObject({ id: "a", revision: 1, title: "Conversation a" });
  first.commit();

  const next = sync.plan("host", [session("a", 2), session("c", 1)]);
  expect(next.update).toEqual({
    full: false,
    sessions: [expect.objectContaining({ id: "a", revision: 2 }), expect.objectContaining({ id: "c" })],
    removed: ["b"],
  });
  next.commit();
  expect(sync.plan("host", [session("a", 2), session("c", 1)]).update).toEqual({
    full: false, sessions: [], removed: [],
  });
});

it("resends everything when a call was not accepted or the Host changed", () => {
  const sync = new NativeActivitySync();
  sync.plan("host", [session("a", 1)]).commit();
  // An uncommitted plan leaves the last accepted snapshot in place.
  sync.plan("host", [session("a", 2)]);
  expect(sync.plan("host", [session("a", 2)]).update.sessions).toHaveLength(1);
  expect(sync.plan("other", [session("a", 1)]).update.full).toBe(true);
  sync.reset();
  expect(sync.plan("host", [session("a", 1)]).update.full).toBe(true);
});
