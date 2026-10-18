#!/usr/bin/env node
// Report regeneration; prepares immutable datasets without model calls.
import {
  ensureEvalData,
  evalDataPath,
  readEvalText,
  requireEvalInputPath,
  assertEvalOutputOutsideProject,
} from "../src/evalData.ts";
import { build } from "esbuild";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
const { values } = parseArgs({
  options: { run: { type: "string" }, out: { type: "string" } },
});
if (!values.run || !values.out)
  throw Error("--run EXISTING_CAMPAIGN --out NEW_DIRECTORY required");
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  run = await requireEvalInputPath(root, values.run),
  out = resolve(values.out);
await assertEvalOutputOutsideProject(root, out);
const history = (
  await readEvalText(root, "reports/scores-2026-10-09/cases.jsonl")
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const readJSONL = async (p) =>
  (await readFile(p, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const manifest = JSON.parse(await readFile(join(run, "manifest.json"), "utf8"));
if (manifest.mode !== "optimization-campaign")
  throw Error("Not an optimization campaign");
const rows = await readJSONL(join(run, "results.jsonl"));
await ensureEvalData(root, [
  "original",
  "bfcl",
  "longmemeval",
  "tau_bench",
  "api_bank",
  "hotpotqa",
  "bipia",
]);
const originals = [
  ...(await readJSONL(evalDataPath(root, "data/cases.jsonl"))),
  ...(await readJSONL(
    evalDataPath(root, "data/variants/structured-nested-v2.jsonl"),
  )),
];
const catalog = originals.map((c) => ({
  id: c.id,
  source: "original",
  category: c.category,
  upstreamId: c.id,
}));
for (const source of [
  "bfcl",
  "longmemeval",
  "tau_bench",
  "api_bank",
  "hotpotqa",
  "bipia",
])
  for (const c of await readJSONL(
    evalDataPath(root, `public/${source}/cases.jsonl`),
  ))
    catalog.push({
      id: c.id,
      source,
      category: c.category,
      upstreamId: `${source}/${c.upstream_id}`,
      variant: c.variant,
    });
const quality = await readJSONL(
  evalDataPath(root, "data/quality-annotations.jsonl"),
);
const budget = JSON.parse(await readFile(join(run, "budget.json"), "utf8"));
const temp = await mkdtemp(join(tmpdir(), "monocode-report-only-"));
try {
  await build({
    entryPoints: [join(root, "src/optimizationReport.ts")],
    outfile: join(temp, "report.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "warning",
  });
  const { writeOptimizationReport } = await import(
    pathToFileURL(join(temp, "report.mjs")).href
  );
  await mkdir(out, { recursive: false });
  await writeOptimizationReport(out, rows, catalog, quality, budget, history);
  for (const file of [
    "manifest.json",
    "results.jsonl",
    "budget.json",
    "execution-audit.json",
  ])
    await copyFile(join(run, file), join(out, file));
  const sha = (data) => createHash("sha256").update(data).digest("hex");
  const revision = {
    sourceRun: run,
    sourceResultsSha256: sha(await readFile(join(run, "results.jsonl"))),
    additionalModelRequests: 0,
    reporterSha256: sha(
      await readFile(join(root, "src/optimizationReport.ts")),
    ),
    note: "Derived report only: explicit variant lineage; unknown zero-token placeholders rendered N/A. Raw results, manifest and budget copied unchanged.",
  };
  await writeFile(
    join(out, "report-revision.json"),
    JSON.stringify(revision, null, 2) + "\n",
  );
  console.log(JSON.stringify({ out, ...revision }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
