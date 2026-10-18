import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  ensureEvalData,
  evalDataPath,
  evalDataRoot,
  readEvalText,
  requireEvalInputPath,
  assertEvalOutputOutsideProject,
} from "../src/evalData";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "eval-data-test-"));
  directories.push(root);
  await mkdir(join(root, "data"));
  const lock = JSON.stringify({
    version: 1,
    sources: {
      original: { files: { "data/cases.jsonl": "a".repeat(64) } },
      bfcl: { files: { "public/bfcl/cases.jsonl": "b".repeat(64) } },
    },
  });
  await writeFile(join(root, "data/datasets.lock.json"), lock);
  return { root, lock };
}

it("resolves only locked payloads into a source-specific cache outside the checkout", async () => {
  const { root, lock } = await fixture();
  const cache = join(root, "external-cache");
  vi.stubEnv("MONOCODE_EVAL_DATA_ROOT", "");
  vi.stubEnv("MONOCODE_EVAL_CACHE", cache);
  const expected = join(
    cache,
    createHash("sha256").update(lock).digest("hex").slice(0, 16),
  );
  expect(evalDataRoot(root)).toBe(expected);
  expect(evalDataPath(root, "data/cases.jsonl")).toBe(
    join(expected, "original/data/cases.jsonl"),
  );
  expect(evalDataPath(root, "public/bfcl/cases.jsonl")).toBe(
    join(expected, "bfcl/public/bfcl/cases.jsonl"),
  );
  expect(evalDataPath(root, "public/bfcl/adapter.py")).toBe(
    join(root, "public/bfcl/adapter.py"),
  );
  expect(() => evalDataPath(root, "../outside.json")).toThrow(
    "Invalid evaluation data path",
  );
  expect(() => evalDataPath(root, "/outside.json")).toThrow(
    "Invalid evaluation data path",
  );
});

it("prepares only requested sources and passes the returned root to later consumers", async () => {
  const { root } = await fixture();
  const cache = join(root, "ready");
  await mkdir(join(root, "bin"));
  await writeFile(
    join(root, "bin/prepare_data.py"),
    `import json, sys\nassert sys.argv[1:] == ['--sources', 'bfcl']\nprint('preparation progress')\nprint(json.dumps({'root': ${JSON.stringify(cache)}}))\n`,
  );
  vi.stubEnv("MONOCODE_EVAL_DATA_ROOT", "");
  expect(await ensureEvalData(root, ["bfcl", "bfcl"])).toBe(cache);
  expect(evalDataPath(root, "public/bfcl/cases.jsonl")).toBe(
    join(cache, "bfcl/public/bfcl/cases.jsonl"),
  );
  await expect(ensureEvalData(root, ["unknown"])).rejects.toThrow(
    "Unknown evaluation dataset",
  );
});

it("reads historical artifacts from the archive and rejects escaped evidence", async () => {
  const { root } = await fixture();
  const archive = await mkdtemp(join(tmpdir(), "eval-archive-test-"));
  directories.push(archive);
  vi.stubEnv("MONOCODE_EVAL_ARCHIVE_ROOT", archive);
  await mkdir(join(archive, "reports"));
  await writeFile(join(archive, "reports/summary.json"), "archived evidence");
  expect(evalDataPath(root, "reports/summary.json")).toBe(
    join(archive, "reports/summary.json"),
  );
  expect(await readEvalText(root, "reports/summary.json")).toBe(
    "archived evidence",
  );
  await expect(
    requireEvalInputPath(root, "reports/missing-run"),
  ).rejects.toThrow("MONOCODE_EVAL_ARCHIVE_ROOT");
  await expect(readEvalText(root, "reports/missing.json")).rejects.toThrow(
    "MONOCODE_EVAL_ARCHIVE_ROOT",
  );
  await writeFile(join(root, "private.json"), "outside archive");
  await symlink(
    join(root, "private.json"),
    join(archive, "reports/escaped.json"),
  );
  await expect(readEvalText(root, "reports/escaped.json")).rejects.toThrow(
    "escapes its storage root",
  );
  expect(() => evalDataPath(root, "reports/../private.json")).toThrow(
    "Invalid evaluation data path",
  );
});

it("keeps fixture reports local and prevents managed output from writing through a symlink into the checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-output-root-test-"));
  directories.push(directory);
  const project = join(directory, "project");
  const root = join(project, "host/bots/eval");
  await mkdir(join(root, "data"), { recursive: true });
  expect(evalDataPath(root, "reports/result.json")).toBe(
    join(root, "reports/result.json"),
  );
  await writeFile(
    join(root, "data/datasets.lock.json"),
    JSON.stringify({ version: 1, sources: {} }),
  );
  await expect(
    assertEvalOutputOutsideProject(root, join(project, "reports/new")),
  ).rejects.toThrow("outside the project");
  const external = join(directory, "external");
  await mkdir(external);
  await symlink(project, join(external, "checkout-link"));
  await expect(
    assertEvalOutputOutsideProject(root, join(external, "checkout-link/new")),
  ).rejects.toThrow("outside the project");
  await expect(
    assertEvalOutputOutsideProject(root, join(external, "new")),
  ).resolves.toBeUndefined();
});
