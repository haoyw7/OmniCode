import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { GitFileDiff } from "../src/platform/tauri/fs";
import { HostStore } from "./store";
import { WorkspaceCommands } from "./workspace-commands";

it("returns complete large Git file contents for working tree, index, base and history", async () => {
  const root = mkdtempSync(join(tmpdir(), "monocode-large-diff-"));
  const store = new HostStore(":memory:");
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Diff Test");
    git("config", "user.email", "diff@example.test");
    const original = `${"source line\n".repeat(200_000)}old tail\n`;
    const current = `${original}new tail\n`;
    writeFileSync(join(root, "large.txt"), original);
    git("add", ".");
    git("commit", "-qm", "original");
    git("remote", "add", "origin", ".");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    store.addProject(root, "Diff");
    const commands = new WorkspaceCommands(store, async (_id, action) => action());
    const check = async (command: string, args: Record<string, unknown>) => {
      const result = await commands.run(command, { cwd: root, relative: "large.txt", ...args }) as GitFileDiff;
      expect(result.tooLarge).toBe(false);
      expect(result.binary).toBe(false);
      expect(result.original).toBe(original);
      expect(result.current).toBe(current);
    };
    writeFileSync(join(root, "large.txt"), current);
    await check("git_file_diff", { staged: false });
    await check("git_base_file_diff", { base: "head" });
    await check("git_base_file_diff", { base: "branch" });
    git("add", "large.txt");
    await check("git_file_diff", { staged: true });
    git("commit", "-qm", "updated");
    await check("git_commit_file_diff", { sha: git("rev-parse", "HEAD") });
    writeFileSync(join(root, "large.txt"), `${current}\0`);
    const binary = await commands.run("git_file_diff", { cwd: root, relative: "large.txt", staged: false }) as GitFileDiff;
    expect(binary.binary).toBe(true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
