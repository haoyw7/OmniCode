import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SessionCheckpoints } from "./session-checkpoints";

const cleanups: string[] = [];
afterEach(() => {
  // Windows may briefly hold a just-written temp folder open; leaking one
  // temporary directory must not fail an otherwise passing test.
  for (const dir of cleanups.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; }
  }
});

/** A folder without Git: structured edits are the only review source. */
function folder() {
  const cwd = mkdtempSync(join(tmpdir(), "omnicode-checkpoint-folder-"));
  const data = mkdtempSync(join(tmpdir(), "omnicode-checkpoint-data-"));
  cleanups.push(cwd, data);
  writeFileSync(join(cwd, "a.txt"), "one\ntwo\n");
  return { cwd, data, store: new SessionCheckpoints(data) };
}

/** One structured edit: the tool starts, writes, then completes. */
async function edit(store: SessionCheckpoints, id: string, cwd: string, file: string, contents: string | null) {
  const prepared = store.prepare(id, cwd, [join(cwd, file)]);
  if (contents === null) rmSync(join(cwd, file));
  else writeFileSync(join(cwd, file), contents);
  await prepared;
  await store.capture(id, cwd, [file]);
}

/** A complete provider turn: the only boundary Undo trusts. */
async function turn(store: SessionCheckpoints, id: string, cwd: string, turnId: string, body: () => Promise<void>) {
  await store.ensure(id, cwd);
  await store.beginTurn(id, cwd, turnId);
  await body();
  await store.finishTurn(id, cwd, turnId);
}

it("reviews and undoes a session's modified, added and deleted files", async () => {
  const { cwd, store } = folder();
  writeFileSync(join(cwd, "gone.txt"), "keep me\n");
  await turn(store, "s1", cwd, "t1", async () => {
    await edit(store, "s1", cwd, "a.txt", "one\nchanged\nthree\n");
    await edit(store, "s1", cwd, "new.txt", "hello\n");
    await edit(store, "s1", cwd, "gone.txt", null);
  });

  const status = await store.status("s1", cwd);
  expect(status.turnId).toBe("t1");
  expect(status.files.map(({ relative, status, additions, deletions, undoable }) =>
    ({ relative, status, additions, deletions, undoable }))).toEqual([
    { relative: "a.txt", status: "modified", additions: 2, deletions: 1, undoable: true },
    { relative: "gone.txt", status: "deleted", additions: 0, deletions: 1, undoable: true },
    { relative: "new.txt", status: "added", additions: 1, deletions: 0, undoable: true },
  ]);
  expect(await store.fileDiff("s1", cwd, "a.txt")).toMatchObject({
    original: "one\ntwo\n",
    current: "one\nchanged\nthree\n",
    binary: false,
  });

  expect(await store.undo("s1", cwd)).toEqual({ files: [] });
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("one\ntwo\n");
  expect(readFileSync(join(cwd, "gone.txt"), "utf8")).toBe("keep me\n");
  expect(existsSync(join(cwd, "new.txt"))).toBe(false);
  expect((await store.status("s1", cwd)).files).toEqual([]);
});

it("reviews only the real edit when an editor also rewrites LF as CRLF", async () => {
  const { cwd, store } = folder();
  await turn(store, "s1", cwd, "t1", () => edit(store, "s1", cwd, "a.txt", "one\r\ntwo\r\nthree\r\n"));

  expect((await store.status("s1", cwd)).files[0]).toMatchObject({ additions: 1, deletions: 0 });
  expect(await store.fileDiff("s1", cwd, "a.txt")).toMatchObject({
    original: "one\ntwo\n",
    current: "one\ntwo\nthree\n",
  });
  await store.undo("s1", cwd);
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("one\ntwo\n");
});

it("refuses to undo a file changed outside the session", async () => {
  const { cwd, store } = folder();
  await turn(store, "s1", cwd, "t1", () => edit(store, "s1", cwd, "a.txt", "agent\n"));
  writeFileSync(join(cwd, "a.txt"), "user\n");

  expect((await store.status("s1", cwd)).files[0]).toMatchObject({ relative: "a.txt", undoable: false });
  await expect(store.undo("s1", cwd)).rejects.toThrow(/changed outside this session/);
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("user\n");
});

it("keeps review but refuses undo for snapshots without one verified turn", async () => {
  const { cwd, store } = folder();
  await turn(store, "s1", cwd, "t1", () => edit(store, "s1", cwd, "a.txt", "first\n"));
  await turn(store, "s1", cwd, "t2", () => edit(store, "s1", cwd, "b.txt", "second\n"));
  const status = await store.status("s1", cwd);
  expect(status.turnId).toBeUndefined();
  expect(status.undoUnavailableReason).toMatch(/several conversation turns/);
  expect(status.files.map(file => file.relative)).toEqual(["a.txt", "b.txt"]);
  await expect(store.prepareUndo("s1", cwd)).rejects.toThrow(/single-turn/);
  expect(await store.fileDiff("s1", cwd, "a.txt")).toMatchObject({ original: "one\ntwo\n", current: "first\n" });
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("first\n");
  expect(readFileSync(join(cwd, "b.txt"), "utf8")).toBe("second\n");

  // An unfinished turn has no settled boundary either.
  const other = folder();
  await other.store.ensure("s2", other.cwd);
  await other.store.beginTurn("s2", other.cwd, "t1");
  await edit(other.store, "s2", other.cwd, "a.txt", "running\n");
  expect(await other.store.status("s2", other.cwd)).toMatchObject({ undoUnavailableReason: expect.stringMatching(/no verified/) });
  await expect(other.store.prepareUndo("s2", other.cwd)).rejects.toThrow(/single-turn/);
});

it("resumes a durable plan after restart, accepting files already restored", async () => {
  const { cwd, data, store } = folder();
  await turn(store, "s1", cwd, "t1", async () => {
    await edit(store, "s1", cwd, "a.txt", "agent\n");
    await edit(store, "s1", cwd, "new.txt", "created\n");
  });
  const prepared = await store.prepareUndo("s1", cwd);
  // A previous attempt restored one file before the Host stopped.
  writeFileSync(join(cwd, "a.txt"), "one\ntwo\n");
  const restarted = new SessionCheckpoints(data);
  expect(await restarted.applyUndo(prepared)).toEqual({ files: [] });
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("one\ntwo\n");
  expect(existsSync(join(cwd, "new.txt"))).toBe(false);
  // The recorded result makes a repeated apply a no-op.
  writeFileSync(join(cwd, "a.txt"), "later\n");
  expect(await restarted.applyUndo(prepared)).toEqual({ files: [] });
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("later\n");
  await restarted.discardUndo(prepared);
  await expect(restarted.applyUndo(prepared)).rejects.toThrow();
});

it("refuses a retry when any file is in a third state, without writing others", async () => {
  const { cwd, store } = folder();
  await turn(store, "s1", cwd, "t1", async () => {
    await edit(store, "s1", cwd, "a.txt", "agent\n");
    await edit(store, "s1", cwd, "new.txt", "created\n");
  });
  const prepared = await store.prepareUndo("s1", cwd);
  writeFileSync(join(cwd, "new.txt"), "someone else\n");
  await expect(store.applyUndo(prepared)).rejects.toThrow(/changed after the checkpoint/);
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("agent\n");
  expect(readFileSync(join(cwd, "new.txt"), "utf8")).toBe("someone else\n");
  // Once the file is back at its recorded result, the same plan completes.
  writeFileSync(join(cwd, "new.txt"), "created\n");
  await store.applyUndo(prepared);
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("one\ntwo\n");
  expect(existsSync(join(cwd, "new.txt"))).toBe(false);
});

it("keeps changes and ignores files another session also edits", async () => {
  const { cwd, store } = folder();
  await store.ensure("s1", cwd);
  await store.ensure("s2", cwd);
  await edit(store, "s1", cwd, "a.txt", "first\n");
  await edit(store, "s2", cwd, "b.txt", "second\n");
  await edit(store, "s2", cwd, "a.txt", "both\n");

  // s2 now owns a.txt's latest contents; s1 can no longer restore it safely.
  expect((await store.status("s1", cwd)).files[0]).toMatchObject({ relative: "a.txt", undoable: false });
  expect((await store.keep("s2", cwd, "b.txt")).files.map((file) => file.relative)).toEqual(["a.txt"]);
  expect(readFileSync(join(cwd, "b.txt"), "utf8")).toBe("second\n");
  expect(await store.keep("s1", cwd)).toEqual({ files: [] });
  expect((await store.status("s1", cwd)).files).toEqual([]);
});

it("ignores completions without a tool-start snapshot and paths outside the checkout", async () => {
  const { cwd, store } = folder();
  await store.ensure("s1", cwd);
  writeFileSync(join(cwd, "a.txt"), "unprepared\n");
  await store.capture("s1", cwd, ["a.txt", "../outside.txt", ".git/config"]);
  expect((await store.status("s1", cwd)).files).toEqual([]);
});
