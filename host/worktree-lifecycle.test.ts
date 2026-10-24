import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { HostWorktreeLifecycle, detailedHostWorktrees } from "./worktree-lifecycle";
import { claimCheckoutResource } from "./checkout-guards";
import type { HostSession } from "../src/contracts/protocol";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "omnicode-worktree-lifecycle-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, "main"); const tree = join(root, "tree"); mkdirSync(main);
  git(main, "init"); writeFileSync(join(main, "a.txt"), "base"); git(main, "add", ".");
  git(main, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
  git(main, "worktree", "add", "-b", "topic", tree);
  const store = new HostStore(join(root, "host.db")); cleanups.push(() => store.close());
  const project = store.addProject(main, "Main");
  const session = { projectId: project.id, revision: 1, updatedAt: 1, status: "idle", archived: true,
    session: { id: "s", harness: "codex", model: "test", runtimeMode: "supervised", title: "Archived", cwd: main, executionCwd: tree, providerSessionId: "native", blocks: [] } } as HostSession;
  store.save(session, { type: "created" });
  return { root, main, tree, store, project, session, lifecycle: new HostWorktreeLifecycle(store) };
}
it("reports Git locks, changes, unpushed commits and archived session occupants", async () => {
  const { store, main, tree } = setup();
  writeFileSync(join(tree, "new.txt"), "change"); git(main, "worktree", "lock", tree);
  const listed = await detailedHostWorktrees(store, main);
  expect(listed.worktrees.find(value => value.path === tree)).toMatchObject({ locked: true, dirty: true, unpushed: 1, sessionIds: ["s"] });
});
it("checks dirty and locked working copies without changing stored sessions", async () => {
  const { lifecycle, project, main, tree, store } = setup();
  await expect(lifecycle.check(project.id, main, true)).rejects.toThrow("main working copy");
  writeFileSync(join(tree, "new.txt"), "change");
  await expect(lifecycle.check(project.id, tree, false)).rejects.toThrow("uncommitted");
  await expect(lifecycle.check(project.id, tree, true)).resolves.toBeUndefined();
  git(main, "worktree", "lock", tree);
  await expect(lifecycle.check(project.id, tree, true)).rejects.toThrow("locked");
  expect(store.session("s").revision).toBe(1);
});
it("blocks open editor/terminal resources and refuses removal with retained sessions unless requested", async () => {
  const { lifecycle, project, tree, store } = setup();
  const release = claimCheckoutResource(store, "editor:test", tree);
  await expect(lifecycle.check(project.id, tree, true)).rejects.toThrow("files and terminals");
  await expect(lifecycle.remove(project.id, tree, true, true)).rejects.toThrow("files and terminals");
  release();
  await expect(lifecycle.remove(project.id, tree, true, false)).rejects.toThrow("including archived sessions");
  expect(existsSync(tree)).toBe(true);
});
it("durably detaches archived sessions before removal and preserves the owning main project", async () => {
  const { lifecycle, project, main, tree, store } = setup();
  const removed = await lifecycle.remove(project.id, tree, false, true);
  expect(removed).toEqual({ sessionIds: ["s"], projectCwd: main });
  expect(existsSync(tree)).toBe(false);
  expect(store.session("s")).toMatchObject({ projectId: project.id, archived: true, session: { cwd: main, executionCwd: tree, worktreeRemoved: true, queueStatus: "paused" } });
  expect(store.session("s").session.providerSessionId).toBeUndefined();
});
it("moves separately registered checkout sessions into the main project and keeps SQLite ownership consistent", async () => {
  const { lifecycle, project, main, tree, store } = setup();
  const child = store.addProject(tree, "Checkout"); const value = store.session("s");
  store.save({ ...value, projectId: child.id, revision: 2, session: { ...value.session, cwd: tree } }, { type: "reassigned" });
  await lifecycle.remove(child.id, tree, false, true);
  expect(store.session("s")).toMatchObject({ projectId: project.id, session: { cwd: main } });
  expect(store.db.prepare("SELECT project_id FROM sessions WHERE id='s'").get()?.project_id).toBe(project.id);
  expect(store.summaries(child.id)).toEqual([]);
});
it("restores the original session context when Git refuses deletion", async () => {
  const { lifecycle, project, tree, store } = setup(); writeFileSync(join(tree, "new.txt"), "unsaved");
  await expect(lifecycle.remove(project.id, tree, false, true)).rejects.toThrow();
  expect(store.session("s").session).toMatchObject({ executionCwd: tree, providerSessionId: "native" });
  expect(store.session("s").session.worktreeRemoved).toBeUndefined();
  expect(store.db.prepare("SELECT key FROM metadata WHERE key LIKE 'worktree-removal:%'").all()).toEqual([]);
});
it.each([false, true])("recovers interrupted removal according to the surviving Git link (removed: %s)", async removed => {
  const { lifecycle, project, main, tree, store, session } = setup();
  store.db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run("worktree-removal:test", JSON.stringify({ projectId: project.id, path: tree, sessions: [session] }));
  store.save({ ...session, revision: 2, session: { ...session.session, worktreeRemoved: true, providerSessionId: undefined } }, { type: "detached" });
  if (removed) git(main, "worktree", "remove", tree);
  await lifecycle.recover((_id, action) => action());
  expect(store.session("s").session.worktreeRemoved).toBe(removed ? true : undefined);
  expect(store.db.prepare("SELECT key FROM metadata WHERE key LIKE 'worktree-removal:%'").all()).toEqual([]);
});
