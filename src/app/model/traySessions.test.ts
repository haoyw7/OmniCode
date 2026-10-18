import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import type { HostSessionSummary } from "../../features/connections/model/protocol";
import { traySessions } from "./traySessions";

function row(
  id: string,
  activityAt: number,
  extra: Partial<HostSessionSummary> = {},
): HostSessionSummary {
  return {
    id,
    projectId: "p1",
    title: id,
    harness: "codex",
    status: "idle",
    revision: 1,
    updatedAt: activityAt,
    activityAt,
    ...extra,
  } as HostSessionSummary;
}

const projects = (id: string) => (id === "p1" ? "/repo" : undefined);

describe("traySessions", () => {
  it("lists the conversations the sidebar would show, newest first", () => {
    const listed = traySessions(
      [
        row("old", 1),
        row("new", 3, { status: "running" }),
        row("archived", 9, { archived: true }),
        row("draft", 9, { draft: true }),
        row("worker", 9, { orchestrationLeadId: "new" }),
        row("assistant", 9, { assistantOwnerId: "a" }),
        row("waiting", 2, { needsInput: true, pinned: true }),
      ],
      new Set(["old"]),
      projects,
    );
    expect(listed).toEqual([
      { id: "new", project: "/repo", title: "new", busy: true, unread: false, pinned: false, activityAt: 3 },
      { id: "waiting", project: "/repo", title: "waiting", busy: false, unread: true, pinned: true, activityAt: 2 },
      { id: "old", project: "/repo", title: "old", busy: false, unread: true, pinned: false, activityAt: 1 },
    ]);
  });

  it("keeps old unread and pinned rows past the recent cut-off", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`r${i}`, 100 - i));
    rows.push(row("pinned", 0, { pinned: true }), row("unread", -1));
    const listed = traySessions(rows, new Set(["unread"]), projects);
    expect(listed).toHaveLength(17);
    expect(listed.slice(-2).map((session) => session.id)).toEqual(["pinned", "unread"]);
  });

  it("falls back to the session folder for projects this window has not opened", () => {
    const [listed] = traySessions(
      [row("elsewhere", 1, { projectId: "p2", cwd: "/other" })],
      new Set(),
      projects,
    );
    expect(listed.project).toBe("/other");
  });
});
