import { testProviderCapabilities } from "./test-provider";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import {
  createHostWorktree,
  hostWorktrees,
  renameHostWorktreeBranch,
  resolveHostWorktree,
} from "./git-worktrees";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
});

it.each([[false, "oc"], [true, "oc"], [false, "mc"]] as const)("applies generated worktree names only to retained sessions (deleted: %s, prefix: %s)", async (deleted, prefix) => {
  vi.useFakeTimers();
  const cwd = mkdtempSync(join(tmpdir(), "omnicode-host-names-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd });
  git("init", "-q");
  git("checkout", "-q", "-b", "main");
  writeFileSync(join(cwd, "file.txt"), "initial\n");
  git("add", "file.txt");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-q",
    "-m",
    "initial",
  );
  const store = new HostStore(join(cwd, "host.db"));
  const title = vi.fn(async () => ({
    title: "Fix remote naming",
    workItem: null,
  }));
  let finishBranch!: (branch: string) => void;
  const branch = vi.fn(() => new Promise<string>((resolve) => { finishBranch = resolve; }));
  const engine = new HostEngine(store, {
    codex: {
      get interactionCapabilities() { return testProviderCapabilities(this); },
      send: async () => {},
      cancel: async () => {},
      stop: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
      generateBranchName: branch,
    },
  }, undefined, {
    native: { environment: { home: join(cwd, "home"), env: {} } },
  });
  vi.spyOn(engine.titleModel, "generate").mockImplementation(title);
  const project = store.addProject(cwd, "Test");
  const root = (await hostWorktrees(cwd)).defaultRoot;
  cleanups.push(async () => {
    await engine.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
  const tree = await createHostWorktree(cwd, `${prefix}/12345678`, "HEAD", false);
  const { sessionId } = engine.command({
    type: "create",
    commandId: "create-named",
    projectId: project.id,
    executionCwd: tree.path,
    autoWorktreeBranch: tree.branch!,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  engine.command({
    type: "send",
    commandId: "first",
    sessionId,
    text: "Fix remote session and worktree naming",
  });
  await vi.waitFor(() => expect(branch).toHaveBeenCalledTimes(1), { timeout: 10_000 });
  if (deleted) {
    await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 10_000 });
    store.deleteSession(sessionId);
    const logged = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      finishBranch("remote-naming");
      await vi.waitFor(() => expect(logged).toHaveBeenCalledWith("[omnicode] remote worktree branch", expect.any(Error)), { timeout: 10_000 });
      expect((await hostWorktrees(cwd)).worktrees.find((item) => item.path === tree.path)?.branch).toBe(`${prefix}/12345678`);
    } finally { logged.mockRestore(); }
    return;
  }
  await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 10_000 });
  await vi.advanceTimersByTimeAsync(15_000);
  finishBranch("remote-naming");
  await vi.waitFor(() => {
    expect(store.session(sessionId).session).toMatchObject({
      title: "codex · Fix remote naming",
      branch: "oc/remote-naming",
      executionCwd: tree.path,
    });
  }, { timeout: 10_000 });
  expect(
    (await hostWorktrees(cwd)).worktrees.find((item) => item.path === tree.path)
      ?.branch,
  ).toBe("oc/remote-naming");
  expect(title).toHaveBeenCalledTimes(1);
  expect(branch).toHaveBeenCalledTimes(1);
  engine.command({
    type: "send",
    commandId: "second",
    sessionId,
    text: "More work",
  });
  await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 10_000 });
  expect(title).toHaveBeenCalledTimes(1);
  expect(branch).toHaveBeenCalledTimes(1);
  await expect(
    renameHostWorktreeBranch(cwd, tree.path, `${prefix}/12345678`, "mc/other"),
  ).rejects.toThrow("changed");
});

it("creates registered host worktrees and binds new sessions to the selected checkout", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "omnicode-host-worktrees-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd });
  git("init", "-q");
  git("checkout", "-q", "-b", "main");
  writeFileSync(join(cwd, "file.txt"), "initial\n");
  git("add", "file.txt");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-q",
    "-m",
    "initial",
  );
  git("branch", "existing");
  const store = new HostStore(join(cwd, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      get interactionCapabilities() { return testProviderCapabilities(this); },
      send: async () => {},
      cancel: async () => {},
      stop: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = store.addProject(cwd, "Test");
  const root = (await hostWorktrees(cwd)).defaultRoot;
  cleanups.push(async () => {
    await engine.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  const tree = await createHostWorktree(cwd, "feature/task", "HEAD", false);
  expect(tree).toMatchObject({
    branch: "feature/task",
    isMain: false,
    missing: false,
  });
  // The client shows Git's own lines in the creation record.
  expect(tree.log?.some((line) => line.includes("feature/task"))).toBe(true);
  expect(resolveHostWorktree(cwd, tree.path)).toBe(tree.path);
  const listed = await hostWorktrees(cwd);
  expect(listed.worktrees.map((item) => item.branch)).toEqual([
    "main",
    "feature/task",
  ]);
  const receipt = engine.command({
    type: "create",
    commandId: "worktree-session",
    projectId: project.id,
    executionCwd: tree.path,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  expect(store.session(receipt.sessionId).session.cwd).toBe(tree.path);
  expect(() =>
    engine.command({
      type: "create",
      commandId: "outside",
      projectId: project.id,
      executionCwd: tmpdir(),
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    }),
  ).toThrow("Choose an available worktree");
  await expect(
    createHostWorktree(cwd, "feature/task", "HEAD", false),
  ).rejects.toThrow("already has a working copy");
  const existing = await createHostWorktree(cwd, "existing", "HEAD", true);
  expect(existing.branch).toBe("existing");
});
