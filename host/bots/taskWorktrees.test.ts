import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { BotThreadStore } from "./thread/store";
import { BotTaskWorktrees } from "./taskWorktrees";
import { createHostWorktree, hostWorktrees } from "../git-worktrees";
import { newSession } from "../../src/features/sessions/model/session";
import type { BotManagedWorktree } from "../../src/integrations/harness/core/botAutonomy";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bot-task-trees-")),
    cwd = join(dir, "repo");
  mkdirSync(cwd);
  git(cwd, "init", "-q");
  git(cwd, "checkout", "-q", "-b", "feature/target");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.com");
  writeFileSync(join(cwd, "base.txt"), "base\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "base");
  const store = new HostStore(join(dir, "host.db")),
    journal = new BotThreadStore(store);
  journal.initialize({ harness: "codex", model: "test" });
  const project = store.addProject(cwd, "Project");
  let minutes = 60;
  const makeService = (releaseIdle?: (sessionId: string) => Promise<void>) =>
    new BotTaskWorktrees(
      store,
      (_id, operation) => operation(),
      () => minutes,
      releaseIdle,
    );
  const service = makeService();
  cleanups.push(async () => {
    await service.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const create = async (id: string, sourceCwd = cwd) => {
    const origin = {
      kind: "assistant" as const,
      assistantId: journal.get()!.id,
      botId: journal.botId,
      threadId: journal.threadId,
      actionId: id,
      wakeupId: id,
    };
    journal.putAction({
      id,
      requestId: id,
      signature: id,
      action: "sessions.create",
      input: { projectId: project.id },
      rootCauseId: id,
      origin,
      state: "executing",
      createdAt: Date.now(),
    });
    const name = vi.fn(async () => `mc/${id}`);
    const tree = (await service.prepare(
      { ...journal.scope, requestId: id },
      project.id,
      sourceCwd,
      name,
      () => {},
    ))!;
    const session = {
      ...newSession("codex", tree.path, "test"),
      id,
      executionCwd: tree.path,
      blocks: [
        { id: `user-${id}`, role: "user" as const, text: "Task", origin },
        {
          id: `check-${id}`,
          role: "tool" as const,
          text: "Tests passed",
          tool: { status: "completed", input: "npm test", output: "passed" },
        },
      ],
    };
    store.save(
      {
        session,
        projectId: project.id,
        revision: 1,
        updatedAt: Date.now(),
        status: "idle",
        lastCompletedRunId: `run-${id}`,
      },
      { type: "test" },
    );
    journal.putAction({
      ...journal.action(id)!,
      state: "completed",
      targetRef: {
        environmentId: store.environmentId,
        projectId: project.id,
        sessionId: id,
      },
    });
    return {
      tree,
      name,
      evidence: {
        runId: `run-${id}`,
        blockIds: [`check-${id}`],
        summary: "npm test passed",
      },
    };
  };
  const commit = (tree: BotManagedWorktree, file: string, text = file) => {
    writeFileSync(join(tree.path, file), text);
    git(tree.path, "add", file);
    git(tree.path, "commit", "-qm", file);
  };
  return {
    cwd,
    dir,
    store,
    journal,
    service,
    makeService,
    create,
    commit,
    setMinutes: (value: number) => {
      minutes = value;
    },
  };
}

it("uses existing Host derivation from the chosen checkout HEAD and serially integrates isolated results", async () => {
  const f = await fixture();
  writeFileSync(join(f.cwd, "user.txt"), "untracked user work");
  const [a, b] = await Promise.all([f.create("one"), f.create("two")]);
  expect(a.name).toHaveBeenCalledWith(f.cwd);
  expect(a.tree.path).toBe(
    join((await hostWorktrees(f.cwd)).defaultRoot, "wt-mc-one"),
  );
  expect(a.tree.targetBranch).toBe("feature/target");
  expect(a.tree.baseCommit).toBe(git(f.cwd, "rev-parse", "HEAD"));
  expect(a.tree.path).not.toBe(b.tree.path);
  expect(existsSync(join(a.tree.path, "user.txt"))).toBe(false);
  expect(readFileSync(join(f.cwd, "user.txt"), "utf8")).toBe(
    "untracked user work",
  );
  f.commit(a.tree, "one.txt");
  f.commit(b.tree, "two.txt");
  await expect(
    f.service.integrate("one", a.evidence, () => {}),
  ).rejects.toThrow("user changes");
  expect(existsSync(join(f.cwd, "one.txt"))).toBe(false);
  rmSync(join(f.cwd, "user.txt"));
  const merged = await Promise.all([
    f.service.integrate("one", a.evidence, () => {}),
    f.service.integrate("two", b.evidence, () => {}),
  ]);
  expect(merged.map((tree) => tree.state)).toEqual(["merged", "merged"]);
  expect(readFileSync(join(f.cwd, "one.txt"), "utf8")).toBe("one.txt");
  expect(readFileSync(join(f.cwd, "two.txt"), "utf8")).toBe("two.txt");
  expect(git(f.cwd, "branch", "--show-current")).toBe("feature/target");
});

it("derives from a supplied existing source worktree and keeps its recorded merge target", async () => {
  const f = await fixture();
  const source = await createHostWorktree(
    f.cwd,
    "feature/source",
    "HEAD",
    false,
  );
  writeFileSync(join(source.path, "source.txt"), "source");
  git(source.path, "add", ".");
  git(source.path, "commit", "-qm", "source");
  const task = await f.create("derived", source.path);
  expect(task.name).toHaveBeenCalledWith(source.path);
  expect(task.tree.baseCommit).toBe(git(source.path, "rev-parse", "HEAD"));
  expect(task.tree.targetBranch).toBe("feature/source");
  expect(existsSync(join(task.tree.path, "source.txt"))).toBe(true);
});

it("preserves both sides on conflicts, a switched target, or missing verification", async () => {
  const f = await fixture(),
    task = await f.create("conflict");
  f.commit(task.tree, "base.txt", "task\n");
  await expect(
    f.service.integrate(
      "conflict",
      { ...task.evidence, blockIds: [] },
      () => {},
    ),
  ).rejects.toThrow("verification");
  writeFileSync(join(f.cwd, "base.txt"), "user\n");
  git(f.cwd, "add", ".");
  git(f.cwd, "commit", "-qm", "user");
  await expect(
    f.service.integrate("conflict", task.evidence, () => {}),
  ).rejects.toThrow();
  expect(git(f.cwd, "status", "--porcelain")).toBe("");
  expect(readFileSync(join(f.cwd, "base.txt"), "utf8")).toBe("user\n");
  expect(readFileSync(join(task.tree.path, "base.txt"), "utf8")).toBe("task\n");
  git(f.cwd, "checkout", "-qb", "different");
  await expect(
    f.service.integrate("conflict", task.evidence, () => {}),
  ).rejects.toThrow("Target branch changed");
});

it("recovers retention across restart and removes only merged clean Bot-owned worktrees, keeping branch and history", async () => {
  const f = await fixture(),
    task = await f.create("cleanup");
  const manual = await createHostWorktree(f.cwd, "mc/manual", "HEAD", false);
  f.commit(task.tree, "done.txt");
  const merged = await f.service.integrate("cleanup", task.evidence, () => {});
  const restarted = f.makeService();
  await restarted.sweep(merged.idleSince! + 3_599_999, true);
  expect(existsSync(task.tree.path)).toBe(true);
  await restarted.sweep(merged.idleSince! + 3_600_001, true);
  expect(existsSync(task.tree.path)).toBe(false);
  expect(existsSync(manual.path)).toBe(true);
  expect(git(f.cwd, "rev-parse", `refs/heads/${task.tree.branch}`)).toBe(
    merged.mergedHead,
  );
  expect(f.store.session("cleanup").session).toMatchObject({
    worktreeRemoved: true,
    blocks: expect.any(Array),
  });
  expect(f.journal.action("cleanup")!.worktree!.state).toBe("removed");
  await restarted.close();
});

it("rechecks retention after releasing an idle provider and preserves work when cleanup is disabled meanwhile", async () => {
  const f = await fixture(),
    task = await f.create("revoked");
  f.commit(task.tree, "done.txt");
  const merged = await f.service.integrate("revoked", task.evidence, () => {});
  const service = f.makeService(async () => {
    f.setMinutes(0);
  });
  await service.sweep(merged.idleSince! + 3_600_001, true);
  expect(existsSync(task.tree.path)).toBe(true);
  expect(f.journal.action("revoked")!.worktree!.state).toBe("merged");
  await service.close();
});

it.each([
  "dirty",
  "untracked",
  "unmerged",
  "queued",
  "approval",
  "question",
  "running",
  "reused",
  "disabled",
  "lookalike",
] as const)(
  "preserves %s worktrees after the idle timeout",
  async (condition) => {
    const f = await fixture(),
      task = await f.create("retained");
    f.commit(task.tree, "done.txt");
    const merged = await f.service.integrate(
      "retained",
      task.evidence,
      () => {},
    );
    const target = f.store.session("retained");
    if (condition === "dirty")
      writeFileSync(join(task.tree.path, "done.txt"), "unsaved");
    if (condition === "untracked")
      writeFileSync(join(task.tree.path, "user.txt"), "preserve");
    if (condition === "unmerged") f.commit(task.tree, "extra.txt");
    if (condition === "queued")
      target.session.queuedMessages = [
        { id: "q", text: "more", attachments: [] },
      ];
    if (condition === "approval")
      target.session.blocks.push({
        id: "approve",
        role: "tool",
        text: "",
        approval: { requestId: 1 },
      });
    if (condition === "question")
      target.session.pendingQuestion = { requestId: 1, questions: [] } as never;
    if (condition === "running") target.status = "running";
    if (["queued", "approval", "question", "running"].includes(condition))
      f.store.save({ ...target, revision: 2 }, { type: "test" });
    if (condition === "reused") f.service.touch("retained");
    if (condition === "disabled") f.setMinutes(0);
    if (condition === "lookalike")
      f.journal.putAction({
        ...f.journal.action("retained")!,
        worktree: { ...merged, path: `${task.tree.path}-other` },
      });
    await f.service.sweep(merged.idleSince! + 7_200_000, true);
    expect(existsSync(task.tree.path)).toBe(true);
    expect(existsSync(join(task.tree.path, "done.txt"))).toBe(true);
  },
);
