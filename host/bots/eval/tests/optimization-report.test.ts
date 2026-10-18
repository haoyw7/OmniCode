import { describe, it, expect } from "vitest";
import {
  summarizeOptimization,
  writeOptimizationReport,
} from "../src/optimizationReport";
describe("version-separated optimization report", () => {
  it("keeps two arms and changed scoring separate from historical scores", () => {
    const result = (status: string) => ({
      status,
      usage: { requests: 1, costUsd: 0.001, models: ["m"] },
      checks: [],
      scorerVersion: "citation-v2",
    });
    const rows = [
      {
        phase: "prompt",
        arm: "control",
        id: "a",
        category: "retrieval",
        result: result("failed"),
      },
      {
        phase: "prompt",
        arm: "monocode",
        id: "a",
        category: "retrieval",
        result: result("passed"),
      },
    ];
    const s = summarizeOptimization(
      rows as any,
      [
        { id: "a", category: "retrieval" },
        { id: "b", category: "memory" },
      ],
      [],
    );
    expect(s.groups["prompt/control"].passed).toBe(0);
    expect(s.groups["prompt/monocode"].passed).toBe(1);
    expect(s.pairs.prompt.onlyMonocode).toBe(1);
    expect(s.notRun).toEqual(["b"]);
    expect(s.formalJudgeScore).toBeNull();
  });
  it("does not count no-request budget skips or reference replay as inference", () => {
    const rows = [
      {
        phase: "prompt",
        arm: "monocode",
        id: "a",
        category: "memory",
        result: {
          status: "budget_exhausted",
          usage: { requests: 0, costUsd: 0 },
        },
      },
      {
        phase: "reference",
        arm: "reference",
        id: "b",
        category: "files",
        result: { status: "passed", usage: { requests: 0, costUsd: 0 } },
      },
    ];
    const s = summarizeOptimization(
      rows as any,
      [
        { id: "a", category: "memory" },
        { id: "b", category: "files" },
      ],
      [],
    );
    expect(s.executedUniqueCases).toBe(0);
    expect(s.notRun).toEqual(["a", "b"]);
  });
  it("reports unknown safety exposure and pending quality without changing strict outcome", () => {
    const rows = [
      {
        phase: "prompt",
        arm: "monocode",
        id: "a",
        category: "security",
        result: {
          status: "failed",
          usage: { requests: 1, costUsd: null },
          safety: { attackExposure: "not_read", defenseSuccess: null },
          checks: [],
        },
      },
    ];
    const s = summarizeOptimization(
      rows as any,
      [{ id: "a", category: "security" }],
      [{ caseId: "a", state: "pending" }],
    );
    expect(s.groups["prompt/monocode"].failed).toBe(1);
    expect(s.qualityPending).toEqual(["a"]);
    expect(s.safety.exposed).toBe(0);
    expect(s.safety.defenseSuccessRate).toBeNull();
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const measuredRow = (id: string, overrides: any = {}) => ({
  phase: "expansion",
  arm: "monocode",
  id,
  category: "security",
  source: "bipia",
  result: {
    status: "passed",
    task_pass: true,
    safety_pass: true,
    variant: "attacked",
    usage: {
      requests: 1,
      latencyMs: 12,
      costUsd: 0.001,
      inputTokens: 10,
      outputTokens: 4,
    },
    safety: {
      attackExposure: "read",
      effectObservation: "complete",
      hardSafety: true,
      agentSafetyIntent: true,
      executedEffects: [],
      defenseSuccess: true,
    },
    grade: {
      metrics: { attack_metric_applicable: true, attack_success: false },
    },
    ...overrides,
  },
});
it("reports exposure on eligible annotated attacks while separating intent, hard safety, defense and BIPIA ASR", () => {
  const rows = [
    measuredRow("u/attack"),
    measuredRow("v/attack", {
      status: "failed",
      task_pass: false,
      safety_pass: false,
      safety: {
        attackExposure: "not_read",
        effectObservation: "complete",
        hardSafety: true,
        agentSafetyIntent: false,
        executedEffects: [],
        defenseSuccess: null,
      },
      grade: {
        metrics: { attack_metric_applicable: true, attack_success: true },
      },
    }),
    measuredRow("w/attack", {
      safety: {
        attackExposure: "unknown",
        effectObservation: "unknown",
        hardSafety: true,
        agentSafetyIntent: true,
        defenseSuccess: null,
      },
    }),
    measuredRow("skip", { status: "budget_exhausted", usage: { requests: 0 } }),
  ];
  const catalog = [
    { id: "u/attack", category: "security", source: "bipia", upstreamId: "u" },
    { id: "u/clean", category: "security", source: "bipia", upstreamId: "u" },
    ...["v", "w"].map((id) => ({
      id: `${id}/attack`,
      category: "security",
      source: "bipia",
      upstreamId: id,
    })),
    {
      id: "skip",
      category: "security",
      source: "original",
      upstreamId: "skip",
    },
  ];
  const s = summarizeOptimization(rows as any, catalog, []);
  expect(s.safety.exposureCoverage).toMatchObject({
    count: 2,
    read: 1,
    not_read: 1,
    unknown: 1,
    rate: 0.5,
  });
  expect(s.safety.hardSafety).toMatchObject({ count: 2, passed: 2, rate: 1 });
  expect(s.safety.agentSafetyIntent).toMatchObject({
    count: 3,
    passed: 2,
    rate: 2 / 3,
  });
  expect(s.safety.defenseSuccessRate).toBe(1);
  expect(s.bipia.attackSuccessRate).toMatchObject({
    count: 3,
    successes: 1,
    rate: 1 / 3,
  });
  expect(s.catalogUniqueUpstreamCases).toBe(4);
  expect(s.executedUniqueUpstreamCases).toBe(3);
  expect(s.upstreamCountsBySource.bipia).toEqual({
    catalog: 3,
    executed: 3,
    notRun: 0,
  });
  expect(
    s.measurementsByGroup["expansion/monocode"].safety.exposureCoverage.rate,
  ).toBe(0.5);
});
it("exports separate measurements and usage columns with N/A for unknown/unobserved and no actual requests", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "optimization-report-metrics-"),
  );
  try {
    await writeOptimizationReport(
      directory,
      [
        measuredRow("attack"),
        measuredRow("skip", {
          status: "budget_exhausted",
          usage: {
            requests: 0,
            costUsd: 0,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
          },
        }),
      ] as any,
      [
        {
          id: "attack",
          category: "security",
          source: "bipia",
          upstreamId: "u",
        },
        { id: "skip", category: "security" },
        { id: "not-run", category: "memory" },
      ],
      [],
      {},
      [],
    );
    const rows = (await readFile(join(directory, "cases.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(rows[0]).toMatchObject({
      taskPass: true,
      safetyPass: true,
      attackExposure: "read",
      hardSafety: true,
      agentSafetyIntent: true,
      executedEffects: 0,
      defenseSuccess: true,
      bipiaAttackSuccess: false,
      latencyMs: 12,
      costUsd: 0.001,
      inputTokens: 10,
      outputTokens: 4,
    });
    for (const row of rows.slice(1))
      for (const field of [
        "taskPass",
        "safetyPass",
        "attackExposure",
        "agentSafetyIntent",
        "executedEffects",
        "defenseSuccess",
        "bipiaAttackSuccess",
        "latencyMs",
        "costUsd",
        "inputTokens",
        "outputTokens",
      ])
        expect(row[field], `${row.id}/${field}`).toBeNull();
    const csv = await readFile(join(directory, "cases.csv"), "utf8"),
      html = await readFile(join(directory, "scores.html"), "utf8"),
      md = await readFile(join(directory, "scores.md"), "utf8");
    for (const field of [
      "taskPass",
      "safetyPass",
      "attackExposure",
      "agentSafetyIntent",
      "executedEffects",
      "defenseSuccess",
      "bipiaAttackSuccess",
      "latencyMs",
      "costUsd",
      "inputTokens",
      "outputTokens",
    ])
      expect(csv.split("\n")[0]).toContain(field);
    for (const title of [
      "任务通过",
      "安全通过",
      "暴露",
      "意图安全",
      "执行效果",
      "防御成功",
      "BIPIA ASR",
      "延迟ms",
      "成本USD",
      "输入tokens",
      "输出tokens",
    ]) {
      expect(html).toContain(title);
      expect(md).toContain(title);
    }
    expect(html).toContain("N/A");
    expect(md).toContain("N/A");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("exports partial known tokens separately when one request has unknown usage", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "optimization-partial-tokens-"),
  );
  try {
    await writeOptimizationReport(
      directory,
      [
        measuredRow("partial", {
          status: "environment_error",
          error: "UNKNOWN_PROVIDER_USAGE",
          usage: {
            requests: 2,
            costUsd: null,
            inputTokens: 120,
            outputTokens: 30,
            latencyMs: 12,
          },
        }),
        measuredRow("complete"),
      ],
      [
        { id: "partial", category: "security" },
        { id: "complete", category: "security" },
      ],
      [],
      {},
      [],
    );
    const rows = (await readFile(join(directory, "cases.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows[0]).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      knownInputTokens: 120,
      knownOutputTokens: 30,
      tokenUsageComplete: false,
    });
    expect(rows[1]).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      knownInputTokens: 10,
      knownOutputTokens: 4,
      tokenUsageComplete: true,
    });
    const csv = await readFile(join(directory, "cases.csv"), "utf8");
    expect(csv.split("\n")[0]).toContain("tokenUsageComplete");
    expect(csv.split("\n")[0]).toContain("knownInputTokens");
    for (const file of ["scores.md", "scores.html"]) {
      const text = await readFile(join(directory, file), "utf8");
      expect(text).toContain("已知输入tokens");
      expect(text).toContain("token用量完整");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
