import { describe, expect, it } from "vitest";
import { projectHoverSummary } from "./projectHoverSummary";

const A = "/projects/alpha";
const B = "/projects/beta";
const row = (id: string, cwd = A) => ({ id, cwd });

describe("project hover summary", () => {
  it("counts the full deduplicated main history plus actual open blanks", () => {
    const result = projectHoverSummary({
      path: A,
      history: [
        row("main"),
        row("main"),
        row("other-project", B),
        { ...row("archived"), archived: true },
        { ...row("worker"), orchestrationLeadId: "main" },
        { ...row("inbox"), inboxAsk: {} },
        {
          ...row("lead"),
          orchestration: { tasks: [{ sessionId: "old-worker" }] },
        },
        row("old-worker"),
        ...Array.from({ length: 9 }, (_, index) => row(`history-${index}`)),
      ],
      openSessions: [
        row("main"),
        row("blank"),
        row("closed-blank"),
        row("worker"),
      ],
      openSessionIds: new Set(["main", "blank", "worker"]),
      unseenFinishedIds: new Set(["main", "history-8", "archived", "worker"]),
      loaded: true,
    });
    expect(result).toEqual({
      total: 12,
      unread: 2,
      opened: 2,
      historyState: "ready",
    });
  });

  it("does not treat retained background sessions as open or add closed blanks", () => {
    expect(
      projectHoverSummary({
        path: A,
        history: [row("closed-running")],
        openSessions: [
          row("closed-running"),
          row("closed-blank"),
          row("visible"),
        ],
        openSessionIds: new Set(["visible", "file-pane"]),
        loaded: true,
      }),
    ).toEqual({ total: 2, unread: 0, opened: 1, historyState: "ready" });
  });

  it("keeps archived tabs open without counting them as conversations or unread", () => {
    expect(
      projectHoverSummary({
        path: A,
        history: [{ ...row("archived"), archived: true }],
        openSessions: [row("archived")],
        openSessionIds: new Set(["archived"]),
        unseenFinishedIds: new Set(["archived"]),
        loaded: true,
      }),
    ).toMatchObject({ total: 0, unread: 0, opened: 1 });
  });

  it("distinguishes unknown, pending, successful empty and unavailable history", () => {
    const input = { path: A, history: [], loaded: false };
    expect(projectHoverSummary(input)).toMatchObject({
      total: undefined,
      historyState: "idle",
    });
    expect(projectHoverSummary({ ...input, pending: true })).toMatchObject({
      total: undefined,
      historyState: "loading",
    });
    expect(projectHoverSummary({ ...input, failed: true })).toMatchObject({
      total: undefined,
      historyState: "error",
    });
    expect(projectHoverSummary({ ...input, loaded: true })).toEqual({
      total: 0,
      unread: 0,
      opened: 0,
      historyState: "ready",
    });
    expect(
      projectHoverSummary({ ...input, loaded: true, failed: true }),
    ).toMatchObject({ total: 0, historyState: "error", cached: true });
    expect(
      projectHoverSummary({
        ...input,
        history: [row("cached")],
        loaded: true,
        pending: true,
      }),
    ).toMatchObject({ total: 1, historyState: "loading", cached: true });
  });

  it("resolves shell bindings and deduplicates repeated tabs without crossing remote projects", () => {
    const remoteA = "remote://machine/projects/alpha";
    const remoteB = "remote://machine/projects/beta";
    const ids = new Map([
      ["shell-a", "same-id"],
      ["shell-a-copy", "same-id"],
      ["shell-b", "same-id"],
    ]);
    const input = {
      history: [row("shell-a", remoteA), row("shell-b", remoteB)],
      openSessions: [
        row("shell-a", remoteA),
        row("shell-a-copy", remoteA),
        row("shell-b", remoteB),
      ],
      openSessionIds: new Set(["shell-a", "shell-a-copy"]),
      remoteSessionId: (id: string) => ids.get(id),
      remoteSessions: [{ id: "same-id" }],
      loaded: true,
    };
    expect(
      projectHoverSummary({
        ...input,
        path: remoteA,
        unseenFinishedIds: new Set(["same-id"]),
      }),
    ).toMatchObject({ total: 1, unread: 1, opened: 1 });
    expect(
      projectHoverSummary({
        ...input,
        path: remoteB,
        unseenFinishedIds: new Set(),
      }),
    ).toMatchObject({ total: 1, unread: 0, opened: 0 });
    expect(
      projectHoverSummary({
        ...input,
        path: remoteA,
        remoteSessions: [{ id: "same-id", archived: true }],
      }),
    ).toMatchObject({ total: 0, opened: 1 });
  });

  it("supports existing callers without an explicit workspace id set", () => {
    expect(
      projectHoverSummary({
        path: A,
        history: [],
        openSessions: [row("blank"), row("other-project", B)],
        loaded: true,
      }),
    ).toMatchObject({ total: 1, opened: 1 });
  });
});
