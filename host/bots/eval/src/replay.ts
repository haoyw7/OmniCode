import {
  assertEvalOutputOutsideProject,
  requireEvalInputPath,
} from "./evalData";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  realpath,
} from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { Scenario, Result } from "./schema";
import { summarize } from "./scoring";
import { applyJudgeTrust, loadCalibrationRegistry } from "./judgeTrust";
import {
  JUDGE_PROTOCOL_HASH,
  JUDGE_RUBRIC_HASH,
  validateRecordedJudge,
} from "./judge";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export async function replayCampaign(
  root: string,
  campaign: string,
  out: string,
  cases: Scenario[],
) {
  await assertEvalOutputOutsideProject(root, out);
  campaign = await requireEvalInputPath(root, campaign);
  const evidence: Record<string, string> = {};
  const read = async (path: string) => {
    const actual = await realpath(path),
      rel = relative(campaign, actual);
    if (
      rel === ".." ||
      rel.startsWith("../") ||
      rel.startsWith("..\\") ||
      isAbsolute(rel)
    )
      throw new Error("Campaign evidence escapes its directory");
    const text = await readFile(actual, "utf8");
    evidence[path] = digest(text);
    return text;
  };
  const jsonl = async (path: string) =>
    (await read(path))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const inside = (name: string) => {
    const path = resolve(campaign, name),
      rel = relative(campaign, path);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("Campaign path escapes its directory");
    return path;
  };
  const ledger = JSON.parse(await read(join(campaign, "campaign.json")));
  if (!ledger.finishedAt) throw new Error("Campaign is incomplete");
  const registry = await loadCalibrationRegistry(root),
    byId = new Map(cases.map((c) => [c.id, c]));
  const results: Result[] = [],
    anchors: any[] = [],
    extra: any[] = [],
    historical: any[] = [];
  for (const run of ledger.runs) {
    if (!run.directory) continue;
    const directory = inside(run.directory);
    historical.push(JSON.parse(await read(join(directory, "summary.json"))));
    for (const raw of await jsonl(join(directory, "results.jsonl"))) {
      const scenario = byId.get(raw.id);
      if (!scenario || digest(JSON.stringify(scenario)) !== raw.caseHash)
        throw new Error(`Case version mismatch: ${raw.id}`);
      results.push({
        ...raw,
        provenance: scenario.provenance,
        sourceRun: run.directory,
      } as Result);
    }
  }
  for (const entry of await readdir(campaign, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = inside(entry.name);
    let summary: any;
    try {
      summary = JSON.parse(await read(join(directory, "summary.json")));
    } catch (error: any) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (summary.kind !== "judge-extension") continue;
    historical.push(summary);
    for (const row of await jsonl(join(directory, "results.jsonl")))
      (row.kind === "synthetic-objective-judge-anchor" ? anchors : extra).push(
        row,
      );
  }
  for (const row of extra) {
    const target = results.find((r) => r.id === row.id);
    if (!target || target.caseHash !== row.caseHash)
      throw new Error(`Extension case mismatch: ${row.id}`);
    if (target.judge)
      throw new Error(
        `Multiple judge attempts require explicit selection: ${row.id}`,
      );
    target.judge = row.judge;
  }
  for (const result of results) {
    if (!result.judge) continue;
    const scenario = byId.get(result.id)!;
    const raw = structuredClone(result.judge);
    const checked = validateRecordedJudge(raw, scenario, result);
    result.judge = {
      ...applyJudgeTrust(
        checked,
        registry,
        JUDGE_PROTOCOL_HASH,
        scenario.rubric,
        JUDGE_RUBRIC_HASH,
      ),
      rawResult: raw,
    };
  }
  const planned = ledger.planned.flatMap((p: any) => p.ids) as string[];
  const unrunIds = planned.filter((id) => !results.some((r) => r.id === id));
  const base = summarize(results);
  const rawJudgeCounts: Record<string, number> = {};
  for (const result of results)
    if (result.judge)
      rawJudgeCounts[result.judge.rawStatus] =
        (rawJudgeCounts[result.judge.rawStatus] ?? 0) + 1;
  const sourceUsage = Object.fromEntries(
    ["requests", "inputTokens", "outputTokens", "latencyMs"].map((key) => [
      key,
      historical.reduce((sum, s) => sum + s.usage[key], 0),
    ]),
  );
  const anchorReports = anchors.map((a) => ({
    ...a,
    judge: {
      ...applyJudgeTrust(
        a.judge,
        registry,
        JUDGE_PROTOCOL_HASH,
        undefined,
        JUDGE_RUBRIC_HASH,
      ),
      rawResult: a.judge,
    },
  }));
  const summary = {
    ...base,
    mode: "offline-replay-no-inference",
    interpretation:
      "Hard grades are preserved. Raw judge scores are retained but excluded from formal rubric/composite rates unless current matching calibration passes.",
    additionalModelRequests: 0,
    plannedCases: planned.length,
    unrunIds,
    calibrationRegistry: registry ?? null,
    rawJudgeCounts,
    sourceCampaignUsage: {
      ...sourceUsage,
      costUsd: historical.some((s) => s.usage.costUsd === null)
        ? null
        : historical.reduce((sum, s) => sum + s.usage.costUsd, 0),
    },
    syntheticAnchors: anchorReports.map((a) => ({
      id: a.id,
      status: a.judge.status,
      trust: a.judge.trust,
      reason: a.judge.reason,
      expectation: a.anchorExpectation,
    })),
    sourceEvidenceSha256: evidence,
  };
  // Never overwrite evidence or prior summaries.
  await mkdir(out, { recursive: false });
  await writeFile(
    join(out, "results.jsonl"),
    results.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  await writeFile(
    join(out, "anchors.jsonl"),
    anchorReports.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  await writeFile(
    join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  const table = Object.entries(base.byCategory)
    .map(
      ([name, value]) =>
        `| ${name} | ${value.passed} | ${value.failed} | ${value.excluded} |`,
    )
    .join("\n");
  const report = `# Calibration-gated offline replay\n\n${summary.interpretation}\n\nAdditional model calls: **0**. Hard results: ${JSON.stringify(base.statuses)}. Planned-but-unrun IDs: ${JSON.stringify(unrunIds)}.\n\nJudge: **${base.judge.scored} formally eligible; ${base.judge.untrusted} untrusted; ${base.judge.inconsistent} inconsistent; ${base.judge.unavailable} unavailable**. Formal rubric dimensions: ${JSON.stringify(base.judge.dimensions)}. Composite pass rate: **${base.composite.passRate === null ? "N/A" : base.composite.passRate}** (eligible ${base.composite.eligible}, excluded ${base.composite.excluded}).\n\nCalibration: ${JSON.stringify(registry?.records.map((r) => ({ model: r.modelId, status: r.status, checks: r.checks })) ?? "missing")}. A failed or missing calibration cannot be promoted by high raw scores.\n\n| Dimension | Hard pass | Hard fail | Excluded |\n|---|---:|---:|---:|\n${table}\n\nRaw judge statuses retained for audit: ${JSON.stringify(rawJudgeCounts)}. Raw reviews and evidence are in results.jsonl; synthetic anchors are separate. The original campaign files were read only; hashes are in summary.json.\n\nHistorical campaign usage, not new spending: ${JSON.stringify(summary.sourceCampaignUsage)}.\n`;
  await writeFile(join(out, "report.md"), report);
  for (const [path, sha] of Object.entries(evidence))
    if (digest(await readFile(path, "utf8")) !== sha)
      throw new Error(`Source changed during replay: ${path}`);
  return {
    statuses: base.statuses,
    judge: base.judge,
    composite: base.composite,
    additionalModelRequests: 0,
  };
}
