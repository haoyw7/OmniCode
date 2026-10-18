import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SessionCheckpoints } from "./session-checkpoints";

// Ports of the desktop store's turn tests (src-tauri/src/checkpoint/turn/tests.rs).
const cleanups: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "monocode-turn-test-"));
  cleanups.push(dir);
  const repo = join(dir, "repo");
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo }).toString();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repo, "a.txt"), "original\n");
  writeFileSync(join(repo, "delete.txt"), "remove me\n");
  git("add", ".");
  git("commit", "-q", "-m", "initial");
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const data = join(dir, "checkpoints");
  return { dir, repo, data, git, write, store: new SessionCheckpoints(data) };
}

it("records shell changes and preserves the index, HEAD and saved result", async () => {
  const f = fixture();
  f.write("a.txt", "user change\n");
  f.write("user.txt", "existing untracked work\n");
  f.git("add", "a.txt");
  const index = readFileSync(join(f.repo, ".git/index"));
  const head = f.git("rev-parse", "HEAD");
  await f.store.beginTurn("session", f.repo, "first");
  // No structured edit events: the actual file state is authoritative.
  f.write("a.txt", "user change\nagent change\n");
  f.write("new.txt", "one\ntwo\n");
  unlinkSync(join(f.repo, "delete.txt"));
  await f.store.finishTurn("session", f.repo, "first");
  const status = await f.store.status("session", f.repo);
  expect(status.files.map((file) => file.relative)).toEqual(["a.txt", "delete.txt", "new.txt"]);
  expect([status.files[0].additions, status.files[0].deletions]).toEqual([1, 0]);
  expect(status.files.every((file) => file.exact && file.undoable)).toBe(true);
  expect(readFileSync(join(f.repo, ".git/index")).equals(index)).toBe(true);
  expect(f.git("rev-parse", "HEAD")).toBe(head);

  f.write("a.txt", "a later editor change\n");
  // A reopened store never reads later contents as this turn's result.
  const reopened = new SessionCheckpoints(f.data);
  expect(await reopened.fileDiff("session", f.repo, "a.txt")).toMatchObject({
    original: "user change\n",
    current: "user change\nagent change\n",
  });
  expect((await reopened.status("session", f.repo)).files[0]).toMatchObject({ exact: true, undoable: false });
  await expect(reopened.undo("session", f.repo)).rejects.toThrow();
  expect(existsSync(join(f.repo, "new.txt"))).toBe(true);
});

it("gives each turn a fresh baseline and clears the old card after a no-op turn", async () => {
  const f = fixture();
  await f.store.beginTurn("session", f.repo, "first");
  f.write("a.txt", "first turn\n");
  await f.store.finishTurn("session", f.repo, "first");
  f.write("a.txt", "external edit between turns\n");
  await f.store.beginTurn("session", f.repo, "second");
  f.write("a.txt", "external edit between turns\nsecond turn\n");
  await f.store.finishTurn("session", f.repo, "second");
  expect(await f.store.fileDiff("session", f.repo, "a.txt")).toMatchObject({
    original: "external edit between turns\n",
    current: "external edit between turns\nsecond turn\n",
  });
  await f.store.beginTurn("session", f.repo, "third");
  await f.store.finishTurn("session", f.repo, "third");
  expect((await f.store.status("session", f.repo)).files).toEqual([]);
  expect(existsSync(join(f.data, "session/turns/first.json"))).toBe(true);
});

it("continues an unfinished turn from its baseline including shared workspace changes", async () => {
  const f = fixture();
  await f.store.beginTurn("session", f.repo, "first");
  await f.store.beginTurn("other", f.repo, "other");
  f.write("a.txt", "session edit\n");
  await f.store.capture("session", f.repo, ["a.txt"]);
  f.write("foreign.txt", "other session\n");
  const reopened = new SessionCheckpoints(f.data);
  await reopened.beginTurn("session", f.repo, "continue");
  await reopened.finishTurn("session", f.repo, "continue");
  const status = await reopened.status("session", f.repo);
  expect(status.files.map(({ relative, undoable }) => ({ relative, undoable }))).toEqual([
    { relative: "a.txt", undoable: false },
    { relative: "foreign.txt", undoable: false },
  ]);
  expect(status.workspaceShared).toBe(true);
  expect(await reopened.fileDiff("session", f.repo, "a.txt")).toMatchObject({
    original: "original\n",
    current: "session edit\n",
  });
});

it("shared turns review the whole workspace without edit events and cannot undo", async () => {
  const f = fixture();
  await f.store.beginTurn("reader", f.repo, "first");
  await f.store.beginTurn("writer", f.repo, "second");
  f.write("a.txt", "edited by the writer\n");
  // Shell/Python writes need not report a structured edit event.
  // A prepared edit is not evidence that the reader changed a file.
  await f.store.prepare("reader", f.repo, [join(f.repo, "a.txt")]);
  await f.store.finishTurn("reader", f.repo, "first");
  await f.store.finishTurn("writer", f.repo, "second");

  for (const session of ["reader", "writer"]) {
    const status = await f.store.status(session, f.repo);
    expect(status.workspaceShared).toBe(true);
    expect(status.files.map(({ relative, undoable }) => ({ relative, undoable }))).toEqual([
      { relative: "a.txt", undoable: false },
    ]);
    await expect(f.store.undo(session, f.repo)).rejects.toThrow(/shared/);
  }
});

it("treats dot-prefixed subfolders as overlapping and accepts their absolute edit paths", async () => {
  const f = fixture();
  const path = "..notes/a.txt";
  f.write(path, "original nested\n");
  await f.store.beginTurn("parent", f.repo, "first");
  await f.store.beginTurn("nested", join(f.repo, "..notes"), "second");
  f.write(path, "shared nested\n");
  await f.store.capture("parent", f.repo, [join(f.repo, path)]);
  await f.store.capture("nested", join(f.repo, "..notes"), ["a.txt"]);
  await f.store.finishTurn("parent", f.repo, "first");
  await f.store.finishTurn("nested", join(f.repo, "..notes"), "second");
  for (const [session, cwd, relative] of [
    ["parent", f.repo, path],
    ["nested", join(f.repo, "..notes"), "a.txt"],
  ]) {
    expect((await f.store.status(session, cwd)).files).toMatchObject([{ relative, exact: true, undoable: false }]);
    await expect(f.store.undo(session, cwd)).rejects.toThrow(/shared/);
  }
});

it("undo restores only recorded files, keep retains history and forget removes refs", async () => {
  const f = fixture();
  f.write("user.txt", "user baseline\n");
  await f.store.beginTurn("session", f.repo, "first");
  f.write("a.txt", "agent\n");
  f.write("user.txt", "user baseline\nagent addition\n");
  f.write("new.txt", "created\n");
  unlinkSync(join(f.repo, "delete.txt"));
  await f.store.finishTurn("session", f.repo, "first");
  f.write("unrelated.txt", "later work\n");
  const index = readFileSync(join(f.repo, ".git/index"));
  await f.store.keep("session", f.repo, "a.txt");
  await f.store.undo("session", f.repo);
  expect(readFileSync(join(f.repo, "a.txt"), "utf8")).toBe("agent\n");
  expect(readFileSync(join(f.repo, "user.txt"), "utf8")).toBe("user baseline\n");
  expect(readFileSync(join(f.repo, "delete.txt"), "utf8")).toBe("remove me\n");
  expect(existsSync(join(f.repo, "unrelated.txt"))).toBe(true);
  expect(existsSync(join(f.repo, "new.txt"))).toBe(false);
  expect((await f.store.status("session", f.repo)).files).toEqual([]);
  expect(readFileSync(join(f.repo, ".git/index")).equals(index)).toBe(true);
  await f.store.forget("session");
  expect(f.git("for-each-ref", "refs/monocode/checkpoints/session/")).toBe("");
});

it("incomplete and failed turns never fall back to the previous result", async () => {
  const f = fixture();
  await f.store.beginTurn("session", f.repo, "first");
  f.write("a.txt", "first\n");
  await f.store.finishTurn("session", f.repo, "first");
  await f.store.beginTurn("session", f.repo, "second");
  await expect(f.store.status("session", f.repo)).rejects.toThrow(/without a final/);
  // A stale completion must not settle the newer turn.
  await f.store.finishTurn("session", f.repo, "first");
  await expect(f.store.status("session", f.repo)).rejects.toThrow();
  f.git("config", "core.sparseCheckout", "true");
  await expect(f.store.finishTurn("session", f.repo, "second")).rejects.toThrow();
  await expect(f.store.status("session", f.repo)).rejects.toThrow(/sparse/);
});

it("commits after the turn clear modified, created and deleted files", async () => {
  const f = fixture();
  await f.store.beginTurn("session", f.repo, "first");
  f.write("a.txt", "agent change\n");
  f.write("new.txt", "new file\n");
  unlinkSync(join(f.repo, "delete.txt"));
  await f.store.finishTurn("session", f.repo, "first");
  expect((await f.store.status("session", f.repo)).files).toHaveLength(3);
  f.write("a.txt", "agent change\nuser addition\n");
  f.git("add", "-A");
  f.git("commit", "-q", "-m", "accept changes");
  expect((await f.store.status("session", f.repo)).files).toEqual([]);
  expect((await f.store.fileDiff("session", f.repo, "a.txt")).current).toBe("agent change\n");
});

it("keeps structured-edit review for folders without Git under a Chinese locale", async () => {
  vi.stubEnv("LC_ALL", "zh_CN.UTF-8");
  vi.stubEnv("LANGUAGE", "zh_CN");
  const dir = mkdtempSync(join(tmpdir(), "monocode-turn-nongit-"));
  cleanups.push(dir);
  const cwd = join(dir, "project");
  mkdirSync(cwd);
  const store = new SessionCheckpoints(join(dir, "checkpoints"));
  await store.beginTurn("session", cwd, "first");
  const prepared = store.prepare("session", cwd, [join(cwd, "new.txt")]);
  writeFileSync(join(cwd, "new.txt"), "hello\n");
  await prepared;
  await store.capture("session", cwd, ["new.txt"]);
  await store.finishTurn("session", cwd, "first");
  expect((await store.status("session", cwd)).files.map((file) => file.relative)).toEqual(["new.txt"]);
});
