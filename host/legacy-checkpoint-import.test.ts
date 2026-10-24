import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { importDesktopCheckpoints } from "./legacy-checkpoint-import";
import { SessionCheckpoints } from "./session-checkpoints";

const cleanups: string[] = [];
afterEach(() => { for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omnicode-legacy-checkpoint-"));
  cleanups.push(root);
  const source = join(root, "desktop");
  const destination = join(root, "host");
  const cwd = join(root, "project");
  for (const path of [cwd, join(source, "s/files"), join(source, "s/after")]) mkdirSync(path, { recursive: true });
  const manifest = { cwd, files: { "notes.txt": "contents" }, after: { "notes.txt": "contents" },
    touched: ["notes.txt"], prepared: ["notes.txt"], tracked: [], stats: {}, diverged: [] };
  writeFileSync(join(source, "s/manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(source, "s/files/notes.txt"), "before\n");
  writeFileSync(join(source, "s/after/notes.txt"), "after\n");
  writeFileSync(join(cwd, "notes.txt"), "after\n");
  return { source, destination, cwd };
}

it("reads and restores a desktop structured-edit recording through Host without modifying the source", async () => {
  const { source, destination, cwd } = fixture();
  const original = readFileSync(join(source, "s/manifest.json"), "utf8");
  expect(importDesktopCheckpoints(source, destination, ["s"])).toBe(1);
  const checkpoints = new SessionCheckpoints(destination);
  expect(await checkpoints.fileDiff("s", cwd, "notes.txt")).toMatchObject({ original: "before\n", current: "after\n" });
  await checkpoints.undo("s", cwd);
  expect(readFileSync(join(cwd, "notes.txt"), "utf8")).toBe("before\n");
  expect(readFileSync(join(source, "s/manifest.json"), "utf8")).toBe(original);
  expect(importDesktopCheckpoints(source, destination, ["s"])).toBe(0);
});

it("preserves existing Host checkpoints and refuses unsupported legacy data explicitly", () => {
  const { source, destination } = fixture();
  mkdirSync(join(destination, "s"), { recursive: true });
  writeFileSync(join(destination, "s/manifest.json"), "Host owns this recording");
  expect(importDesktopCheckpoints(source, destination, ["s"])).toBe(0);
  expect(readFileSync(join(destination, "s/manifest.json"), "utf8")).toBe("Host owns this recording");
  mkdirSync(join(source, "broken"));
  writeFileSync(join(source, "broken/manifest.json"), "invalid");
  expect(() => importDesktopCheckpoints(source, destination, ["broken"])).toThrow("original recording was preserved");
  expect(readdirSync(destination).filter(name => !name.startsWith("."))).toEqual(["s"]);
});
