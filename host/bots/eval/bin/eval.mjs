#!/usr/bin/env node
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  output = await mkdtemp(join(tmpdir(), "monocode-eval-build-"));
process.env.MONOCODE_EVAL_ROOT = root;
process.env.MONOCODE_EVAL_BRAIN_MODULE = pathToFileURL(
  join(output, "brain.mjs"),
).href;
try {
  await build({
    entryPoints: {
      cli: join(root, "src/cli.ts"),
      brain: join(root, "native/brain.ts"),
    },
    outdir: output,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    logLevel: "warning",
  });
  await import(pathToFileURL(join(output, "cli.mjs")).href);
} catch (e) {
  console.error(e instanceof Error ? e.message : "Evaluation failed");
  process.exitCode = 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
