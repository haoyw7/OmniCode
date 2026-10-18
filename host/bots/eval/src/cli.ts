import {
  ensureEvalData,
  evalDataPath,
  requireEvalInputPath,
  assertEvalOutputOutsideProject,
} from "./evalData";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CaseSchema, DecisionSchema, type Result } from "./schema";
import { Budget, ClaudeAdapter, PiAdapter, addUsage } from "./adapters";
import { runCase, type Reference } from "./runner";
import { summarize } from "./scoring";
import { TOOL_SCHEMAS } from "./tools";
import { judgeResult, JudgeSchema, JUDGE_PROTOCOL_HASH } from "./judge";
import { loadCalibrationRegistry, CalibrationSchema } from "./judgeTrust";
import { replayCampaign } from "./replay";
const root = process.env.MONOCODE_EVAL_ROOT!;
const args = process.argv.slice(2);
const command = args.shift() ?? "validate";
const allowed = new Set([
  "mode",
  "seed",
  "limit",
  "tier",
  "category",
  "ids",
  "out",
  "model",
  "judge-model",
  "max-requests",
  "max-usd",
  "request-usd",
  "timeout-ms",
  "campaign",
]);
const opts: Record<string, string> = {};
while (args.length) {
  const name = args.shift()!;
  const key = name.replace(/^--/, "");
  if (!name.startsWith("--") || !allowed.has(key) || !args.length)
    throw new Error(`Invalid option ${name}`);
  opts[key] = args.shift()!;
}
const replayInput =
  command === "replay" && opts.campaign
    ? await requireEvalInputPath(root, opts.campaign)
    : undefined;
await ensureEvalData(root, ["original"]);
const readJSONL = async (file: string) =>
  (await readFile(evalDataPath(root, `data/${file}`), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((x, i) => {
      try {
        return JSON.parse(x);
      } catch {
        throw new Error(`${file}:${i + 1}: invalid JSON`);
      }
    });
const cases = (await readJSONL("cases.jsonl")).map((x) => CaseSchema.parse(x));
if (new Set(cases.map((c) => c.id)).size !== cases.length)
  throw new Error("Duplicate IDs");
if (new Set(cases.map((c) => c.prompt)).size !== cases.length)
  throw new Error("Duplicate prompts");
for (const c of cases) {
  for (const name of c.tools)
    if (!TOOL_SCHEMAS[name]) throw new Error(`${c.id}: unknown tool ${name}`);
  for (const a of c.assertions)
    if (a.kind === "pattern" || a.kind === "state_pattern")
      new RegExp(a.regex, "iu");
}
const refs = (await readJSONL("references.jsonl")) as Reference[];
if (
  new Set(refs.map((r) => r.id)).size !== cases.length ||
  refs.length !== cases.length ||
  cases.some((c) => !refs.some((r) => r.id === c.id))
)
  throw new Error("Reference/case mismatch");
if (command === "schema") {
  await writeFile(
    join(root, "schema", "case.schema.json"),
    JSON.stringify(z.toJSONSchema(CaseSchema), null, 2) + "\n",
  );
  await writeFile(
    join(root, "schema", "decision.schema.json"),
    JSON.stringify(z.toJSONSchema(DecisionSchema), null, 2) + "\n",
  );
  await writeFile(
    join(root, "schema", "judge-output.schema.json"),
    JSON.stringify(z.toJSONSchema(JudgeSchema), null, 2) + "\n",
  );
  await writeFile(
    join(root, "schema", "judge-calibration.schema.json"),
    JSON.stringify(z.toJSONSchema(CalibrationSchema), null, 2) + "\n",
  );
  console.log("Wrote case, decision, judge and calibration schemas");
} else if (command === "validate") {
  const calibration = await loadCalibrationRegistry(root);
  console.log(
    JSON.stringify(
      {
        valid: true,
        judgeCalibration: {
          formalReady: Boolean(
            calibration?.records.some(
              (r) =>
                r.status === "passed" &&
                r.protocolHash === JUDGE_PROTOCOL_HASH &&
                Object.values(r.checks).every(Boolean),
            ),
          ),
          records:
            calibration?.records.map((r) => ({
              modelId: r.modelId,
              status: r.status,
              checks: r.checks,
            })) ?? [],
          note: "Missing or failed calibration excludes judge scores from formal rates; case validation is independent.",
        },
        count: cases.length,
        categories: Object.fromEntries(
          [...new Set(cases.map((c) => c.category))].map((k) => [
            k,
            cases.filter((c) => c.category === k).length,
          ]),
        ),
        languages: Object.fromEntries(
          ["zh", "en", "mixed"].map((k) => [
            k,
            cases.filter((c) => c.language === k).length,
          ]),
        ),
        support: Object.fromEntries(
          ["native", "simulated-extension", "unsupported"].map((k) => [
            k,
            cases.filter((c) => c.support === k).length,
          ]),
        ),
        multiTurn: cases.filter((c) => c.events.length).length,
      },
      null,
      2,
    ),
  );
} else if (command === "replay") {
  if (!opts.campaign || !opts.out)
    throw new Error("replay requires --campaign and --out");
  console.log(
    JSON.stringify(
      await replayCampaign(root, replayInput!, resolve(opts.out), cases),
    ),
  );
} else if (command === "run") {
  const mode = opts.mode ?? "reference";
  if (mode !== "reference" && mode !== "claude" && mode !== "pi")
    throw new Error("mode must be reference, claude or pi");
  const numeric = (key: string, fallback: number) => {
    const n = Number(opts[key] ?? fallback);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${key}`);
    return n;
  };
  const seed = numeric("seed", 17),
    limit = numeric("limit", cases.length);
  if (!Number.isInteger(seed) || !Number.isInteger(limit))
    throw new Error("seed/limit must be integers");
  const selected = cases
    .filter(
      (c) =>
        (!opts.tier || c.tier === opts.tier) &&
        (!opts.category || c.category === opts.category) &&
        (!opts.ids || opts.ids.split(",").includes(c.id)),
    )
    .slice(0, limit);
  if (!selected.length) throw new Error("No cases selected");
  const out = resolve(
    opts.out ??
      evalDataPath(
        root,
        `reports/${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      ),
  );
  await assertEvalOutputOutsideProject(root, out);
  if (!opts.out) await mkdir(dirname(out), { recursive: true });
  await mkdir(out, { recursive: false });
  const budget = new Budget(
    numeric("max-requests", 24),
    numeric("max-usd", 2),
    numeric("request-usd", 0.08),
  );
  const model =
    opts.model ?? (mode === "pi" ? "openai-codex/gpt-5.6-luna" : "sonnet");
  const adapter =
    mode === "reference"
      ? undefined
      : mode === "pi"
        ? new PiAdapter(model, budget, numeric("timeout-ms", 60000))
        : new ClaudeAdapter(model, budget, numeric("timeout-ms", 60000));
  if (opts["judge-model"] && mode === "reference")
    throw new Error("Only real-agent results can be judged");
  if (opts["judge-model"] === model)
    throw new Error("Judge must be a different model");
  const judge = opts["judge-model"]
    ? mode === "pi"
      ? new PiAdapter(opts["judge-model"], budget, numeric("timeout-ms", 60000))
      : new ClaudeAdapter(
          opts["judge-model"],
          budget,
          numeric("timeout-ms", 60000),
        )
    : undefined;
  const calibration = await loadCalibrationRegistry(root);
  const native = await import(process.env.MONOCODE_EVAL_BRAIN_MODULE!);
  const startedAt = new Date().toISOString();
  console.log(
    JSON.stringify({
      selected: selected.length,
      mode,
      output: out,
      budget: {
        maxRequests: budget.maxRequests,
        maxUsd: budget.maxUsd,
        requestUsd: budget.requestUsd,
      },
      note: "reference is harness validation only; CLI uses isolated simulated tools",
    }),
  );
  const results: Result[] = [];
  let circuitReason: string | undefined;
  let consecutiveEnvironment = 0;
  for (const scenario of selected) {
    const requestsBefore = budget.requests;
    const result = await runCase(scenario, {
      mode,
      seed,
      reference: refs.find((r) => r.id === scenario.id),
      adapter: circuitReason
        ? {
            model,
            complete: async () => {
              throw new Error("circuit-open");
            },
          }
        : adapter,
      brain: native.brain,
    });
    if (circuitReason) {
      result.status = "skipped";
      result.error = "CIRCUIT_OPEN_" + circuitReason;
    } else if (result.status === "environment_error") {
      consecutiveEnvironment++;
      if (
        [
          "AUTH_UNAVAILABLE",
          "RATE_LIMIT",
          "CLI_UNAVAILABLE",
          "MODEL_UNAVAILABLE",
          "CREDIT_UNAVAILABLE",
        ].includes(result.error ?? "") ||
        consecutiveEnvironment >= 2
      )
        circuitReason = result.error;
    } else consecutiveEnvironment = 0;
    result.agentUsage = structuredClone(result.usage);
    if (judge) {
      result.judge = await judgeResult(scenario, result, judge, calibration);
      addUsage(result.usage, result.judge.usage);
    }
    const attempted = budget.requests - requestsBefore;
    if (attempted > result.usage.requests) {
      result.usage.requests = attempted;
      result.usage.costUsd = null;
    }
    results.push(result);
    await writeFile(
      join(out, "results.jsonl"),
      results.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    console.log(
      `${result.id}: ${result.status}${result.error ? " (" + result.error + ")" : ""}${result.judge ? " judge=" + result.judge.status : ""}`,
    );
  }
  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    mode,
    interpretation:
      mode === "reference"
        ? "Harness/reference sanity check. NOT assistant capability or official benchmark performance."
        : "Real agent CLI inference + production MonoCode brain prompt + simulated tools. NOT live Host end-to-end.",
    datasetSha256: createHash("sha256")
      .update(await readFile(evalDataPath(root, "data/cases.jsonl")))
      .digest("hex"),
    seed,
    selectedIds: selected.map((c) => c.id),
    budget: {
      enforcement:
        mode === "pi"
          ? "request ceiling; USD reservation is an estimate, not a provider cap"
          : "request ceiling plus provider per-invocation USD limit",
      requestsAttempted: budget.requests,
      reservedUsd: budget.reservedUsd,
      reportedUsd: summarize(results).usage.costUsd,
    },
    ...summarize(results),
  };
  await writeFile(
    join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  const table = Object.entries(summary.byCategory)
    .map(
      ([k, v]) =>
        `| ${k} | ${v.passed} | ${v.failed} | ${v.excluded} | ${v.passRate === null ? "N/A" : (100 * v.passRate).toFixed(1) + "%"} |`,
    )
    .join("\n");
  const failures = results
    .filter((r) => r.status !== "passed")
    .map(
      (r) =>
        `- ${r.id}: ${r.status} ${r.error ?? ""}; failed assertions: ${r.checks
          .filter((c) => !c.passed)
          .map((c) => JSON.stringify(c.assertion))
          .join("; ")}`,
    )
    .join("\n");
  await writeFile(
    join(out, "report.md"),
    `# MonoCode evaluation report\n\n${summary.interpretation}\n\nStarted: ${startedAt}. Seed: ${seed}. Dataset SHA256: ${summary.datasetSha256}.\n\n| Category | Pass | Fail | Excluded | Hard pass rate |\n|---|---:|---:|---:|---:|\n${table}\n\nStatuses: ${JSON.stringify(summary.statuses)}\n\nUsage: ${JSON.stringify(summary.usage)}. Null cost means unavailable, not free. Attempted requests: ${budget.requests}; reserved estimate (provider cap only for Claude): $${budget.reservedUsd.toFixed(2)}.\n\nJudge: ${JSON.stringify(summary.judge)}. Composite: ${JSON.stringify(summary.composite)}. Rubric scores are advisory and cannot overturn hard assertions.\n\n${failures || "No hard assertion failures in this run."}\n\nSee results.jsonl for per-case trace, final state, checks, judge evidence and usage.\n`,
  );
  console.log(JSON.stringify(summary.statuses));
  if (results.some((r) => r.status !== "passed")) process.exitCode = 1;
} else throw new Error(`Unknown command ${command}`);
