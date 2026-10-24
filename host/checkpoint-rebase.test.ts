import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { rebaseCheckpointMetadata } from "./checkpoint-rebase";

const cleanups: string[] = [];
afterEach(() => { for (const root of cleanups.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omnicode-checkpoint-move-"));
  cleanups.push(root);
  const from = join(root, "old");
  const to = join(root, "new");
  const data = join(root, "checkpoints");
  const file = (id: string, name: string, value: unknown) => {
    const dir = join(data, id);
    mkdirSync(join(dir, "turns"), { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  return { root, data, from, to, file };
}
const slashed = (value: string) => value.replaceAll("\\", "/");

it("rebases content and all historical Git recordings, preserving snapshot identities and rollback bytes", async () => {
  const { data, from, to, file } = fixture();
  const paths = [
    file("s", "manifest.json", { cwd: from, files: { "a.txt": "contents" }, prepared: ["a.txt"] }),
    file("s", "turn-review.json", { cwd: join(from, "sub"), repo: from, latest: { id: "t", before: "before", after: "after" } }),
    file("s", "turns/t.json", { cwd: from, repo: from, turn: { id: "t", before: "before", after: "after" } }),
  ];
  const originals = paths.map(path => readFileSync(path, "utf8"));
  const undo = await rebaseCheckpointMetadata(data, from, to, ["s"]);
  expect(JSON.parse(readFileSync(paths[0], "utf8"))).toEqual({ cwd: slashed(to), files: { "a.txt": "contents" }, prepared: ["a.txt"] });
  expect(JSON.parse(readFileSync(paths[1], "utf8"))).toMatchObject({ cwd: slashed(join(to, "sub")), repo: slashed(to), latest: { before: "before", after: "after" } });
  expect(JSON.parse(readFileSync(paths[2], "utf8"))).toMatchObject({ cwd: slashed(to), repo: slashed(to), turn: { before: "before", after: "after" } });
  // Crash recovery can replay the forward transformation without nesting paths.
  await rebaseCheckpointMetadata(data, from, to, ["s"]);
  await undo();
  expect(paths.map(path => readFileSync(path, "utf8"))).toEqual(originals);
  await undo();
});

it("leaves another machine, sibling checkout and unselected sessions untouched", async () => {
  const { data, from, to, file } = fixture();
  const paths = [
    file("wsl", "manifest.json", { machine: "wsl:Ubuntu", cwd: "/old" }),
    file("sibling", "manifest.json", { cwd: `${from}-other` }),
    file("unselected", "manifest.json", { cwd: from }),
  ];
  const originals = paths.map(path => readFileSync(path, "utf8"));
  await rebaseCheckpointMetadata(data, from, to, ["wsl", "sibling"]);
  expect(paths.map(path => readFileSync(path, "utf8"))).toEqual(originals);
});

it("validates all recordings before changing any path", async () => {
  const { data, from, to, file } = fixture();
  const good = file("s", "manifest.json", { cwd: from });
  const invalid = file("s", "turns/broken.json", null);
  writeFileSync(invalid, "broken");
  await expect(rebaseCheckpointMetadata(data, from, to, ["s"])).rejects.toThrow();
  expect(JSON.parse(readFileSync(good, "utf8"))).toEqual({ cwd: from });
  await expect(rebaseCheckpointMetadata(data, from, to, ["../escape"])).rejects.toThrow("Invalid session id");
});

it("never overwrites a checkpoint that advanced after a move when asked to roll back", async () => {
  const { data, from, to, file } = fixture();
  const path = file("s", "manifest.json", { cwd: from });
  const undo = await rebaseCheckpointMetadata(data, from, to, ["s"]);
  const newer = JSON.stringify({ cwd: slashed(to), prepared: ["new-edit"] });
  writeFileSync(path, newer);
  await expect(undo()).rejects.toThrow("recording was preserved");
  expect(readFileSync(path, "utf8")).toBe(newer);
});
