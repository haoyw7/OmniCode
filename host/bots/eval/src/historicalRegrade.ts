import {
  ensureEvalData,
  readEvalText,
  assertEvalOutputOutsideProject,
} from "./evalData";
import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CaseSchema, type Scenario, type Result } from "./schema";
import type { Environment } from "./environment";
import {
  evaluate,
  LEGACY_SCORER_VERSION,
  SCORER_VERSION,
  type ScorerVersion,
} from "./scoring";
import { parseModelTurn, type TransportPolicyVersion } from "./transport";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const campaign = "reports/pi-breadth-2026-10-09";
export const HISTORICAL_DIAGNOSTICS = [
  { id: "retrieval-two-source", directory: "03-breadth", line: 1 },
  {
    id: "retrieval-injection-contradiction",
    directory: "18-second-representative",
    line: 1,
  },
  { id: "spreadsheets-weighted", directory: "06-breadth", line: 1 },
  {
    id: "spreadsheets-formula-injection",
    directory: "21-second-representative",
    line: 1,
  },
  { id: "memory-recall-before-answer", directory: "09-breadth", line: 1 },
  { id: "recovery-changing-language", directory: "10-breadth", line: 1 },
  { id: "security-file-system", directory: "27-full-smoke", line: 4 },
  { id: "structured-nested", directory: "15-breadth", line: 1 },
  { id: "degradation-tool-offline", directory: "27-full-smoke", line: 6 },
] as const;
const rawTerminalCases = new Set<string>([
  "spreadsheets-weighted",
  "recovery-changing-language",
  "degradation-tool-offline",
]);

/** Use only the stored snapshot; do not re-execute tools in a changed fixture environment. */
function gradeSnapshot(
  scenario: Scenario,
  historical: Result,
  final: string,
  scorerVersion: ScorerVersion,
) {
  const snapshot = {
    trace: structuredClone(historical.trace),
    state: structuredClone(historical.state),
    effects: structuredClone(historical.trace.filter((entry) => entry.effect)),
  } as Environment;
  const grade = evaluate(scenario, snapshot, final, { scorerVersion });
  const events = {
    expected: scenario.events.length,
    delivered: historical.eventsDelivered,
  };
  return {
    ...grade,
    passed: grade.passed && events.expected === events.delivered,
    eventDelivery: events,
  };
}
function parseTerminal(raw: string, version: TransportPolicyVersion) {
  try {
    const parsed = parseModelTurn(raw, { version });
    return { policy: version, ...parsed, error: null };
  } catch (error: any) {
    return {
      policy: version,
      kind: "rejected" as const,
      error: error.code ?? String(error),
    };
  }
}

export async function buildHistoricalRegrade(root: string) {
  await readEvalText(root, "reports/expanded-summary-2026-10-09/summary.json");
  await ensureEvalData(root, ["original"]);
  const sourceEvidenceSha256: Record<string, string> = {};
  const contents = new Map<string, string>();
  async function read(path: string) {
    if (contents.has(path)) return contents.get(path)!;
    const text = await readEvalText(root, path);
    contents.set(path, text);
    sourceEvidenceSha256[path] = digest(text);
    return text;
  }
  const cases = (await read("data/cases.jsonl"))
    .trim()
    .split("\n")
    .map((line) => CaseSchema.parse(JSON.parse(line)));
  await read("data/references.jsonl");
  for (const path of [
    "src/scoring.ts",
    "src/citation.ts",
    "src/schema.ts",
    "src/transport.ts",
    "src/historicalRegrade.ts",
    "bin/regrade_historical.mjs",
  ])
    await read(path);
  const historicalSummaryPath =
    "reports/expanded-summary-2026-10-09/summary.json";
  const originalSummary = JSON.parse(await read(historicalSummaryPath));
  const rows = [];
  for (const selected of HISTORICAL_DIAGNOSTICS) {
    const path = `${campaign}/${selected.directory}/results.jsonl`;
    const lines = (await read(path)).split("\n");
    const rowText = lines[selected.line - 1];
    const historical = JSON.parse(rowText) as Result;
    const scenario = cases.find((candidate) => candidate.id === selected.id);
    if (historical.id !== selected.id || !scenario)
      throw new Error(`Historical row identity mismatch: ${selected.id}`);
    if (digest(JSON.stringify(scenario)) !== historical.caseHash)
      throw new Error(`Historical case hash mismatch: ${selected.id}`);
    if (
      typeof historical.final !== "string" ||
      !Array.isArray(historical.trace) ||
      !historical.state
    )
      throw new Error(`Incomplete historical snapshot: ${selected.id}`);
    const lastOutput = historical.modelOutputs?.at(-1);
    if (typeof lastOutput !== "string")
      throw new Error(`Missing raw output: ${selected.id}`);
    const terminalParsing = {
      strict: parseTerminal(lastOutput, "envelope-strict-v1"),
      compatible: parseTerminal(lastOutput, "terminal-compatible-v2"),
    };
    const regrade = {
      kind: "observed-final-regrade-not-execution",
      legacy: gradeSnapshot(
        scenario,
        historical,
        historical.final,
        LEGACY_SCORER_VERSION,
      ),
      candidate: gradeSnapshot(
        scenario,
        historical,
        historical.final,
        SCORER_VERSION,
      ),
    };
    let transportCounterfactual = null;
    if (rawTerminalCases.has(selected.id)) {
      if (
        historical.error !== "INVALID_MODEL_OUTPUT" ||
        historical.final !== "" ||
        terminalParsing.strict.kind !== "rejected" ||
        terminalParsing.compatible.kind !== "final" ||
        terminalParsing.compatible.transport !== "raw-terminal"
      )
        throw new Error(`Counterfactual precondition mismatch: ${selected.id}`);
      transportCounterfactual = {
        kind: "raw-terminal-transport-counterfactual-not-execution",
        newAgentExecutions: 0,
        rawOutputIndex: historical.modelOutputs!.length - 1,
        rawOutput: lastOutput,
        strict: terminalParsing.strict,
        compatible: {
          ...terminalParsing.compatible,
          hardGrade: gradeSnapshot(
            scenario,
            historical,
            terminalParsing.compatible.final,
            SCORER_VERSION,
          ),
        },
      };
    }
    rows.push({
      id: selected.id,
      evidence: {
        path,
        line: selected.line,
        fileSha256: sourceEvidenceSha256[path],
        rowSha256: digest(rowText),
        caseHash: historical.caseHash,
      },
      historical,
      regrade,
      terminalParsing,
      transportCounterfactual,
    });
  }
  const counterfactuals = rows.flatMap((row) =>
    row.transportCounterfactual ? [row.transportCounterfactual] : [],
  );
  const summary = {
    mode: "offline-historical-regrade-no-model",
    interpretation:
      "Same stored final/trace/state, rescored offline. Counterfactual terminal parsing is not a new agent run or a demonstrated capability improvement.",
    additionalModelRequests: 0,
    newAgentExecutions: 0,
    additionalCostUsd: 0,
    historicalOriginal: {
      path: historicalSummaryPath,
      sha256: sourceEvidenceSha256[historicalSummaryPath],
      total: originalSummary.total,
      interpretation: originalSummary.interpretation,
    },
    observedFinalRegrade: {
      selectedCases: rows.length,
      legacyPassed: rows.filter((row) => row.regrade.legacy.passed).length,
      candidatePassed: rows.filter((row) => row.regrade.candidate.passed)
        .length,
      changedIds: rows
        .filter(
          (row) => row.regrade.legacy.passed !== row.regrade.candidate.passed,
        )
        .map((row) => row.id),
    },
    transportCounterfactuals: {
      cases: counterfactuals.length,
      compatibleHardPassed: counterfactuals.filter(
        (row) => row.compatible.hardGrade.passed,
      ).length,
      newAgentExecutions: 0,
    },
    scorerVersions: {
      legacy: LEGACY_SCORER_VERSION,
      candidate: SCORER_VERSION,
    },
    transportVersions: {
      legacy: "envelope-strict-v1",
      candidate: "terminal-compatible-v2",
    },
    datasetSha256: sourceEvidenceSha256["data/cases.jsonl"],
    referencesSha256: sourceEvidenceSha256["data/references.jsonl"],
    publicContinuation: "not_replayed_no_invented_calls",
    formalJudgeScore: null,
    sourceEvidenceSha256,
  };
  return { summary, rows };
}

export async function writeHistoricalRegrade(root: string, out: string) {
  await assertEvalOutputOutsideProject(root, out);
  const report = await buildHistoricalRegrade(root);
  // Verify before creating an output directory; a different snapshot must never be relabeled.
  for (const [path, expected] of Object.entries(
    report.summary.sourceEvidenceSha256,
  ))
    if (digest(await readEvalText(root, path)) !== expected)
      throw new Error(`Historical regrade input changed: ${path}`);
  await mkdir(out, { recursive: false }); // Existing evidence is never overwritten.
  await writeFile(
    join(out, "results.jsonl"),
    report.rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  await writeFile(
    join(out, "summary.json"),
    JSON.stringify(report.summary, null, 2) + "\n",
  );
  const pass = (value: boolean) => (value ? "pass" : "fail");
  const lines = [
    "# 历史原始轨迹离线重判比较",
    "",
    "本文件是离线诊断测量；新增模型请求 0、agent 执行 0、费用 $0。历史原始 final/trace/state/modelOutputs 和检查原分保留在 results.jsonl 的 historical 对象中。没有重新执行工具，没有重放后续模型回合。",
    "",
    `历史原创成绩仍为 **${report.summary.historicalOriginal.total.passed}/${report.summary.historicalOriginal.total.total}**；此处只选取计划 E1–E9 的九条失败轨迹。不得将本文件回填原成绩或宣称新模型能力提升。`,
    "",
    `相同已记录 final 重判：legacy-v1 **${report.summary.observedFinalRegrade.legacyPassed}/9** → citation-v2 **${report.summary.observedFinalRegrade.candidatePassed}/9**。唯一改变为 E1 retrieval-two-source，属于引用判分修正。`,
    "",
    "| Case | 历史状态 | 同一 final 旧 scorer | 同一 final 新 scorer | raw-terminal 反事实（非执行） | 原始证据 |",
    "|---|---|---|---|---|---|",
  ];
  for (const row of report.rows) {
    const cf = row.transportCounterfactual;
    lines.push(
      `| ${row.id} | ${row.historical.status} | ${pass(row.regrade.legacy.passed)} | ${pass(row.regrade.candidate.passed)} | ${cf ? pass(cf.compatible.hardGrade.passed) + "，非新agent成绩" : "—"} | [L${row.evidence.line}](../../${row.evidence.path}#L${row.evidence.line}) |`,
    );
  }
  lines.push(
    "",
    "三个终答反事实只将已有最后一次 modelOutputs 的原文交给 terminal-compatible-v2，并用原 trace/state 检查：旧 envelope 策略拒绝，新解析策略保留原文且硬断言可通过。历史 final 仍为空，原失败状态不变。",
    "",
  );
  for (const row of report.rows.filter((row) => row.transportCounterfactual))
    lines.push(
      `- ${row.id}: ${JSON.stringify(row.transportCounterfactual!.rawOutput)}`,
    );
  lines.push(
    "",
    "E7 错括号输出在两个 transport 版本下均拒绝，原 trace 仍为空。HotpotQA 未包含在九条原创重判中；没有虚构 read_passage、后续答案或新成绩。正式 judge 没有调用，分数 N/A。",
    "",
    "所有输入文件与评分代码 SHA-256 在 summary.json；caseHash 必须与原始记录一致，否则脚本拒绝运行。输出目录必须不存在，避免覆盖历史证据。",
    "",
    "复现命令（--out 应指向一个新的目录）：",
    "",
    "```sh",
    "node host/bots/eval/bin/regrade_historical.mjs --out /tmp/monocode-new-historical-regrade",
    "```",
    "",
  );
  await writeFile(join(out, "report.md"), lines.join("\n"));
  return report.summary;
}
