import {
  ensureEvalData,
  evalDataPath,
  assertEvalOutputOutsideProject,
} from "./evalData";
import { parseArgs } from "node:util";
import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { Budget, PiAdapter } from "./adapters";
import { verifyPublicIntegrity } from "./publicIntegrity";
import {
  PUBLIC_SOURCES,
  PythonBridge,
  runPublicEpisode,
  summarizePublic,
  type PublicCase,
  type PublicResult,
} from "./publicRunner";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sources: { type: "string", default: PUBLIC_SOURCES.join(",") },
    ids: { type: "string" },
    mode: { type: "string", default: "reference" },
    out: { type: "string" },
    limit: { type: "string" },
    model: { type: "string", default: "openai-codex/gpt-5.6-luna" },
    seed: { type: "string", default: "17" },
    "max-steps": { type: "string", default: "32" },
    "max-requests": { type: "string", default: "20" },
    "max-usd": { type: "string", default: "0.25" },
    "request-usd": { type: "string", default: "0.01" },
    "timeout-ms": { type: "string", default: "60000" },
  },
});
const root = process.env.MONOCODE_EVAL_ROOT!,
  command = positionals[0] ?? "list";
if (!["list", "run"].includes(command))
  throw Error(
    "Usage: public_eval.mjs list|run --sources bfcl,longmemeval,tau_bench,api_bank,hotpotqa,bipia --mode reference|pi --out NEW_DIRECTORY",
  );
const sources = values.sources.split(",");
if (
  sources.some((s) => !(PUBLIC_SOURCES as readonly string[]).includes(s)) ||
  new Set(sources).size !== sources.length
)
  throw Error("Unknown or duplicate source");
const seed = Number(values.seed),
  maxSteps = Number(values["max-steps"]),
  timeoutMs = Number(values["timeout-ms"]);
if (
  ![seed, maxSteps, timeoutMs].every(Number.isSafeInteger) ||
  maxSteps < 1 ||
  maxSteps > 64 ||
  timeoutMs < 1
)
  throw Error("Invalid run limits");
// Check complete transitive inventory before even importing adapter code.
await ensureEvalData(root, sources);
const integrity = await verifyPublicIntegrity(root, sources);
let cases: PublicCase[] = [];
const inventory = new PythonBridge(root);
try {
  for (const source of sources)
    cases.push(...(await inventory.request({ op: "list", source })));
} finally {
  inventory.close();
}
if (values.ids) {
  const ids = values.ids.split(",");
  if (ids.some((id) => !cases.some((c) => c.id === id)))
    throw Error("Unknown selected ID");
  cases = cases.filter((c) => ids.includes(c.id));
}
if (values.limit) {
  const limit = Number(values.limit);
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error("Invalid limit");
  cases = cases.slice(0, limit);
}
if (command === "list") {
  console.log(JSON.stringify(cases, null, 2));
} else {
  if (values.mode !== "reference" && values.mode !== "pi")
    throw Error("Mode must be reference or pi");
  if (!values.out)
    throw Error(
      "--out NEW_DIRECTORY is required; reports are never overwritten",
    );
  const mode = values.mode,
    out = resolve(values.out);
  await assertEvalOutputOutsideProject(root, out);
  await mkdir(out, { recursive: false });
  const budget = new Budget(
    Number(values["max-requests"]),
    Number(values["max-usd"]),
    Number(values["request-usd"]),
  );
  const adapter =
    mode === "pi" ? new PiAdapter(values.model, budget, timeoutMs) : undefined;
  const { brain } = await import(process.env.MONOCODE_EVAL_BRAIN_MODULE!);
  const sourceFiles: Record<string, string> = {};
  const implementationFiles: Record<string, string> = {};
  for (const path of [
    "src/publicRunner.ts",
    "src/publicIntegrity.ts",
    "src/publicCli.ts",
    "src/evalData.ts",
    "bin/eval_data.py",
    "bin/prepare_data.py",
    "data/datasets.lock.json",
    "src/adapters.ts",
    "src/schema.ts",
    "native/brain.ts",
    "bin/public_eval.mjs",
    "../thread/prompt.ts",
    "../../../src/features/bots/model/botView.ts",
  ])
    implementationFiles[path] = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
  for (const source of sources)
    for (const name of ["adapter.py", "manifest.json"]) {
      const path = `public/${source}/${name}`;
      sourceFiles[path] = createHash("sha256")
        .update(await readFile(evalDataPath(root, path)))
        .digest("hex");
    }
  const manifest = {
    createdAt: new Date().toISOString(),
    mode,
    seed,
    model: adapter?.model ?? null,
    sources,
    ids: cases.map((c) => c.id),
    sourceFiles,
    implementationFiles,
    integrityLockSha256: integrity.sha256,
    budget: {
      maxRequests: budget.maxRequests,
      maxUsd: budget.maxUsd,
      reservationPerRequestUsd: budget.requestUsd,
    },
    maxSteps,
    timeoutMs,
    safety:
      "No native CLI tools; fresh credential-free Python process per case; audited fixtures only; network/subprocess/file writes denied in bridge",
    scope:
      "actual MonoCode buildBrainPrompt through existing Pi CLI; local public tools; not full Host/UI E2E or official benchmark score",
  };
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const results: PublicResult[] = [];
  for (const item of cases) {
    const bridge = new PythonBridge(root);
    let result: PublicResult;
    try {
      result = await runPublicEpisode(item, bridge, {
        mode,
        seed,
        maxSteps,
        adapter,
        brain,
      });
    } finally {
      bridge.close();
    }
    results.push(result);
    await appendFile(join(out, "results.jsonl"), JSON.stringify(result) + "\n");
    console.log(
      JSON.stringify({
        id: result.id,
        status: result.status,
        error: result.error,
        requests: result.usage.requests,
        costUsd: result.usage.costUsd,
      }),
    );
  }
  const summary = {
    ...summarizePublic(results),
    requestsAttempted: budget.requests,
    reservedUsd: budget.reservedUsd,
    actualCostGuardUsd: budget.actualUsd,
  };
  await writeFile(
    join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  const rows = Object.entries(summary.sources).map(
    ([source, s]) =>
      `| ${source} | ${s.total} | ${s.passed} | ${s.failed} | ${s.environment_error} | ${s.budget_exhausted} | ${s.passRate === null ? "N/A" : (s.passRate * 100).toFixed(1) + "%"} |`,
  );
  await writeFile(
    join(out, "report.md"),
    `# Public source run\n\nMode: ${mode === "reference" ? "Harness reference validation — NOT an agent score" : "Real Pi + MonoCode brain prompt + isolated public tools"}.\n\n| Source | Total | Pass | Fail | Environment | Budget | Local metric pass rate |\n|---|---:|---:|---:|---:|---:|---:|\n${rows.join("\n")}\n\n${summary.denominator}\n\nRequests attempted: ${budget.requests}; observed usage: ${summary.usage.requests} requests, ${summary.usage.inputTokens} input / ${summary.usage.outputTokens} output tokens, reported nominal cost USD ${summary.usage.costUsd ?? "unavailable"}. Latency sum ${summary.usage.latencyMs}ms.\n\nNo LLM judge calls; formal judge remains unavailable under the existing failed calibration gate. Full case hashes, traces, checks, errors and source provenance: results.jsonl; exact adapter hashes and selection: manifest.json.\n\nFailures:\n${
      results
        .filter((r) => r.status !== "passed")
        .map(
          (r) =>
            `- ${r.id}: ${r.status}; ${
              r.error ??
              r.grade?.checks
                .filter((c: any) => !c.passed)
                .map((c: any) => c.name)
                .join(", ")
            }`,
        )
        .join("\n") || "- None"
    }\n`,
  );
  console.log(JSON.stringify(summary));
}
