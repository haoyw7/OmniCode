import { describe, expect, it } from "vitest";
import { newFileTab, newTerminalFile } from "../../workspace/model/layout";
import { newSession } from "../../sessions/model/session";
import { sessionExecutionCwd } from "../../../domain/session";
import type { Worktree } from "../../../contracts/worktree";
import { sessionInWorktree, detachSessionWorktree, assertWorktreeFilesClosed, worktreeSessionIds, registeredWorktreeAt } from "./worktrees";

const tree: Worktree = {
  path: "/repo-worktrees/feature",
  branch: "feature",
  head: "abc",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
};

it("distinguishes an ordinary subdirectory from a registered linked worktree", () => {
  const main = { ...tree, path: "D:/Repo", isMain: true };
  const linked = { ...tree, path: "D:/Repo/.trees/feature", isMain: false };
  expect(registeredWorktreeAt("d:\\repo\\src", [main, linked])?.isMain).toBe(true);
  expect(registeredWorktreeAt("D:/Repo/.trees/feature/src", [main, linked])).toBe(linked);
  expect(registeredWorktreeAt("D:/Repo-other", [main, linked])).toBeUndefined();
  expect(registeredWorktreeAt(linked.path, [{ ...linked, missing: true }])).toBeUndefined();
});

describe("worktree deletion preflight", () => {
  it("blocks open files and terminals, including nested working folders", () => {
    for (const file of [
      newFileTab(`${tree.path}/file.ts`, tree.path),
      newFileTab(`${tree.path}/file.ts`, "/repo"),
      newTerminalFile(tree.path),
      newTerminalFile(`${tree.path}/src`),
    ]) {
      expect(() => assertWorktreeFilesClosed(tree.path, [file])).toThrow(
        "Close the files and terminals",
      );
    }
  });

  it("allows unrelated files and similarly named sibling worktrees", () => {
    expect(() =>
      assertWorktreeFilesClosed(tree.path, [
        newFileTab("/repo/file.ts", "/repo"),
        newTerminalFile(`${tree.path}-other`),
      ]),
    ).not.toThrow();
  });
});

describe("working-copy context", () => {
  it("lets an empty session select a worktree and return to main in place", () => {
    const session = {
      ...newSession("codex", "/repo"),
      providerSessionId: "old-provider",
      context: { used: 12 },
      composerSeed: "An unsent draft",
      blocks: [{ id: "s", role: "status" as const, text: "Ready" }],
    };
    const selected = sessionInWorktree(session, tree);
    expect(selected.cwd).toBe("/repo");
    expect(selected.id).toBe(session.id);
    expect(selected.blocks).toBe(session.blocks);
    expect(selected.composerSeed).toBe("An unsent draft");
    expect(sessionExecutionCwd(selected)).toBe(tree.path);
    expect(selected.providerSessionId).toBeUndefined();
    expect(selected.context).toBeUndefined();
    const main = sessionInWorktree(selected, {
      ...tree,
      path: "/repo",
      branch: "main",
      isMain: true,
    });
    expect(main.executionCwd).toBe("/repo");
    expect(main.linkedWorktree).toBe(false);
    expect(main.id).toBe(session.id);
    expect(sessionExecutionCwd(main)).toBe("/repo");
  });

  it("starts a separate session on main without changing the worktree conversation", () => {
    const source = {
      ...newSession("codex", "/repo"),
      executionCwd: tree.path,
      branch: tree.branch!,
      providerSessionId: "existing-agent-thread",
      providerAccountId: "work-account",
      context: { used: 12 },
      title: "Build feature",
      blocks: [{ id: "u", role: "user" as const, text: "Build feature" }],
      composerSeed: "Keep this draft here",
    };
    const before = structuredClone(source);
    const selected = sessionInWorktree(source, {
      ...tree,
      path: "/repo",
      branch: "main",
      isMain: true,
    });
    expect(source).toEqual(before);
    expect(selected.id).not.toBe(source.id);
    expect(selected.cwd).toBe(source.cwd);
    expect(selected.executionCwd).toBe("/repo");
    expect(selected.linkedWorktree).toBe(false);
    expect(sessionExecutionCwd(selected)).toBe("/repo");
    expect(selected.branch).toBe("main");
    expect(selected.blocks).toEqual([]);
    expect(selected.providerSessionId).toBeUndefined();
    expect(selected.context).toBeUndefined();
    expect(selected.composerSeed).toBeUndefined();
    expect(selected.title).not.toBe(source.title);
    expect(selected.harness).toBe(source.harness);
    expect(selected.model).toBe(source.model);
    expect(selected.modelSettings).toEqual(source.modelSettings);
    expect(selected.runtimeMode).toBe(source.runtimeMode);
    expect(selected.providerAccountId).toBe(source.providerAccountId);
  });

  it("binds a session after the first user message even without a provider thread", () => {
    const source = {
      ...newSession("codex", "/repo"),
      // Attachment-only messages count too.
      blocks: [{ id: "u", role: "user" as const, text: "" }],
    };
    const selected = sessionInWorktree(source, tree);
    expect(selected.id).not.toBe(source.id);
    expect(selected.blocks).toEqual([]);
    expect(sessionExecutionCwd(selected)).toBe(tree.path);
    expect(sessionExecutionCwd(source)).toBe("/repo");
    expect(source.blocks).toHaveLength(1);
  });

  it("opens a new session when selecting another linked worktree", () => {
    const source = {
      ...newSession("codex", "/repo"),
      executionCwd: tree.path,
      blocks: [{ id: "u", role: "user" as const, text: "Build feature" }],
    };
    const other = { ...tree, path: "/repo-worktrees/other", branch: "other" };
    const selected = sessionInWorktree(source, other);
    expect(selected.id).not.toBe(source.id);
    expect(selected.cwd).toBe("/repo");
    expect(selected.executionCwd).toBe(other.path);
    expect(source.executionCwd).toBe(tree.path);
  });

  it("leaves the current working copy and provider context unchanged when reselected", () => {
    const source = {
      ...newSession("codex", "/repo"),
      executionCwd: tree.path,
      providerSessionId: "existing-agent-thread",
      context: { used: 12 },
      blocks: [{ id: "u", role: "user" as const, text: "Build feature" }],
    };
    expect(sessionInWorktree(source, tree)).toBe(source);
  });

  it("counts shared, archived, and unsaved sessions without double counting", () => {
    const saved = { ...tree, sessionIds: ["saved", "archived", "moved"] };
    const sessions = [
      { ...newSession("codex", "/repo"), id: "saved", executionCwd: tree.path },
      { ...newSession("codex", "/repo"), id: "blank", executionCwd: tree.path },
      { ...newSession("codex", "/repo"), id: "moved" },
      { ...newSession("codex", tree.path), id: "opened-as-project" },
    ];
    expect(worktreeSessionIds(saved, sessions).sort()).toEqual([
      "archived",
      "blank",
      "opened-as-project",
      "saved",
    ]);
  });
});

describe("sessions kept after worktree deletion", () => {
  const source = {
    ...newSession("codex", "/repo"),
    executionCwd: tree.path,
    branch: "feature",
    providerSessionId: "old-agent-thread",
    title: "Build feature",
    blocks: [{ id: "u", role: "user" as const, text: "Build feature" }],
  };

  it("keeps the transcript and clears the selected branch and provider", () => {
    const kept = detachSessionWorktree(source, "/repo", tree.path);
    expect(kept.id).toBe(source.id);
    expect(kept.blocks).toBe(source.blocks);
    expect(kept.title).toBe(source.title);
    expect(kept.worktreeRemoved).toBe(true);
    expect(kept.branch).toBeUndefined();
    expect(kept.providerSessionId).toBeUndefined();
    expect(
      worktreeSessionIds({ ...tree, sessionIds: [source.id] }, [kept]),
    ).toEqual([]);
  });

  it("moves a directly opened worktree's project identity to the surviving repository", () => {
    const direct = {
      ...source,
      cwd: `${tree.path}/src`,
      executionCwd: undefined,
    };
    const kept = detachSessionWorktree(direct, "/repo", tree.path);
    expect(kept.cwd).toBe("/repo");
    expect(kept.executionCwd).toBe(`${tree.path}/src`);
  });

  it.each(["/repo", tree.path, "/repo-worktrees/other"])(
    "continues the same conversation in %s",
    (path) => {
      const kept = detachSessionWorktree(source, "/repo", tree.path);
      const selected = sessionInWorktree(kept, { ...tree, path });
      expect(selected.id).toBe(source.id);
      expect(selected.title).toBe(source.title);
      expect(selected.blocks[0]).toEqual(source.blocks[0]);
      expect(selected.blocks.at(-1)?.handoff?.pending).toBe(true);
      expect(selected.blocks.at(-1)?.text).toContain("Build feature");
      expect(sessionExecutionCwd(selected)).toBe(path);
      expect(selected.worktreeRemoved).toBeUndefined();
      expect(selected.providerSessionId).toBeUndefined();
    },
  );
});
