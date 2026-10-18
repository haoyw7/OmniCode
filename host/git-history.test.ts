import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { GitHistory } from "../src/platform/tauri/fs";
import { HostStore } from "./store";
import { WorkspaceCommands } from "./workspace-commands";

it("includes all branches and detached worktrees only when requested, excluding stash", async () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-history-"));
  const cwd = join(directory, "repo");
  const detached = join(directory, "detached");
  mkdirSync(cwd);
  const store = new HostStore(join(directory, "host.db"));
  try {
    const git = (path: string, ...args: string[]) =>
      execFileSync("git", args, {
        cwd: path,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    git(cwd, "init", "-q", "-b", "main");
    git(cwd, "config", "user.name", "Graph Test");
    git(cwd, "config", "user.email", "graph@example.test");
    git(cwd, "commit", "--allow-empty", "-qm", "initial");
    git(cwd, "checkout", "-qb", "feature");
    git(cwd, "commit", "--allow-empty", "-qm", "feature only");
    git(cwd, "checkout", "-q", "main");
    git(cwd, "commit", "--allow-empty", "-qm", "main only");
    writeFileSync(join(cwd, "stash.txt"), "stash me");
    git(cwd, "stash", "push", "-u", "-m", "hidden stash");
    git(cwd, "worktree", "add", "--detach", detached);
    git(detached, "commit", "--allow-empty", "-qm", "detached only");
    const snapshot = git(
      cwd,
      "commit-tree",
      "HEAD^{tree}",
      "-p",
      "HEAD",
      "-m",
      "internal snapshot",
    );
    git(cwd, "update-ref", "refs/codex/snapshots/test", snapshot);
    store.addProject(cwd, "Graph");
    const commands = new WorkspaceCommands(store, async (_id, action) =>
      action(),
    );
    const read = (allRefs?: boolean, limit = 20, skip?: number) =>
      commands.run("git_history", {
        cwd,
        limit,
        allRefs,
        skip,
      }) as Promise<GitHistory>;
    const sidebar = await read();
    expect(sidebar.commits.map((commit) => commit.subject)).toEqual([
      "main only",
      "initial",
    ]);
    const all = await read(true);
    expect(all.commits.map((commit) => commit.subject).sort()).toEqual([
      "detached only",
      "feature only",
      "initial",
      "main only",
    ]);
    expect(
      all.commits
        .filter((commit) => commit.head)
        .map((commit) => commit.subject),
    ).toEqual(["main only"]);
    expect(
      all.commits.find((commit) => commit.subject === "feature only")?.refs,
    ).toContainEqual({ name: "feature", kind: "local" });
    expect((await read(true, 1)).commits).toHaveLength(1);
    expect((await read(true, 2, 2)).commits).toEqual(all.commits.slice(2, 4));
    expect((await read(true, 2, all.commits.length)).commits).toEqual([]);
    expect((await read(false, 1, 1)).commits).toEqual(sidebar.commits.slice(1));
    expect((await read(true, 1, -1)).commits).toEqual(all.commits.slice(0, 1));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
