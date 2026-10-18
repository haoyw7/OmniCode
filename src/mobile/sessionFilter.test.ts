import { describe, expect, it } from "vitest";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import { filterMobileSessions } from "./sessionFilter";

const row = (id: string, extra: Partial<HostSessionSummary> = {}): HostSessionSummary => ({
  id,
  title: id,
  projectId: "project",
  revision: 1,
  status: "idle",
  harness: "codex",
  updatedAt: 1,
  ...extra,
});

const sessions = [
  row("running", { status: "running", updatedAt: 5 }),
  row("asking", { needsInput: true, updatedAt: 4 }),
  row("done", { lastCompletedRunId: "run", updatedAt: 3 }),
  row("fresh", { updatedAt: 2 }),
  row("stored", { archived: true, lastCompletedRunId: "run", updatedAt: 6 }),
];
const ids = (filter: Parameters<typeof filterMobileSessions>[1]) =>
  filterMobileSessions(sessions, filter).map((session) => session.id);

describe("filterMobileSessions", () => {
  it("keeps archived rows out of every status filter", () => {
    expect(ids("all")).toEqual(["running", "asking", "done", "fresh"]);
    expect(ids("working")).toEqual(["running"]);
    expect(ids("needsInput")).toEqual(["asking"]);
    expect(ids("completed")).toEqual(["done"]);
    expect(ids("archived")).toEqual(["stored"]);
  });
});
