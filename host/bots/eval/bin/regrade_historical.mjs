#!/usr/bin/env node
import { evalDataPath } from "../src/evalData.ts";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out")) {
  console.error("Usage: regrade_historical.mjs [--out NEW_DIRECTORY]");
  process.exit(1);
}
const out = args.length
  ? resolve(args[1])
  : evalDataPath(root, "reports/optimization-offline-2026-10-09");
const temporary = await mkdtemp(
  join(tmpdir(), "monocode-historical-regrade-build-"),
);
try {
  await build({
    entryPoints: [join(root, "src/historicalRegrade.ts")],
    outfile: join(temporary, "regrade.mjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    logLevel: "warning",
    banner: {
      js: `import { createRequire as __createRequire } from 'node:module'; const require=__createRequire(${JSON.stringify(join(root, "../../../package.json"))});`,
    },
  });
  const { writeHistoricalRegrade } = await import(
    pathToFileURL(join(temporary, "regrade.mjs")).href
  );
  const summary = await writeHistoricalRegrade(root, out);
  console.log(
    JSON.stringify(
      {
        out,
        mode: summary.mode,
        observedFinalRegrade: summary.observedFinalRegrade,
        transportCounterfactuals: summary.transportCounterfactuals,
        additionalModelRequests: 0,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Historical regrade failed",
  );
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
