import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { HostSession } from "../src/features/connections/model/protocol";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../src/features/orchestration/model/orchestrationState";
import { HostOrchestrationWorkspace } from "./orchestration-workspace";
import { claimCheckoutResource, claimCheckoutWrite } from "./checkout-guards";
import { HostStore } from "./store";

const cleanups: Array<() => void> = [];
const filesystem = vi.hoisted(() => ({
  onIntegrationTemporary: undefined as undefined | ((path: string) => void),
}));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      if (String(args[0]).includes(".omnicode-integrate-"))
        filesystem.onIntegrationTemporary?.(String(args[0]));
      return file;
    },
  };
});
afterEach(() => {
  filesystem.onIntegrationTemporary = undefined;
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

it("blocks a native-style save after preflight while retaining the mounted lead editor", async () => {
  const f = fixture();
  const worker = await f.prepare();
  writeFileSync(join(worker, "a.txt"), "worker result\n");
  await f.workspace.captureWorker(f.run, f.task);
  const editor = claimCheckoutResource(
    f.store,
    "editor:lead",
    join(f.cwd, "a.txt"),
  );
  let attempted = false;
  filesystem.onIntegrationTemporary = (path) => {
    if (!path.startsWith(f.cwd)) return;
    attempted = true;
    expect(() =>
      claimCheckoutWrite(f.store, "native:save", join(f.cwd, "a.txt")),
    ).toThrow("receiving an accepted result");
  };
  await f.workspace.integrateWorker(f.run, f.task);
  expect(attempted).toBe(true);
  expect(readFileSync(join(f.cwd, "a.txt"), "utf8")).toBe("worker result\n");
  const save = claimCheckoutWrite(f.store, "native:save", join(f.cwd, "a.txt"));
  writeFileSync(join(f.cwd, "a.txt"), "user buffer\n");
  save();
  editor();
  expect(readFileSync(join(f.cwd, "a.txt"), "utf8")).toBe("user buffer\n");
});

it("excludes supported saves while seeding the worker checkout", async () => {
  const f = fixture();
  writeFileSync(join(f.cwd, "a.txt"), "dirty lead\n");
  let attempted = false;
  filesystem.onIntegrationTemporary = (path) => {
    attempted = true;
    expect(() =>
      claimCheckoutWrite(
        f.store,
        "native:seed-save",
        join(dirname(path), "a.txt"),
      ),
    ).toThrow("receiving an accepted result");
  };
  const worker = await f.prepare();
  expect(attempted).toBe(true);
  expect(readFileSync(join(worker, "a.txt"), "utf8")).toBe("dirty lead\n");
});

it("captures with mounted buffers but retains an in-progress native save for retry", async () => {
  const f = fixture();
  const worker = await f.prepare();
  const editor = claimCheckoutResource(
    f.store,
    "editor:worker",
    join(worker, "a.txt"),
  );
  const save = claimCheckoutWrite(
    f.store,
    "native:worker-save",
    join(worker, "a.txt"),
  );
  writeFileSync(join(worker, "a.txt"), "manual worker edit\n");
  await expect(f.workspace.captureWorker(f.run, f.task)).rejects.toThrow(
    "being changed",
  );
  expect(JSON.parse(readFileSync(f.manifest, "utf8")).after).toBeUndefined();
  save();
  expect((await f.workspace.captureWorker(f.run, f.task)).files).toEqual([
    "a.txt",
  ]);
  expect(readFileSync(join(worker, "a.txt"), "utf8")).toBe(
    "manual worker edit\n",
  );
  editor();
});

it("rechecks the exact target after preflight and retains an outside writer's changed bytes", async () => {
  const f = fixture();
  const worker = await f.prepare();
  writeFileSync(join(worker, "a.txt"), "worker result\n");
  await f.workspace.captureWorker(f.run, f.task);
  filesystem.onIntegrationTemporary = (path) => {
    if (path.startsWith(f.cwd))
      writeFileSync(join(f.cwd, "a.txt"), "outside edit\n");
  };
  await expect(f.workspace.integrateWorker(f.run, f.task)).rejects.toThrow(
    "changed before the result was written",
  );
  expect(readFileSync(join(f.cwd, "a.txt"), "utf8")).toBe("outside edit\n");
  expect(existsSync(worker)).toBe(true);
  expect(
    f.store.db
      .prepare("SELECT * FROM checkout_resources WHERE kind='integrating'")
      .all(),
  ).toEqual([]);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omnicode-orchestration-git-"));
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  // Tests with LF fixtures must not inherit a user's Windows autocrlf setting.
  // The dedicated filter test below explicitly enables its own configuration.
  git("config", "core.autocrlf", "false");
  git("checkout", "-q", "-b", "main");
  for (const name of ["a.txt", "b.txt", "delete.txt"])
    writeFileSync(join(cwd, name), `${name}: base\n`);
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\ncache/\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "base",
  );
  const store = new HostStore(join(root, "host.db"));
  const project = store.addProject(cwd, "Test");
  const workspace = new HostOrchestrationWorkspace(store);
  const task: OrchestrationTask = {
    id: "task1234567890",
    sessionId: "worker123",
    title: "Worker",
    harness: "codex",
    model: "codex:test",
    prompt: "Work",
    files: ["."],
    scopes: [cwd],
    dependsOn: [],
    status: "queued",
    accepted: false,
    result: "",
    delivered: false,
    workspacePolicy: "isolated-child",
  };
  const run: OrchestrationRun = {
    version: 2,
    leadId: "lead123",
    cwd,
    status: "active",
    allowedHarnesses: ["codex"],
    maxWorkers: 2,
    cli: "",
    tasks: [task],
    continuations: 0,
    requests: {},
  };
  const saveWorker = (
    id = task.sessionId,
    path = task.workspace!.checkoutCwd,
  ) => {
    const value: HostSession = {
      projectId: project.id,
      revision: 1,
      status: "idle",
      updatedAt: 1,
      session: {
        id,
        title: "Worker",
        cwd: path,
        harness: "codex",
        model: "codex:test",
        modelSettings: {},
        runtimeMode: "supervised",
        blocks: [],
        executionCwd: path,
        providerSessionId: "native-123",
      },
    };
    store.save(value, { type: "test" });
    return value;
  };
  const prepare = async () => {
    const result = await workspace.createWorker(run, task);
    task.workspace = result.workspace;
    task.scratchDir = result.scratchDir;
    return result.workspace.checkoutCwd;
  };
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    cwd,
    git,
    store,
    workspace,
    run,
    task,
    prepare,
    saveWorker,
    manifest: join(
      root,
      "orchestration-workers",
      task.sessionId,
      "manifest.json",
    ),
  };
}

it("seeds actual staged/unstaged/untracked/deleted bytes without copying ignored lead artifacts", async () => {
  const f = fixture();
  writeFileSync(join(f.cwd, "a.txt"), "staged\n");
  f.git("add", "a.txt");
  writeFileSync(join(f.cwd, "a.txt"), "actual dirty bytes\r\n");
  rmSync(join(f.cwd, "delete.txt"));
  writeFileSync(join(f.cwd, "untracked.bin"), Buffer.from([0, 255, 3]));
  mkdirSync(join(f.cwd, "node_modules"));
  // The seed must not walk ignored installations at all, even ones exceeding
  // the worker verification bound.
  for (let i = 0; i < 20_001; i++)
    writeFileSync(join(f.cwd, "node_modules", `${i}.js`), "");
  const worker = await f.prepare();
  expect(readFileSync(join(worker, "a.txt"), "utf8")).toBe(
    "actual dirty bytes\r\n",
  );
  expect(readFileSync(join(worker, "untracked.bin"))).toEqual(
    Buffer.from([0, 255, 3]),
  );
  expect(existsSync(join(worker, "delete.txt"))).toBe(false);
  expect(existsSync(join(worker, "node_modules"))).toBe(false);
  expect(f.git("show", ":a.txt")).toBe("staged");
  expect(await f.workspace.captureWorker(f.run, f.task)).toEqual({ files: [] });
  expect(await f.workspace.cleanupWorker(f.run, f.task, true)).toBe(true);
  expect(readFileSync(join(f.cwd, "node_modules/123.js"), "utf8")).toBe("");
}, 20_000);

it("captures opaque shell and ignored additions, retains violations, then reuses corrected scopes", async () => {
  const f = fixture();
  f.task.files = ["a.txt"];
  const worker = await f.prepare();
  execFileSync(
    process.execPath,
    [
      "-e",
      "require('fs').mkdirSync('cache'); require('fs').writeFileSync('cache/shell.bin', Buffer.from([0,255,10]));",
    ],
    { cwd: worker },
  );
  await expect(f.workspace.captureWorker(f.run, f.task)).rejects.toThrow(
    "outside its assignment",
  );
  await expect(f.workspace.integrateWorker(f.run, f.task)).rejects.toThrow(
    "outside its assignment",
  );
  expect(await f.workspace.cleanupWorker(f.run, f.task, true)).toBe(false);
  f.task.files = ["cache"];
  expect(
    (await f.workspace.createWorker(f.run, f.task)).workspace.checkoutCwd,
  ).toBe(worker);
  expect(await f.workspace.captureWorker(f.run, f.task)).toEqual({
    files: ["cache/shell.bin"],
  });
  await f.workspace.integrateWorker(f.run, f.task);
  expect(readFileSync(join(f.cwd, "cache/shell.bin"))).toEqual(
    Buffer.from([0, 255, 10]),
  );
});

it("preserves cumulative multi-turn binary, mode and deletion deltas and integrates them idempotently", async () => {
  const f = fixture();
  const worker = await f.prepare();
  writeFileSync(join(worker, "a.txt"), "turn one\n");
  await f.workspace.captureWorker(f.run, f.task);
  await f.workspace.createWorker(f.run, f.task);
  writeFileSync(join(worker, "b.txt"), Buffer.from([0, 255, 1, 128]));
  rmSync(join(worker, "delete.txt"));
  if (process.platform !== "win32") chmodSync(join(worker, "a.txt"), 0o755);
  expect((await f.workspace.captureWorker(f.run, f.task)).files).toEqual([
    "a.txt",
    "b.txt",
    "delete.txt",
  ]);
  expect(await f.workspace.integrateWorker(f.run, f.task)).toEqual({
    files: ["a.txt", "b.txt", "delete.txt"],
    alreadyApplied: 0,
  });
  expect(readFileSync(join(f.cwd, "a.txt"), "utf8")).toBe("turn one\n");
  expect(readFileSync(join(f.cwd, "b.txt"))).toEqual(
    Buffer.from([0, 255, 1, 128]),
  );
  expect(existsSync(join(f.cwd, "delete.txt"))).toBe(false);
  if (process.platform !== "win32")
    expect(statSync(join(f.cwd, "a.txt")).mode & 0o777).toBe(0o755);
  expect(
    (await f.workspace.integrateWorker(f.run, f.task)).alreadyApplied,
  ).toBe(3);
  // An accepted retained worker can run a later correction from its result.
  await f.workspace.createWorker(f.run, f.task);
  writeFileSync(join(worker, "a.txt"), "correction\n");
  expect((await f.workspace.captureWorker(f.run, f.task)).files).toEqual([
    "a.txt",
  ]);
  await f.workspace.integrateWorker(f.run, f.task);
  expect(readFileSync(join(f.cwd, "a.txt"), "utf8")).toBe("correction\n");
});

it("preflights every target before writing and preserves conflicts and unrelated lead files", async () => {
  const f = fixture();
  const worker = await f.prepare();
  writeFileSync(join(worker, "a.txt"), "worker a\n");
  writeFileSync(join(worker, "b.txt"), "worker b\n");
  await f.workspace.captureWorker(f.run, f.task);
  writeFileSync(join(f.cwd, "b.txt"), "concurrent user edit\n");
  await expect(f.workspace.integrateWorker(f.run, f.task)).rejects.toThrow(
    "lead checkout changed",
  );
  expect(readFileSync(join(f.cwd, "a.txt"), "utf8")).toBe("a.txt: base\n");
  expect(readFileSync(join(f.cwd, "b.txt"), "utf8")).toBe(
    "concurrent user edit\n",
  );
  await expect(f.workspace.cleanupWorker(f.run, f.task, false)).rejects.toThrow(
    "lead checkout changed",
  );
  expect(existsSync(worker)).toBe(true);
});

it("recovers a partial exact integration after Host restart", async () => {
  const f = fixture();
  const worker = await f.prepare();
  writeFileSync(join(worker, "a.txt"), "after a\n");
  writeFileSync(join(worker, "b.txt"), "after b\n");
  await f.workspace.captureWorker(f.run, f.task);
  // Simulate a crash after the first atomic write but before the second.
  writeFileSync(join(f.cwd, "a.txt"), "after a\n");
  const recovered = new HostOrchestrationWorkspace(f.store);
  expect(await recovered.integrateWorker(f.run, f.task)).toEqual({
    files: ["a.txt", "b.txt"],
    alreadyApplied: 1,
  });
  expect(readFileSync(join(f.cwd, "b.txt"), "utf8")).toBe("after b\n");
});

it("rejects uncaptured changes, index/branch movement and another assignment without deleting them", async () => {
  const f = fixture();
  const worker = await f.prepare();
  writeFileSync(join(worker, "a.txt"), "uncaptured\n");
  await expect(f.workspace.createWorker(f.run, f.task)).rejects.toThrow(
    "uncaptured",
  );
  await f.workspace.captureWorker(f.run, f.task);
  await expect(
    f.workspace.integrateWorker({ ...f.run, leadId: "other" }, f.task),
  ).rejects.toThrow("another assignment");
  execFileSync("git", ["add", "a.txt"], { cwd: worker });
  await expect(f.workspace.captureWorker(f.run, f.task)).rejects.toThrow(
    "Git index",
  );
  await expect(f.workspace.cleanupWorker(f.run, f.task, false)).rejects.toThrow(
    "Git index",
  );
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "user commit",
    ],
    { cwd: worker },
  );
  await expect(f.workspace.cleanupWorker(f.run, f.task, false)).rejects.toThrow(
    "moved or is missing",
  );
  expect(existsSync(worker)).toBe(true);
});

it("holds cleanup for native editors, provider resources and foreign conversations, then detaches retained history", async () => {
  const f = fixture();
  const worker = await f.prepare();
  f.saveWorker();
  writeFileSync(join(worker, "a.txt"), "accepted\n");
  await f.workspace.captureWorker(f.run, f.task);
  await f.workspace.integrateWorker(f.run, f.task);
  const release = claimCheckoutResource(
    f.store,
    "editor:test",
    join(worker, "a.txt"),
  );
  await expect(f.workspace.cleanupWorker(f.run, f.task, false)).rejects.toThrow(
    "Close files and terminals",
  );
  release();
  f.saveWorker("foreign", join(worker, "nested"));
  await expect(f.workspace.cleanupWorker(f.run, f.task, false)).rejects.toThrow(
    "Another conversation",
  );
  f.store.deleteSession("foreign");
  expect(await f.workspace.cleanupWorker(f.run, f.task, false)).toBe(true);
  expect(existsSync(worker)).toBe(false);
  expect(f.git("branch", "--list", f.task.workspace!.branch!)).toBe("");
  expect(f.store.session(f.task.sessionId).session).toMatchObject({
    cwd: f.cwd,
    executionCwd: worker,
    worktreeRemoved: true,
  });
  expect(
    f.store.session(f.task.sessionId).session.providerSessionId,
  ).toBeUndefined();
});

it("recovers cleanup journal references only when the checkout still exists and never resurrects deleted sessions", async () => {
  const f = fixture();
  const worker = await f.prepare();
  const previous = f.saveWorker();
  f.store.save(
    {
      ...previous,
      revision: 2,
      session: { ...previous.session, cwd: f.cwd, worktreeRemoved: true },
    },
    {},
  );
  f.store.db
    .prepare("INSERT INTO checkout_cleanup VALUES (?, ?, ?)")
    .run(f.task.sessionId, worker, JSON.stringify(previous));
  new HostOrchestrationWorkspace(f.store);
  expect(f.store.session(f.task.sessionId).session.cwd).toBe(worker);
  f.store.deleteSession(f.task.sessionId);
  f.store.db
    .prepare("INSERT INTO checkout_cleanup VALUES (?, ?, ?)")
    .run(f.task.sessionId, worker, JSON.stringify(previous));
  new HostOrchestrationWorkspace(f.store);
  expect(() => f.store.session(f.task.sessionId)).toThrow("Session not found");
  expect(f.store.db.prepare("SELECT * FROM checkout_cleanup").all()).toEqual(
    [],
  );
});

it("serializes duplicate preparation and safely repairs a partially seeded checkout", async () => {
  const f = fixture();
  writeFileSync(join(f.cwd, "a.txt"), "dirty seed\n");
  const results = await Promise.all([
    f.workspace.createWorker(f.run, f.task),
    f.workspace.createWorker(f.run, f.task),
  ]);
  expect(results[0].workspace).toEqual(results[1].workspace);
  f.task.workspace = results[0].workspace;
  const manifest = JSON.parse(readFileSync(f.manifest, "utf8"));
  manifest.seeded = false;
  writeFileSync(f.manifest, JSON.stringify(manifest));
  writeFileSync(join(f.task.workspace.checkoutCwd, "a.txt"), "a.txt: base\n");
  await new HostOrchestrationWorkspace(f.store).createWorker(f.run, f.task);
  expect(
    readFileSync(join(f.task.workspace.checkoutCwd, "a.txt"), "utf8"),
  ).toBe("dirty seed\n");
});

it("refuses to adopt an existing temporary branch", async () => {
  const f = fixture();
  f.git("branch", "mc/orch-task12345678");
  await expect(f.prepare()).rejects.toThrow("already exists");
  expect(f.git("branch", "--list", "mc/orch-task12345678")).toContain(
    "mc/orch-task12345678",
  );
});

it("retains unexpected deletions during an interrupted seed", async () => {
  const f = fixture();
  writeFileSync(join(f.cwd, "a.txt"), "dirty seed\n");
  const worker = await f.prepare();
  const manifest = JSON.parse(readFileSync(f.manifest, "utf8"));
  manifest.seeded = false;
  writeFileSync(f.manifest, JSON.stringify(manifest));
  rmSync(join(worker, "a.txt"));
  await expect(
    new HostOrchestrationWorkspace(f.store).createWorker(f.run, f.task),
  ).rejects.toThrow("unexpected changes in a.txt");
  expect(existsSync(join(worker, "a.txt"))).toBe(false);
  expect(existsSync(worker)).toBe(true);
});

it("seeds exact lead bytes when Git autocrlf changes pristine checkout bytes", async () => {
  const f = fixture();
  f.git("config", "core.autocrlf", "true");
  writeFileSync(join(f.cwd, "a.txt"), "dirty lead\r\n");
  const worker = await f.prepare();
  expect(readFileSync(join(worker, "a.txt"), "utf8")).toBe("dirty lead\r\n");
  expect(readFileSync(join(worker, "b.txt"), "utf8")).toBe("b.txt: base\n");
  expect((await f.workspace.captureWorker(f.run, f.task)).files).toEqual([]);
});

it.skipIf(process.platform === "win32")(
  "refuses changed symlinks and symlink target replacement without touching outside files",
  async () => {
    const f = fixture();
    const worker = await f.prepare();
    const external = join(f.root, "outside.txt");
    writeFileSync(external, "external\n");
    symlinkSync(external, join(worker, "new-link"));
    await expect(f.workspace.captureWorker(f.run, f.task)).rejects.toThrow(
      "unsupported file type",
    );
    rmSync(join(worker, "new-link"));
    writeFileSync(join(worker, "a.txt"), "worker\n");
    await f.workspace.captureWorker(f.run, f.task);
    rmSync(join(f.cwd, "a.txt"));
    symlinkSync(external, join(f.cwd, "a.txt"));
    await expect(f.workspace.integrateWorker(f.run, f.task)).rejects.toThrow(
      "link or non-directory",
    );
    expect(readFileSync(external, "utf8")).toBe("external\n");
  },
);
