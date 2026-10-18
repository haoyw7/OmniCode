#!/usr/bin/env node
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(join(tmpdir(), "monocode-optimization-build-"));
process.env.MONOCODE_EVAL_ROOT = root;
try {
  await build({
    entryPoints: [join(root, "src/optimizationCampaign.ts")],
    outfile: join(output, "campaign.mjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    logLevel: "warning",
    loader: { ".md": "text" },
    banner: {
      js: `import { createRequire as __createRequire } from 'node:module'; import { fileURLToPath as __fileURLToPath } from 'node:url'; import { dirname as __dirnameOf } from 'node:path'; const __filename=__fileURLToPath(import.meta.url); const __dirname=__dirnameOf(__filename); const require=__createRequire(${JSON.stringify(join(root, "../../../package.json"))});`,
    },
  });
  await import(pathToFileURL(join(output, "campaign.mjs")).href);
} catch (e) {
  console.error(e instanceof Error ? e.message : "Campaign failed");
  process.exitCode = 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
