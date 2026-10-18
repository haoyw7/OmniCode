import { evalDataPath } from "../src/evalData";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
const root = resolve("host/bots/eval");
const temp = mkdtempSync(join(tmpdir(), "historical-regrade-test-"));
const out = join(temp, "report");
let execution: ReturnType<typeof spawnSync> | undefined;
function report() {
  execution ??= spawnSync(
    process.execPath,
    [join(root, "bin/regrade_historical.mjs"), "--out", out],
    { encoding: "utf8" },
  );
  expect(execution.status, String(execution.stderr)).toBe(0);
  return {
    summary: JSON.parse(readFileSync(join(out, "summary.json"), "utf8")),
    rows: readFileSync(join(out, "results.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  };
}
afterAll(() => rmSync(temp, { recursive: true, force: true }));
describe.skipIf(
  !existsSync(
    evalDataPath(root, "reports/expanded-summary-2026-10-09/summary.json"),
  ) || !existsSync(evalDataPath(root, "data/cases.jsonl")),
)("offline historical measurement", () => {
  it("reports zero new executions and separates observed-final regrading", () => {
    const { summary, rows } = report();
    expect(summary.mode).toBe("offline-historical-regrade-no-model");
    expect(summary.additionalModelRequests).toBe(0);
    expect(summary.newAgentExecutions).toBe(0);
    expect(summary.observedFinalRegrade).toEqual({
      selectedCases: 9,
      legacyPassed: 0,
      candidatePassed: 1,
      changedIds: ["retrieval-two-source"],
    });
    expect(rows).toHaveLength(9);
    expect(summary.historicalOriginal.total.passed).toBe(23);
    expect(summary.historicalOriginal.total.total).toBe(32);
  });
  it("preserves every selected historical final, trace, state and raw output byte value", () => {
    for (const row of report().rows) {
      const source = JSON.parse(
        readFileSync(evalDataPath(root, row.evidence.path), "utf8").split("\n")[
          row.evidence.line - 1
        ],
      );
      expect(row.historical).toEqual(source);
      expect(row.regrade.legacy.scorerVersion).toBe("legacy-v1");
      expect(row.regrade.candidate.scorerVersion).toBe("citation-v2");
      expect(row.evidence.fileSha256).toBe(
        createHash("sha256")
          .update(readFileSync(evalDataPath(root, row.evidence.path)))
          .digest("hex"),
      );
    }
  });
  it("keeps the 22, Chinese and fallback raw-terminal outputs explicitly counterfactual", () => {
    const { summary, rows } = report();
    expect(summary.transportCounterfactuals).toEqual({
      cases: 3,
      compatibleHardPassed: 3,
      newAgentExecutions: 0,
    });
    for (const id of [
      "spreadsheets-weighted",
      "recovery-changing-language",
      "degradation-tool-offline",
    ]) {
      const row = rows.find((entry) => entry.id === id);
      expect(row.historical.final).toBe("");
      expect(row.regrade.candidate.passed).toBe(false);
      expect(row.transportCounterfactual.kind).toBe(
        "raw-terminal-transport-counterfactual-not-execution",
      );
      expect(row.transportCounterfactual.strict.error).toBe(
        "INVALID_MODEL_OUTPUT",
      );
      expect(row.transportCounterfactual.compatible.final).toBe(
        row.historical.modelOutputs.at(-1),
      );
      expect(row.transportCounterfactual.compatible.hardGrade.passed).toBe(
        true,
      );
    }
  });
  it("does not repair or execute the malformed security output or invent Hotpot calls", () => {
    const { rows, summary } = report();
    const row = rows.find((entry) => entry.id === "security-file-system");
    expect(row.historical.trace).toEqual([]);
    expect(row.terminalParsing.compatible.error).toBe("INVALID_MODEL_OUTPUT");
    expect(row.transportCounterfactual).toBeNull();
    expect(rows.every((entry) => !entry.id.includes("hotpot"))).toBe(true);
    expect(summary.publicContinuation).toBe("not_replayed_no_invented_calls");
  });
  it("refuses to overwrite a completed report", () => {
    report();
    const previous = readFileSync(join(out, "summary.json"), "utf8");
    const again = spawnSync(
      process.execPath,
      [join(root, "bin/regrade_historical.mjs"), "--out", out],
      { encoding: "utf8" },
    );
    expect(again.status).not.toBe(0);
    expect(readFileSync(join(out, "summary.json"), "utf8")).toBe(previous);
  });
});
