import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostWorktreeStatus } from "./git-worktrees";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("uses Git registration rather than a different directory or branch to identify linked worktrees", async () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-worktree-status-"));
  directories.push(directory);
  const main = join(directory, "main");
  const linked = join(directory, "linked");
  mkdirSync(main);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: main, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "initial");
  git("checkout", "-qb", "feature");
  git("worktree", "add", "--detach", linked, "HEAD");
  mkdirSync(join(main, "subdir"));
  mkdirSync(join(linked, "subdir"));
  const status = new HostWorktreeStatus();
  expect(await status.isLinked(main)).toBe(false);
  expect(await status.isLinked(join(main, "subdir"))).toBe(false);
  expect(await status.isLinked(directory)).toBe(false);
  expect(await status.isLinked(linked)).toBe(true);
  expect(await status.isLinked(join(linked, "subdir"))).toBe(true);
  if (process.platform === "win32") {
    expect(await status.isLinked(main.replace(/\\/g, "/").toUpperCase() + "/")).toBe(false);
    expect(await status.isLinked(linked.replace(/\\/g, "/").toUpperCase() + "/")).toBe(true);
  }
  // Revalidate after the short display cache expires, including removed worktrees.
  git("worktree", "remove", "--force", linked);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 6_000);
  expect(await status.isLinked(linked)).toBe(false);
});
