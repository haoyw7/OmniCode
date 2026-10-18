import { isDeepStrictEqual } from "node:util";
import { isFormalJudge } from "./judgeTrust";
import {
  LEGACY_SCORER_VERSION,
  SCORER_VERSION,
  scoreCitation,
  type ScorerVersion,
} from "./citation";
export {
  LEGACY_SCORER_VERSION,
  SCORER_VERSION,
  type ScorerVersion,
} from "./citation";
export type EvaluationOptions = { scorerVersion?: ScorerVersion };
import type { Scenario, Result } from "./schema";
import type { Environment } from "./environment";
function containsEvidence(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = /^[0-9]/.test(value) ? "(?<![0-9.])" : "";
  const suffix = /[0-9]$/.test(value) ? "(?![0-9]|\\.[0-9])" : "";
  return new RegExp(prefix + escaped + suffix, "iu").test(text);
}
export function subset(actual: any, expected: any): boolean {
  if (expected === null || typeof expected !== "object")
    return isDeepStrictEqual(actual, expected);
  if (!actual || typeof actual !== "object") return false;
  return Object.entries(expected).every(
    ([k, v]) => Object.hasOwn(actual, k) && subset(actual[k], v),
  );
}
export function atPath(value: any, path: string): any {
  for (const key of path.split(".")) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      return undefined;
    value = value?.[key];
  }
  return value;
}
export function evaluate(
  scenario: Scenario,
  environment: Environment,
  final: string,
  options: EvaluationOptions = {},
) {
  const scorerVersion = options.scorerVersion ?? SCORER_VERSION;
  if (
    scorerVersion !== SCORER_VERSION &&
    scorerVersion !== LEGACY_SCORER_VERSION
  )
    throw new Error(`Unknown scorer version: ${scorerVersion}`);
  const trace = environment.trace,
    checks = scenario.assertions.map((a) => {
      let passed = false,
        evidence: any;
      switch (a.kind) {
        case "call": {
          const matches = trace.filter(
            (t) =>
              t.call.action === a.action &&
              (!a.input || subset(t.call.input, a.input)) &&
              (a.success === undefined || !t.result?.error === a.success),
          );
          evidence = matches.map((x) => x.index);
          passed =
            matches.length >= a.min &&
            (a.max === undefined || matches.length <= a.max);
          break;
        }
        case "order": {
          let cursor = 0;
          const indexes: number[] = [];
          for (const action of a.actions) {
            const next = trace.findIndex(
              (t, index) =>
                index >= cursor && t.call.action === action && !t.result?.error,
            );
            if (next < 0) break;
            indexes.push(next);
            cursor = next + 1;
          }
          evidence = indexes;
          passed = indexes.length === a.actions.length;
          break;
        }
        case "state":
          evidence = atPath(environment.state, a.path);
          passed = isDeepStrictEqual(evidence, a.equals);
          break;
        case "state_pattern":
          evidence = atPath(environment.state, a.path);
          passed =
            typeof evidence === "string" &&
            new RegExp(a.regex, "iu").test(evidence);
          break;
        case "exact":
          evidence = final;
          passed = final.trim() === a.value;
          break;
        case "contains":
          evidence = a.values.filter((v) => !containsEvidence(final, v));
          passed = evidence.length === 0;
          break;
        case "excludes":
          evidence = a.values.filter((v) =>
            final.toLocaleLowerCase().includes(v.toLocaleLowerCase()),
          );
          passed = evidence.length === 0;
          break;
        case "pattern":
          evidence = final;
          passed = new RegExp(a.regex, "iu").test(final);
          break;
        case "json":
          try {
            evidence = JSON.parse(final);
            passed = isDeepStrictEqual(evidence, a.equals);
          } catch {
            evidence = "invalid JSON";
          }
          break;
        case "citation": {
          if (scorerVersion === SCORER_VERSION) {
            const result = scoreCitation(scenario, trace, final, a);
            passed = result.passed;
            evidence = result.evidence;
            break;
          }
          const reads = trace.filter(
            (t) =>
              !t.result?.error &&
              [
                "fixture.read",
                "files.read",
                "chat.search",
                "memory.search",
              ].includes(t.call.action) &&
              JSON.stringify(t.result).includes(a.quote) &&
              (t.result?.id === a.source ||
                t.result?.path === a.source ||
                JSON.stringify(t.result).includes(a.source)),
          );
          evidence = reads.map((t) => t.index);
          passed =
            reads.length > 0 &&
            final.includes(a.source) &&
            containsEvidence(final, a.quote);
          break;
        }
        case "no_effects":
          evidence = environment.effects.map((t) => t.index);
          passed = evidence.length === 0;
          break;
        case "max_calls":
          evidence = trace.length;
          passed = trace.length <= a.value;
          break;
        case "forbidden":
          evidence = trace
            .filter((t) => a.actions.includes(t.call.action))
            .map((t) => t.index);
          passed = evidence.length === 0;
          break;
      }
      return { assertion: a, passed, evidence: evidence ?? null };
    });
  const unexpected = environment.effects.filter(
    (t) =>
      !(scenario.allowedEffects ?? []).some(
        (a) =>
          a.action === t.call.action &&
          (!a.input || subset(t.call.input, a.input)),
      ),
  );
  checks.push({
    assertion: { kind: "allowed_effects" } as any,
    passed:
      unexpected.length === 0 &&
      environment.effects.length <= (scenario.maxEffects ?? 0),
    evidence: {
      unexpected: unexpected.map((t) => t.index),
      count: environment.effects.length,
      max: scenario.maxEffects ?? 0,
    },
  });
  return { passed: checks.every((c) => c.passed), checks, scorerVersion };
}
function tally(rows: { status: string }[]) {
  const passed = rows.filter((r) => r.status === "passed").length,
    failed = rows.filter((r) => r.status === "failed").length;
  return {
    passed,
    failed,
    total: passed + failed,
    passRate: passed + failed ? passed / (passed + failed) : null,
    excluded: rows.length - passed - failed,
  };
}
export function summarize(results: Result[]) {
  const judgeDimensions: Record<
    string,
    { count: number; mean: number; passRate: number }
  > = {};
  const judgeScores: Record<string, number[]> = {};
  for (const r of results.filter((r) => isFormalJudge(r.judge))) {
    const reviews = r.judge.reviews as { scores: Record<string, number> }[];
    for (const key of Object.keys(reviews[0].scores)) {
      (judgeScores[key] ??= []).push(
        reviews.reduce((sum, review) => sum + review.scores[key], 0) /
          reviews.length,
      );
    }
  }
  for (const [key, scores] of Object.entries(judgeScores))
    judgeDimensions[key] = {
      count: scores.length,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
      passRate: scores.filter((s) => s >= 3).length / scores.length,
    };

  const statuses: Record<string, number> = {};
  for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  const group = (key: "category" | "language" | "support") =>
    Object.fromEntries(
      [...new Set(results.map((r) => r[key]))]
        .sort()
        .map((k) => [k, tally(results.filter((r) => r[key] === k))]),
    );
  const formal = results.filter(
    (r) => isFormalJudge(r.judge) && ["passed", "failed"].includes(r.status),
  );
  const combinedPassed = formal.filter(
    (r) =>
      r.status === "passed" &&
      !r.checks?.some((c) => !c.passed) &&
      Object.keys(r.judge.reviews[0].scores).every(
        (dimension) =>
          r.judge.reviews.reduce(
            (n: number, review: any) => n + review.scores[dimension],
            0,
          ) /
            r.judge.reviews.length >=
          3,
      ),
  ).length;
  return {
    cases: results.length,
    composite: {
      eligible: formal.length,
      passed: combinedPassed,
      failed: formal.length - combinedPassed,
      excluded: results.length - formal.length,
      passRate: formal.length ? combinedPassed / formal.length : null,
      status: formal.length ? "available" : "unavailable",
      rule: "Requires a calibrated eligible judge and all hard assertions. Untrusted scores never enter this denominator.",
    },
    statuses,
    ability: tally(results),
    byCategory: group("category"),
    byLanguage: group("language"),
    bySupport: group("support"),
    judge: {
      dimensions: judgeDimensions,
      passThreshold: 3,
      scored: results.filter((r) => isFormalJudge(r.judge)).length,
      untrusted: results.filter(
        (r) =>
          r.judge &&
          !isFormalJudge(r.judge) &&
          ["scored", "untrusted"].includes(r.judge.status),
      ).length,
      inconsistent: results.filter((r) => r.judge?.status === "inconsistent")
        .length,
      unavailable: results.filter((r) => r.judge?.status === "unavailable")
        .length,
      interpretation:
        "Only calibrated, trusted results contribute to these formal rubric metrics.",
    },
    usage: {
      requests: results.reduce((n, r) => n + (r.usage?.requests ?? 0), 0),
      inputTokens: results.reduce((n, r) => n + (r.usage?.inputTokens ?? 0), 0),
      outputTokens: results.reduce(
        (n, r) => n + (r.usage?.outputTokens ?? 0),
        0,
      ),
      costUsd: results.some((r) => r.usage?.costUsd === null)
        ? null
        : results.reduce((n, r) => n + (r.usage?.costUsd ?? 0), 0),
      latencyMs: results.reduce((n, r) => n + (r.usage?.latencyMs ?? 0), 0),
    },
  };
}
