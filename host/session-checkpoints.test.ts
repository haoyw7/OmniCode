import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SessionCheckpoints } from "./session-checkpoints";

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), "monocode-checkpoint-repo-"));
  const data = mkdtempSync(join(tmpdir(), "monocode-checkpoint-data-"));
  cleanups.push(cwd, data);
  const git = (...args: string[]) => execFileSync("git", args, { cwd });
  git("init", "-q");
  writeFileSync(join(cwd, "a.txt"), "one\ntwo\n");
  git("add", "a.txt");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "initial");
  return { cwd, store: new SessionCheckpoints(data) };
}

/** One structured edit: the tool starts, writes, then completes. */
async function edit(store: SessionCheckpoints, id: string, cwd: string, file: string, contents: string | null) {
  const prepared = store.prepare(id, cwd, [join(cwd, file)]);
  if (contents === null) rmSync(join(cwd, file));
  else writeFileSync(join(cwd, file), contents);
  await prepared;
  await store.capture(id, cwd, [file]);
}

it("reviews and undoes a session's modified, added and deleted files", async () => {
  const { cwd, store } = repository();
  writeFileSync(join(cwd, "gone.txt"), "keep me\n");
  await store.ensure("s1", cwd);
  await edit(store, "s1", cwd, "a.txt", "one\nchanged\nthree\n");
  await edit(store, "s1", cwd, "new.txt", "hello\n");
  await edit(store, "s1", cwd, "gone.txt", null);

  const status = await store.status("s1", cwd);
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
  const { cwd, store } = repository();
  await store.ensure("s1", cwd);
  await edit(store, "s1", cwd, "a.txt", "one\r\ntwo\r\nthree\r\n");

  expect((await store.status("s1", cwd)).files[0]).toMatchObject({ additions: 1, deletions: 0 });
  expect(await store.fileDiff("s1", cwd, "a.txt")).toMatchObject({
    original: "one\ntwo\n",
    current: "one\ntwo\nthree\n",
  });
  await store.undo("s1", cwd);
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("one\ntwo\n");
});

it("refuses to undo a file changed outside the session", async () => {
  const { cwd, store } = repository();
  await store.ensure("s1", cwd);
  await edit(store, "s1", cwd, "a.txt", "agent\n");
  writeFileSync(join(cwd, "a.txt"), "user\n");

  expect((await store.status("s1", cwd)).files[0]).toMatchObject({ relative: "a.txt", undoable: false });
  await expect(store.undo("s1", cwd)).rejects.toThrow(/changed outside this session/);
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("user\n");
});

it("keeps changes and ignores files another session also edits", async () => {
  const { cwd, store } = repository();
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
  const { cwd, store } = repository();
  await store.ensure("s1", cwd);
  writeFileSync(join(cwd, "a.txt"), "unprepared\n");
  await store.capture("s1", cwd, ["a.txt", "../outside.txt", ".git/config"]);
  expect((await store.status("s1", cwd)).files).toEqual([]);
});
