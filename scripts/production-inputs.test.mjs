import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import {
  excludeEvaluationEsbuild,
  excludeEvaluationVite,
  isEvaluationInput,
} from "./production-inputs.mjs";

test("Git source archives exclude both evaluation directories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "monocode-source-archive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  await copyFile(new URL("../.gitattributes", import.meta.url), join(root, ".gitattributes"));
  for (const path of [
    "host/bots/thread/index.ts",
    "host/bots/eval/run.ts",
    "host/bots/eval/datasets/cases.jsonl",
    "eval/legacy.json",
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), "fixture");
  }
  execFileSync("git", ["add", "."], { cwd: root });
  const tree = execFileSync("git", ["write-tree"], { cwd: root, encoding: "utf8" }).trim();
  const archive = execFileSync("git", ["archive", tree], { cwd: root });
  const entries = execFileSync("tar", ["-tf", "-"], { input: archive, encoding: "utf8" })
    .trim().split("\n");
  assert.ok(entries.includes("host/bots/thread/index.ts"));
  assert.ok(entries.every((path) => !/^(?:host\/bots\/)?eval(?:\/|$)/.test(path)));
});

test("Host bundling refuses static and dynamic evaluation imports before producing output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "monocode-production-inputs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ["host/bots/eval/data.json", "eval/legacy.json"]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), '{"privateCase":"evaluation only"}');
    for (const contents of [
      `import data from './${path}'; console.log(data);`,
      `console.log(await import('./${path}'));`,
    ]) {
      await assert.rejects(
        build({
          absWorkingDir: root,
          stdin: { contents, resolveDir: root, sourcefile: "entry.ts" },
          bundle: true,
          format: "esm",
          write: false,
          logLevel: "silent",
          plugins: [excludeEvaluationEsbuild()],
        }),
        /Evaluation files must not enter production bundles/,
      );
    }
  }
  await writeFile(join(root, "production.json"), '{"production":true}');
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: "import data from './production.json'; console.log(data);",
      resolveDir: root,
    },
    bundle: true,
    write: false,
    plugins: [excludeEvaluationEsbuild()],
  });
  assert.match(result.outputFiles[0].text, /production: true/);
});

test("desktop/mobile Vite guards reject evaluation modules and raw assets with query strings", () => {
  const root = join(tmpdir(), "monocode-production-inputs");
  const plugin = excludeEvaluationVite();
  plugin.configResolved({ root });
  for (const path of [
    "host/bots/eval/run.ts",
    "host/bots/eval/datasets/cases.jsonl?raw",
    "eval/public/cases.json?url",
  ]) {
    assert.equal(isEvaluationInput(path, root), true);
    assert.throws(
      () => plugin.load(join(root, path)),
      /Evaluation files must not enter production bundles/,
    );
  }
  for (const path of ["host/bots/thread/index.ts", "src/evaluate.ts", "vendor/eval/parser.js"]) {
    assert.equal(isEvaluationInput(path, root), false);
    assert.equal(plugin.load(join(root, path)), null);
  }
});
