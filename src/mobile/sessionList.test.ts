import { describe, expect, it } from "vitest";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import { sortMobileSessions } from "./sessionList";

function session(
  id: string,
  overrides: Partial<HostSessionSummary> = {},
): HostSessionSummary {
  return {
    id,
    title: id,
    harness: "codex",
    projectId: "project",
    revision: 1,
    status: "running",
    updatedAt: 100,
    ...overrides,
  };
}
const ids = (sessions: readonly HostSessionSummary[]) =>
  sortMobileSessions(sessions).map((item) => item.id);

describe("mobile conversation ordering", () => {
  it("keeps concurrent conversations ordered by the last user send across output updates", () => {
    const older = session("older", { lastUserMessageAt: 10, updatedAt: 300 });
    const newer = session("newer", { lastUserMessageAt: 20, updatedAt: 200 });
    const input = [older, newer];
    expect(ids(input)).toEqual(["newer", "older"]);
    expect(input).toEqual([older, newer]);
    expect(
      ids([
        { ...newer, updatedAt: 400 },
        { ...older, updatedAt: 500 },
      ]),
    ).toEqual(["newer", "older"]);
    expect(
      ids([newer, { ...older, lastUserMessageAt: 30, updatedAt: 600 }]),
    ).toEqual(["older", "newer"]);
  });

  it("compares completed reply times and running send times on one timeline", () => {
    const older = session("older", { lastUserMessageAt: 10, updatedAt: 400 });
    const newer = session("newer", { lastUserMessageAt: 20, updatedAt: 100 });
    const idle = session("idle", { status: "idle", updatedAt: 300 });
    const interrupted = session("interrupted", {
      status: "interrupted",
      updatedAt: 200,
    });
    for (const input of [
      [older, idle, interrupted, newer],
      [newer, interrupted, idle, older],
      [idle, older, newer, interrupted],
    ])
      expect(ids(input)).toEqual(["idle", "interrupted", "newer", "older"]);
  });

  it("ignores later tool output and metadata saves after the last AI reply", () => {
    const finished = session("finished", { status: "idle", updatedAt: 9_000, activityAt: 300 });
    const running = session("running", { updatedAt: 8_000, activityAt: 200 });
    const later = session("later", { status: "idle", updatedAt: 400, activityAt: 400 });
    expect(ids([finished, running, later])).toEqual(["later", "finished", "running"]);
    expect(ids([{ ...finished, updatedAt: 99_000 }, { ...running, updatedAt: 100_000 }, later]))
      .toEqual(["later", "finished", "running"]);
    expect(ids([{ ...finished, status: "running", activityAt: 500 }, running, later]))
      .toEqual(["finished", "later", "running"]);
  });

  it("preserves pin priority, orders running rows within each group and hides archived rows", () => {
    expect(
      ids([
        session("unpinned", { updatedAt: 1_000, lastUserMessageAt: 900 }),
        session("pinned-older", {
          pinned: true,
          updatedAt: 500,
          lastUserMessageAt: 10,
        }),
        session("pinned-newer", {
          pinned: true,
          updatedAt: 200,
          lastUserMessageAt: 20,
        }),
        session("archived", { archived: true, pinned: true, updatedAt: 2_000 }),
      ]),
    ).toEqual(["pinned-newer", "pinned-older", "unpinned"]);
  });

  it("keeps equal send times stable when provider updates change their activity order", () => {
    const a = session("a", { lastUserMessageAt: 10, updatedAt: 100 });
    const b = session("b", { lastUserMessageAt: 10, updatedAt: 200 });
    expect(ids([b, a])).toEqual(["a", "b"]);
    expect(
      ids([
        { ...b, updatedAt: 300 },
        { ...a, updatedAt: 400 },
      ]),
    ).toEqual(["a", "b"]);
  });

  it("retains update-time ordering for older Hosts and conversations without message timestamps", () => {
    expect(
      ids([
        session("older", { updatedAt: 100 }),
        session("newer", { updatedAt: 200, lastUserMessageAt: null }),
      ]),
    ).toEqual(["newer", "older"]);
    expect(
      ids([
        session("older", {
          status: "idle",
          updatedAt: 100,
          lastUserMessageAt: 500,
        }),
        session("newer", {
          status: "idle",
          updatedAt: 200,
          lastUserMessageAt: 10,
        }),
      ]),
    ).toEqual(["newer", "older"]);
  });
});
