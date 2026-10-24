import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, renameSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { HostStore } from "./store";
import { ProjectMoves } from "./project-moves";
import { SessionCheckpoints } from "./session-checkpoints";
import type { HostSession } from "../src/contracts/protocol";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "omnicode-project-moves-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const from = join(root, "old"); const to = join(root, "new");
  mkdirSync(from); writeFileSync(join(from, "a.txt"), "original");
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close());
  const project = store.addProject(from, "old");
  const session: HostSession = { projectId: project.id, revision: 1, updatedAt: 10, status: "idle",
    session: { id: "s", cwd: from, executionCwd: join(from, "sub"), harness: "codex", title: "test", model: "test",
      runtimeMode: "supervised", blocks: [], busy: false } } as HostSession;
  store.save(session, { type: "created" });
  const checkpoints = new SessionCheckpoints(join(root, "checkpoints"));
  const service = new ProjectMoves(store, checkpoints);
  return { root, from, to, store, project, checkpoints, service };
}

it("moves files and project/session projections together and syncs a new revision", async () => {
  const { from, to, store, project, service } = setup();
  expect(await service.move(project.id, to, true)).toMatchObject({ id: project.id, cwd: to });
  expect(existsSync(from)).toBe(false);
  expect(readFileSync(join(to, "a.txt"), "utf8")).toBe("original");
  expect(store.session("s")).toMatchObject({ revision: 2, session: { cwd: to, executionCwd: join(to, "sub") } });
  expect(store.db.prepare("SELECT key FROM metadata WHERE key LIKE 'project-move:%'").all()).toEqual([]);
});

it("moves nested registered projects and their sessions in the same transaction", async () => {
  const { from, to, store, project, service } = setup();
  mkdirSync(join(from, "nested"));
  const child = store.addProject(join(from, "nested"), "nested");
  const value = store.session("s");
  store.save({ ...value, projectId: child.id, session: { ...value.session, id: "child", cwd: child.cwd } }, { type: "created" });
  await service.move(project.id, to, true);
  expect(store.project(child.id).cwd).toBe(join(to, "nested"));
  expect(store.session("child").session.cwd).toBe(join(to, "nested"));
});

it("does not move a directory or record an intent while a nested Host session is running", async () => {
  const { from, to, store, project, service } = setup();
  const value = store.session("s");
  store.save({ ...value, revision: value.revision + 1, status: "running" }, { type: "running" });
  await expect(service.move(project.id, to, true)).rejects.toThrow("Wait for running host sessions");
  expect(existsSync(from)).toBe(true); expect(existsSync(to)).toBe(false);
  expect(store.db.prepare("SELECT key FROM metadata WHERE key LIKE 'project-move:%'").all()).toEqual([]);
});

it("rolls back files, checkpoint metadata and projections when SQLite rejects the commit", async () => {
  const { root, from, to, store, project, service } = setup();
  const checkpoint = join(root, "checkpoints", "s", "manifest.json");
  mkdirSync(join(root, "checkpoints", "s"), { recursive: true });
  writeFileSync(checkpoint, JSON.stringify({ cwd: from, files: {}, prepared: [] }));
  vi.spyOn(store, "save").mockImplementationOnce(() => { throw new Error("storage failed"); });
  await expect(service.move(project.id, to, true)).rejects.toThrow("storage failed");
  expect(existsSync(from)).toBe(true); expect(existsSync(to)).toBe(false);
  expect(store.project(project.id).cwd).toBe(from);
  expect(store.session("s").session.cwd).toBe(from);
  expect(JSON.parse(readFileSync(checkpoint, "utf8")).cwd).toBe(from);
});

it("finishes a crash after fs rename before loading provider bindings, idempotently", async () => {
  const { from, to, store, project, service } = setup();
  store.db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run(`project-move:${project.id}`, JSON.stringify({ projectId: project.id, from, to, rename: true }));
  renameSync(from, to);
  await service.recover((_id, action) => action());
  await service.recover((_id, action) => action());
  expect(store.project(project.id).cwd).toBe(to);
  expect(store.session("s").revision).toBe(2);
});

it("rebases externally moved directories without creating a replacement project", async () => {
  const { from, to, store, project, service } = setup();
  renameSync(from, to);
  await service.move(project.id, to, false);
  expect(store.projects()).toHaveLength(1);
  expect(store.session("s").projectId).toBe(project.id);
});

it.each([false, true])("repairs Git worktrees when their main checkout is renamed (nested: %s)", async (nested) => {
  const { root, from, to, project, service } = setup();
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  git(from, "init"); git(from, "add", ".");
  git(from, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
  const worktree = join(nested ? from : root, "worktree");
  git(from, "worktree", "add", "-b", "topic", worktree);
  await service.move(project.id, to, true);
  const movedWorktree = nested ? join(to, "worktree") : worktree;
  expect(git(movedWorktree, "rev-parse", "--show-toplevel").trim().replaceAll("\\", "/")).toBe(movedWorktree.replaceAll("\\", "/"));
  expect(git(movedWorktree, "status", "--porcelain")).toBe("");
});
