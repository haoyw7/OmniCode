import { describe, expect, it, vi } from "vitest";
import {
  allProjectHistoryWithLiveSessions,
  historyWithLiveSessions,
  filterSessionsByArchive,
  filterSessionsByQuery,
  mergeHistorySummary,
  mergeProjectHistorySummary,
  replaceProjectHistory,
  reuseEqualSummaries,
  sidebarLiveSessions,
  summaryFromSession,
  mergeLiveSessionSummaries,
  compareSessionSummaries,
} from "./sessionHistory";
import { pathKey } from "../../../shared/lib/paths";
import { newSession } from "../model/session";
import { appendUser } from "../../../integrations/harness/core/apply";
import type { SessionSummary } from "./sessionStore";
import type { OrchestrationRun } from "../../orchestration/model/orchestration";

function summary(id: string, cwd: string, updatedAt = 1): SessionSummary {
  return {
    id,
    cwd,
    harness: "cursor",
    model: "gpt-5",
    runtimeMode: "supervised",
    title: `cursor · ${id}`,
    createdAt: updatedAt,
    updatedAt,
    additions: 0,
    deletions: 0,
  };
}

it("preserves remote-control attribution when local activity updates a Host history row", () => {
  const stored = { ...summary("phone", "/repo"), remoteControl: true };
  const live = summary("phone", "/repo", 2);
  expect(mergeHistorySummary([stored], live)[0].remoteControl).toBe(true);
  expect(mergeLiveSessionSummaries([stored], [live])[0].remoteControl).toBe(true);
});

describe("sidebarLiveSessions", () => {
  it("hides new composers while keeping explicitly saved drafts and background work", () => {
    const blank = (id: string) => ({ ...newSession("codex", "/repo"), id });
    const sessions = [
      blank("orphan"),
      blank("open-blank"),
      { ...blank("working"), busy: true },
      { ...blank("draft"), blocks: [{ id: "d", role: "user" as const, text: "Unsent", draft: true }] },
      { ...blank("history"), blocks: [{ id: "u", role: "user" as const, text: "Existing conversation" }] },
      { ...blank("worker"), orchestrationLeadId: "lead" },
    ];
    expect(sidebarLiveSessions(sessions).map((session) => session.id))
      .toEqual(["working", "draft", "history"]);
  });

  it.each(["/repo", "remote://host/repo"])(
    "shows a new conversation once its first message is sent in %s",
    (cwd) => {
      const draft = newSession("codex", cwd);
      expect(sidebarLiveSessions([draft])).toEqual([]);
      const sent = appendUser(draft, "First message");
      expect(sidebarLiveSessions([sent])).toEqual([sent]);
    },
  );
});

describe("historyWithLiveSessions", () => {
  it("keeps conversation order when projects are revisited and history arrives", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    try {
      const older = appendUser({ ...newSession("codex", "/repo"), id: "a-old" }, "Older");
      clock.mockReturnValue(20_000);
      const newer = appendUser({ ...newSession("codex", "/repo"), id: "z-new" }, "Newer");
      const sessions = [older, newer];
      const initial = historyWithLiveSessions([], sessions, "/repo");
      expect(initial.map((row) => row.id)).toEqual(["z-new", "a-old"]);

      clock.mockReturnValue(120_000);
      historyWithLiveSessions([], sessions, "/another-project");
      expect(historyWithLiveSessions([], sessions, "/repo")).toEqual(initial);
      const stored = initial.map((row) => ({ ...row }));
      expect(historyWithLiveSessions(stored, sessions, "/repo")).toEqual(initial);
      expect(allProjectHistoryWithLiveSessions(stored, sessions)).toEqual(initial);
    } finally {
      clock.mockRestore();
    }
  });

  it("moves an existing chat on a new turn before persistence catches up, preserving pins", () => {
    const session = {
      ...newSession("codex", "/repo"),
      id: "old",
      blocks: [{ id: "turn", role: "user" as const, text: "Continue", startedAt: 3_000 }],
    };
    const stored = [summary("old", "/repo", 1_000), summary("recent", "/repo", 2_000),
      { ...summary("pin", "/repo", 500), pinned: true }];
    const rows = historyWithLiveSessions(stored, [session], "/repo");
    expect(rows.map((row) => row.id)).toEqual(["pin", "old", "recent"]);
    expect(rows[1].updatedAt).toBe(3_000);
    expect(stored[0].updatedAt).toBe(1_000);
  });

  const run: OrchestrationRun = {
    version: 1,
    leadId: "lead",
    cwd: "/tmp/project-a",
    status: "active",
    allowedHarnesses: ["codex"],
    maxWorkers: 2,
    cli: "monocode",
    continuations: 0,
    requests: {},
    tasks: ["worker-a", "worker-b"].map((id) => ({
      id,
      sessionId: id,
      title: id,
      harness: "codex",
      model: "codex:test",
      prompt: "Task",
      files: [id],
      scopes: [id],
      dependsOn: [],
      status: "running",
      accepted: false,
      result: "",
      delivered: false,
    })),
  };

  it("groups live and already-saved workers under their lead before adoption effects run", () => {
    const sessions = ["lead", "worker-a", "worker-b"].map((id) => ({
      ...newSession("codex", run.cwd),
      id,
      blocks: [{ id: "u", role: "user" as const, text: "Build" }],
      busy: id !== "lead",
    }));
    const rows = historyWithLiveSessions(
      [
        summary("lead", run.cwd),
        summary("worker-a", run.cwd),
        summary("unrelated", run.cwd),
      ],
      sessions,
      run.cwd,
      undefined,
      [run],
    );
    expect(rows.map((row) => row.id).sort()).toEqual(["lead", "unrelated"]);
    expect(rows.find((row) => row.id === "lead")?.orchestration).toMatchObject({
      live: true,
      status: "active",
      tasks: [{ sessionId: "worker-a" }, { sessionId: "worker-b" }],
    });
  });

  it("keeps ownership after restart, cache merges, and replacement runs", () => {
    const history: SessionSummary[] = [
      {
        ...summary("lead", run.cwd),
        orchestration: { status: "paused", tasks: run.tasks },
      },
      summary("worker-a", run.cwd),
      { ...summary("older-worker", run.cwd), orchestrationLeadId: "lead" },
    ];
    const merged = mergeHistorySummary(history, summary("lead", run.cwd, 2));
    const rows = historyWithLiveSessions(merged, [], run.cwd);
    expect(rows.map((row) => row.id)).toEqual(["lead"]);
    expect(rows[0].orchestration?.tasks).toHaveLength(2);
    const replacement = historyWithLiveSessions(
      merged,
      [],
      run.cwd,
      undefined,
      [{ ...run, tasks: [] }],
    );
    expect(replacement.map((row) => row.id)).toEqual(["lead"]);
    expect(replacement[0].orchestration?.tasks).toEqual([]);
  });

  it("shows a live generated title and work item before the next persist", () => {
    const cwd = "/tmp/project-a";
    const linkedWorkItem = {
      kind: "pr" as const,
      repo: "acme/app",
      number: 42,
      url: "https://github.com/acme/app/pull/42",
    };
    const session = {
      ...newSession("cursor", cwd),
      id: "live",
      title: "cursor · Fix tab title refresh",
      linkedWorkItem,
      blocks: [{ id: "u", role: "user" as const, text: "Fix PR #42" }],
      busy: true,
    };
    const rows = historyWithLiveSessions(
      [summary("live", cwd)],
      [session],
      cwd,
    );
    expect(rows[0]).toMatchObject({
      title: "cursor · Fix tab title refresh",
      linkedWorkItem,
    });
  });

  it("shows the current provider and model before a switched session is persisted", () => {
    const cwd = "/tmp/project-a";
    const stored = {
      ...summary("live", cwd),
      title: "Fix sidebar identity",
      pinned: true,
    };
    const session = {
      ...newSession("claude", cwd),
      id: stored.id,
      title: stored.title,
      model: "claude:sonnet",
      blocks: [{ id: "u", role: "user" as const, text: "Continue" }],
    };

    const rows = historyWithLiveSessions([stored], [session], cwd);
    expect(rows[0]).toMatchObject({
      harness: "claude",
      model: "claude:sonnet",
      title: stored.title,
      pinned: true,
      updatedAt: stored.updatedAt,
    });
    expect(stored.harness).toBe("cursor");
    expect(stored.model).toBe("gpt-5");
  });

  it("does not inject an internal worker without a loaded run", () => {
    const worker = {
      ...newSession("codex", run.cwd),
      id: "worker",
      orchestrationLeadId: "lead",
      busy: true,
    };
    expect(historyWithLiveSessions([], [worker], run.cwd)).toEqual([]);
  });

  it("drops persisted sessions from other projects", () => {
    const history = [
      summary("a1", "/tmp/project-a"),
      summary("b1", "/tmp/project-b"),
    ];
    const rows = historyWithLiveSessions(history, [], "/tmp/project-a");
    expect(rows.map((row) => row.id)).toEqual(["a1"]);
  });

  it("does not inject live sessions from other projects", () => {
    const session = newSession("cursor", "/tmp/project-b");
    session.blocks = [{ id: "u1", role: "user", text: "hello" }];
    session.busy = true;

    const rows = historyWithLiveSessions([], [session], "/tmp/project-a");
    expect(rows).toEqual([]);
  });

  it("includes live sessions for the active project", () => {
    const session = newSession("cursor", "/tmp/project-a");
    session.blocks = [{ id: "u1", role: "user", text: "hello" }];
    session.busy = true;

    const rows = historyWithLiveSessions([], [session], "/tmp/project-a");
    expect(rows.map((row) => row.id)).toEqual([session.id]);
    expect(rows[0]?.repo).toBe("project-a");
  });

  it("marks drafts appended to started threads and clears stale draft status when sent", () => {
    const session = newSession("cursor", "/tmp/project-a");
    session.id = "draft-session";
    session.blocks = [
      { id: "sent", role: "user", text: "Start here" },
      { id: "reply", role: "assistant", text: "Done" },
      { id: "draft", role: "user", text: "Explore this", draft: true },
    ];

    const draftRows = historyWithLiveSessions([], [session], "/tmp/project-a");
    expect(draftRows[0]?.draft).toBe(true);

    session.blocks = [
      { id: "sent", role: "user", text: "Start here" },
      { id: "reply", role: "assistant", text: "Done" },
      { id: "follow-up", role: "user", text: "Explore this" },
    ];
    session.busy = true;
    const sentRows = historyWithLiveSessions(
      [{ ...draftRows[0], draft: true }],
      [session],
      "/tmp/project-a",
    );
    expect(sentRows[0]?.draft).toBeUndefined();
  });

  it("overlays an automation origin onto an already-saved session", () => {
    const session = newSession("cursor", "/tmp/project-a");
    session.id = "auto-session";
    session.blocks = [{ id: "u1", role: "user", text: "review PRs" }];
    session.automationId = "automation-1";
    session.busy = true;

    const rows = historyWithLiveSessions(
      [summary("auto-session", "/tmp/project-a")],
      [session],
      "/tmp/project-a",
    );
    expect(rows[0]?.automationId).toBe("automation-1");
  });

  it("stamps composer git onto a live session that is not persisted yet", () => {
    const session = newSession("cursor", "/tmp/monocode");
    session.blocks = [{ id: "u1", role: "user", text: "hello" }];
    session.busy = true;

    const rows = historyWithLiveSessions([], [session], "/tmp/monocode", {
      repo: "monocode",
      branch: "main",
    });
    expect(rows[0]).toMatchObject({
      id: session.id,
      repo: "monocode",
      branch: "main",
    });
  });

  it("copies origin repo from sibling history and prefers the live branch", () => {
    const history = [
      {
        ...summary("a1", "/tmp/agent-terminal"),
        repo: "monocode",
        branch: "main",
      },
    ];
    const session = newSession("cursor", "/tmp/agent-terminal");
    session.blocks = [{ id: "u1", role: "user", text: "hello" }];
    session.busy = true;

    const rows = historyWithLiveSessions(
      history,
      [session],
      "/tmp/agent-terminal",
      { repo: "agent-terminal", branch: "fix-gutter" },
    );
    const live = rows.find((row) => row.id === session.id);
    expect(live).toMatchObject({
      repo: "monocode",
      branch: "fix-gutter",
    });
  });

  it("keeps a session's own branch instead of the project overlay", () => {
    const session = newSession("cursor", "/tmp/agent-terminal");
    session.blocks = [{ id: "u1", role: "user", text: "hello" }];
    session.busy = true;
    session.branch = "feat/picker";

    const rows = historyWithLiveSessions([], [session], "/tmp/agent-terminal", {
      repo: "monocode",
      branch: "main",
    });
    expect(rows[0]).toMatchObject({
      id: session.id,
      repo: "monocode",
      branch: "feat/picker",
    });
  });

  it("matches project paths with trailing slashes", () => {
    const history = [summary("a1", "/tmp/project-a/")];

    const rows = historyWithLiveSessions(history, [], "/tmp/project-a");
    expect(rows.map((row) => row.id)).toEqual(["a1"]);
  });

  describe("allProjectHistoryWithLiveSessions", () => {
    it("preserves project order, path aliases, duplicate rows and live overlays", () => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(100);
      try {
        const history = [
          {
            ...summary("stored", "/tmp/project-a", 3),
            repo: "origin",
            branch: "old",
          },
          summary("duplicate", "C:\\Repo\\", 8),
          { ...summary("pin", "/tmp/project-a/", 1), pinned: true },
          summary("duplicate", "c:/repo", 8),
          summary("duplicate", "/tmp/project-b", 2),
        ];
        const saved = {
          ...newSession("cursor", "/tmp/project-a/"),
          id: "stored",
          title: "Updated",
          automationId: "automation-1",
          blocks: [
            { id: "draft", role: "user" as const, text: "Next", draft: true },
          ],
        };
        const sessions = [
          saved,
          { ...newSession("codex", "c:/REPO/"), id: "new", busy: true, updatedAt: 100 },
          { ...newSession("cursor", "/tmp/project-b"), id: "blank" },
        ];
        const gitForProject = (cwd: string) =>
          pathKey(cwd) === pathKey(saved.cwd)
            ? { branch: "current" }
            : undefined;
        const paths = new Map<string, string>();
        for (const row of [...history, ...sessions])
          paths.set(pathKey(row.cwd), row.cwd);
        const previous = [...paths.values()].flatMap((cwd) =>
          historyWithLiveSessions(history, sessions, cwd, gitForProject(cwd)),
        );
        const next = allProjectHistoryWithLiveSessions(
          history,
          sessions,
          gitForProject,
        );
        expect(next).toEqual(previous);
        expect(next.map((row) => row.id)).toEqual([
          "pin",
          "stored",
          "new",
          "duplicate",
          "duplicate",
          "duplicate",
        ]);
        expect(next.find((row) => row.id === "stored")).toMatchObject({
          title: "Updated",
          draft: true,
          automationId: "automation-1",
          repo: "origin",
          branch: "old",
          updatedAt: 3,
        });
        expect(next[0]).toBe(history[2]);
        expect(next[3]).toBe(history[1]);
        expect(next[4]).toBe(history[3]);
        expect(history[0].title).toBe("cursor · stored");
      } finally {
        clock.mockRestore();
      }
    });

    it("keeps cross-project workers and inbox chats private while updating lead input status", () => {
      const worker = {
        ...newSession("codex", "/tmp/project-b"),
        id: "worker-a",
        pendingQuestion: { requestId: 1, questions: [] },
        busy: true,
      };
      const internal = {
        ...newSession("codex", "/tmp/project-c"),
        id: "internal-worker",
        orchestrationLeadId: "saved-lead",
        busy: true,
      };
      const inbox = {
        ...newSession("codex", "/tmp/project-b"),
        id: "inbox",
        busy: true,
        inboxAsk: {
          key: "item",
          title: "Ask",
          url: "https://example.com/item",
          provider: "github" as const,
        },
      };
      const history = [
        summary("worker-a", worker.cwd),
        summary("lead", run.cwd),
        {
          ...summary("saved-lead", "/tmp/project-c"),
          orchestration: {
            status: "paused" as const,
            tasks: [{ ...run.tasks[1], sessionId: "saved-worker" }],
          },
        },
        summary("saved-worker", "/tmp/project-d"),
        summary("internal-worker", "/tmp/project-e"),
        summary("inbox", "/tmp/project-f"),
        summary("unrelated", worker.cwd),
      ];
      const next = allProjectHistoryWithLiveSessions(
        history,
        [worker, internal, inbox],
        undefined,
        [run],
      );
      expect(next.map((row) => row.id)).toEqual([
        "unrelated",
        "lead",
        "saved-lead",
      ]);
      expect(
        next.find((row) => row.id === "lead")?.orchestration?.tasks[0]
          .needsInput,
      ).toBe(true);
      expect(next.find((row) => row.id === "saved-lead")).toBe(history[2]);
    });

    it("groups histories without reading every row again for each project", () => {
      let pathReads = 0;
      const history = Array.from({ length: 120 }, (_, index) => {
        const cwd = `/tmp/project-${index % 30}`;
        return {
          ...summary(`row-${index}`, cwd, index),
          get cwd() {
            pathReads++;
            return cwd;
          },
        };
      });
      const next = allProjectHistoryWithLiveSessions(history, []);
      expect(next).toHaveLength(history.length);
      expect(pathReads).toBeLessThanOrEqual(history.length * 2);
    });
  });
});

describe("filterSessionsByArchive", () => {
  it("hides archived sessions by default", () => {
    const rows = [
      summary("a1", "/tmp/project-a"),
      { ...summary("a2", "/tmp/project-a"), archived: true },
    ];
    expect(filterSessionsByArchive(rows, false).map((row) => row.id)).toEqual([
      "a1",
    ]);
  });

  it("shows only archived sessions when filtered", () => {
    const rows = [
      summary("a1", "/tmp/project-a"),
      { ...summary("a2", "/tmp/project-a"), archived: true },
    ];
    expect(filterSessionsByArchive(rows, true).map((row) => row.id)).toEqual([
      "a2",
    ]);
  });
});

describe("filterSessionsByQuery", () => {
  it("returns all rows when the query is empty", () => {
    const rows = [
      summary("a1", "/tmp/project-a"),
      summary("a2", "/tmp/project-a"),
    ];
    expect(filterSessionsByQuery(rows, "  ").map((row) => row.id)).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("matches conversation titles", () => {
    const rows = [
      {
        ...summary("a1", "/tmp/project-a"),
        title: "cursor · Fix sidebar search",
      },
      {
        ...summary("a2", "/tmp/project-a"),
        title: "cursor · Archive sessions",
      },
    ];
    expect(filterSessionsByQuery(rows, "sidebar").map((row) => row.id)).toEqual(
      ["a1"],
    );
  });

  it("matches model and branch labels", () => {
    const rows = [
      { ...summary("a1", "/tmp/project-a"), model: "gpt-5", branch: "main" },
      {
        ...summary("a2", "/tmp/project-a"),
        model: "opus",
        branch: "fix-gutter",
      },
    ];
    expect(filterSessionsByQuery(rows, "opus").map((row) => row.id)).toEqual([
      "a2",
    ]);
    expect(filterSessionsByQuery(rows, "gutter").map((row) => row.id)).toEqual([
      "a2",
    ]);
  });
});

describe("replaceProjectHistory", () => {
  it("swaps one project's rows and keeps the others cached", () => {
    const current = [
      summary("a1", "/tmp/project-a", 3),
      summary("b1", "/tmp/project-b", 2),
    ];
    const next = replaceProjectHistory(current, "/tmp/project-a", [
      summary("a2", "/tmp/project-a", 5),
    ]);
    expect(next.map((row) => row.id).sort()).toEqual(["a2", "b1"]);
  });

  it("clears a project that came back empty without touching the rest", () => {
    const current = [
      summary("a1", "/tmp/project-a", 3),
      summary("b1", "/tmp/project-b", 2),
    ];
    const next = replaceProjectHistory(current, "/tmp/project-a", []);
    expect(next.map((row) => row.id)).toEqual(["b1"]);
  });

  it("replaces canonical sessions loaded through a project alias without accumulating copies", () => {
    const alias = "/home/user/project-a";
    const canonical = "/mnt/data/project-a";
    const old = summary("a1", canonical, 1);
    const unrelated = summary("b1", "/tmp/project-b", 2);
    const fresh = { ...old, updatedAt: 5, pinned: true };
    // Also recover copies already accumulated by earlier alias refreshes.
    const current = [old, unrelated, old, old];
    const next = replaceProjectHistory(current, alias, [fresh]);
    expect(next).toEqual([unrelated, fresh]);
    expect(replaceProjectHistory(next, alias, [fresh])).toEqual(next);
    expect(replaceProjectHistory(next, canonical, [fresh])).toEqual(next);
    expect(current).toEqual([old, unrelated, old, old]);
  });

  it("replaces a moved session by id while retaining distinct conversations with the same title", () => {
    const old = summary("a1", "/tmp/project-a", 1);
    const sameTitle = { ...summary("b1", "/tmp/project-b", 2), title: old.title };
    const moved = { ...old, cwd: "/tmp/project-c", updatedAt: 5 };
    expect(replaceProjectHistory([old, sameTitle], moved.cwd, [moved]))
      .toEqual([sameTitle, moved]);
  });
});

describe("mergeProjectHistorySummary", () => {
  it("merges into its own project and leaves other projects cached", () => {
    const current = [
      summary("a1", "/tmp/project-a", 1),
      summary("b1", "/tmp/project-b", 2),
    ];
    const next = mergeProjectHistorySummary(
      current,
      summary("a1", "/tmp/project-a", 9),
    );
    expect(next.map((row) => row.id).sort()).toEqual(["a1", "b1"]);
    expect(next.find((row) => row.id === "a1")?.updatedAt).toBe(9);
  });

  it("does not leave a duplicate behind when a session changes project", () => {
    const current = [
      summary("a1", "/tmp/project-a", 1),
      summary("b1", "/tmp/project-b", 2),
    ];
    const next = mergeProjectHistorySummary(
      current,
      summary("a1", "/tmp/project-b", 9),
    );
    expect(next.map((row) => row.id).sort()).toEqual(["a1", "b1"]);
    expect(next.find((row) => row.id === "a1")?.cwd).toBe("/tmp/project-b");
  });
});

describe("pinned sessions", () => {
  it("keeps pinned sessions above newer unpinned ones", () => {
    const current = [
      summary("new", "/tmp/project-a", 20),
      { ...summary("pin", "/tmp/project-a", 5), pinned: true },
    ];
    const next = mergeHistorySummary(
      current,
      summary("new", "/tmp/project-a", 30),
    );
    expect(next.map((row) => row.id)).toEqual(["pin", "new"]);
  });

  it("preserves automation origin when an incoming summary omits it", () => {
    const current = [
      { ...summary("auto", "/tmp/project-a", 5), automationId: "automation-1" },
    ];
    const next = mergeHistorySummary(
      current,
      summary("auto", "/tmp/project-a", 9),
    );
    expect(next[0]?.automationId).toBe("automation-1");
  });

  it("preserves pin when an incoming summary omits it", () => {
    const current = [{ ...summary("pin", "/tmp/project-a", 5), pinned: true }];
    const next = mergeHistorySummary(
      current,
      summary("pin", "/tmp/project-a", 9),
    );
    expect(next[0]).toMatchObject({ id: "pin", pinned: true, updatedAt: 9 });
  });

  it("returns an unpinned session to recency order", () => {
    const current = [
      { ...summary("pin", "/tmp/project-a", 5), pinned: true },
      summary("new", "/tmp/project-a", 20),
    ];
    const next = mergeHistorySummary(current, {
      ...summary("pin", "/tmp/project-a", 5),
      pinned: false,
    });
    expect(next.map((row) => row.id)).toEqual(["new", "pin"]);
    expect(next.find((row) => row.id === "pin")?.pinned).toBe(false);
  });

  it("sorts pinned history to the top even without a live inject", () => {
    const history = [
      summary("new", "/tmp/project-a", 20),
      { ...summary("pin", "/tmp/project-a", 5), pinned: true },
    ];
    const rows = historyWithLiveSessions(history, [], "/tmp/project-a");
    expect(rows.map((row) => row.id)).toEqual(["pin", "new"]);
  });
});

describe("reuseEqualSummaries", () => {
  it("keeps the previous array when a live overlay produced the same rows", () => {
    const stored = summary("a", "/p", 5);
    const live = { ...summary("b", "/p"), createdAt: 0, updatedAt: 1_000 };
    const previous = [live, stored];
    const next = [{ ...live }, { ...stored }];
    expect(reuseEqualSummaries(previous, next)).toBe(previous);
  });

  it("swaps only the rows whose content changed", () => {
    const a = summary("a", "/p", 5);
    const b = summary("b", "/p", 4);
    const renamed = { ...b, title: "renamed" };
    const result = reuseEqualSummaries([a, b], [{ ...a }, renamed]);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(renamed);
  });

  it("reflects real activity even when it happens within the same minute", () => {
    const live = { ...summary("b", "/p"), createdAt: 0, updatedAt: 0 };
    const later = { ...live, updatedAt: 1_000 };
    expect(reuseEqualSummaries([live], [later])[0]).toBe(later);
  });
});

describe("summaryFromSession activity time", () => {
  it("orders completed replies and running sends independently of later tool and save times", () => {
    const finished = {
      ...newSession("codex", "/repo"), id: "finished", updatedAt: 9_000,
      blocks: [
        { id: "u", role: "user" as const, text: "Question", startedAt: 100, durationMs: 900 },
        { id: "a", role: "assistant" as const, text: "Answer", sentAt: 500 },
        { id: "t", role: "tool" as const, text: "Background output", startedAt: 1_000 },
      ],
    };
    const running = {
      ...finished, id: "running", busy: true,
      blocks: [
        { id: "u", role: "user" as const, text: "Next", startedAt: 300 },
        { id: "a", role: "assistant" as const, text: "Still working", sentAt: 800 },
      ],
    };
    const rows = [summaryFromSession(running), summaryFromSession(finished)].sort(compareSessionSummaries);
    expect(rows.map((row) => [row.id, row.activityAt])).toEqual([["finished", 500], ["running", 300]]);
    const live = summaryFromSession(running);
    expect(mergeLiveSessionSummaries([{ ...live, activityAt: 800, updatedAt: 10_000 }], [live])[0])
      .toMatchObject({ activityAt: 300, updatedAt: 10_000 });
    expect(summaryFromSession({ ...running, busy: false }).activityAt).toBe(800);
    expect(historyWithLiveSessions([summary("running", "/repo", 20_000)], [running], "/repo")[0].activityAt).toBe(300);
  });

  it("uses stored times for old transcripts without message timestamps", () => {
    const session = { ...newSession("codex", "/repo"), createdAt: 10, updatedAt: 20,
      blocks: [{ id: "u", role: "user" as const, text: "Legacy message" }] };
    expect(summaryFromSession(session)).toMatchObject({ createdAt: 10, updatedAt: 20 });
    expect(summaryFromSession(newSession("codex", "/repo")).updatedAt).toBe(0);
  });

  it("includes sent follow-ups and completed turn durations without consulting the clock", () => {
    const session = { ...newSession("codex", "/repo"), updatedAt: 100,
      blocks: [{ id: "u", role: "user" as const, text: "Continue", startedAt: 200, durationMs: 50, sentAt: 230 }] };
    expect(summaryFromSession(session).updatedAt).toBe(250);
    expect(summaryFromSession({ ...session, blocks: [{ ...session.blocks[0], sentAt: 300 }] }).updatedAt).toBe(300);
  });
});

describe("mergeLiveSessionSummaries", () => {
  it("keeps live activity ahead of stale history while retaining stored metadata", () => {
    const stored = [summary("new", "/repo", 10), summary("middle", "/repo", 20)];
    const live = [{ ...summary("new", "/repo", 30), title: "Stale shell title" }];
    const merged = mergeLiveSessionSummaries(stored, live).sort(compareSessionSummaries);
    expect(merged.map((row) => row.id)).toEqual(["new", "middle"]);
    expect(merged[0].title).toBe(stored[0].title);
    expect(merged[0].updatedAt).toBe(30);
    expect(mergeLiveSessionSummaries(merged, [summary("new", "/repo", 5)])).toEqual(merged);
    expect(stored[0].updatedAt).toBe(10);
  });
});
