import { describe, expect, it } from "vitest";
import {
  runPublicEpisode,
  summarizePublic,
  sourceMetrics,
} from "../src/publicRunner";
import { emptyUsage, Budget } from "../src/adapters";
import { EvalError } from "../src/schema";

const meta = {
  id: "test/1",
  source: "test",
  category: "answer",
  variant: "original",
  upstream_id: "1",
  provenance: {},
  caseHash: "x",
};
function fixture() {
  const trace: unknown[] = [];
  return {
    async request(command: any) {
      if (command.op === "init")
        return { prompt: "Answer yes", tools: [], case: meta };
      if (command.op === "validate_calls") return { valid: true, rejected: [] };
      if (command.op === "reference") return [{ calls: [], final: "yes" }];
      if (command.op === "trace") return trace;
      if (command.op === "call") {
        trace.push(command);
        return { ok: true };
      }
      if (command.op === "grade")
        return {
          passed: command.final === "yes",
          checks: [{ name: "answer", passed: command.final === "yes" }],
        };
      throw Error("unexpected");
    },
  };
}

describe("public benchmark runner", () => {
  it("rejects nonfinite request budgets before calling a model", () => {
    for (const [usd, perCall] of [
      [NaN, 0.01],
      [Infinity, 0.01],
      [1, NaN],
      [1, Infinity],
    ])
      expect(() => new Budget(100, usd, perCall)).toThrow("INVALID_BUDGET");
  });
  it("counts a forbidden native tool attempt as a capability failure", async () => {
    const result = await runPublicEpisode(meta, fixture(), {
      mode: "pi",
      seed: 17,
      maxSteps: 2,
      adapter: {
        model: "test",
        complete: async () => {
          throw new EvalError("NATIVE_TOOL_VIOLATION");
        },
      },
    });
    expect(result.status).toBe("failed");
    expect(summarizePublic([result]).sources.test.failed).toBe(1);
  });
  it("uses only attacked scored variants in ASR and matches clean pairs", async () => {
    const base = await runPublicEpisode(meta, fixture(), {
      mode: "reference",
      seed: 17,
      maxSteps: 2,
    });
    const clean = {
      ...base,
      source: "bipia",
      grade: {
        passed: true,
        checks: [],
        metrics: {
          answer_correct: true,
          attack_success: false,
          attack_metric_applicable: false,
        },
      },
    };
    const attack = {
      ...clean,
      id: "test/attack",
      grade: {
        passed: false,
        checks: [],
        metrics: {
          answer_correct: false,
          attack_success: true,
          attack_metric_applicable: true,
        },
      },
      status: "failed" as const,
    };
    const unavailable = { ...attack, status: "environment_error" as const };
    const summary = sourceMetrics([clean, attack, unavailable]);
    expect(summary.bipia.attackSuccessRate).toEqual({ count: 1, rate: 1 });
    expect(summary.bipia.pairedDegradation).toBe(1);
    expect(summary.bipia.cleanAnswerAccuracy).toEqual({ count: 1, rate: 1 });
  });
  it("marks references as harness-only and accepts plain terminal answers", async () => {
    const ref = await runPublicEpisode(meta, fixture(), {
      mode: "reference",
      seed: 17,
      maxSteps: 2,
    });
    expect(ref.status).toBe("passed");
    expect(ref.mode).toBe("harness-reference-NOT-agent-score");
    const real = await runPublicEpisode(meta, fixture(), {
      mode: "pi",
      seed: 17,
      maxSteps: 2,
      adapter: {
        model: "test",
        complete: async () => ({
          text: "yes",
          usage: { ...emptyUsage(), requests: 1 },
        }),
      },
    });
    expect(real.status).toBe("passed");
    expect(real.transport).toBe("raw-terminal");
  });
  it("does not count an unavailable model as capability failure", async () => {
    const result = await runPublicEpisode(meta, fixture(), {
      mode: "pi",
      seed: 17,
      maxSteps: 2,
      adapter: {
        model: "test",
        complete: async () => {
          throw new EvalError("AUTH_UNAVAILABLE");
        },
      },
    });
    expect(result.status).toBe("environment_error");
    const summary = summarizePublic([result]);
    expect(summary.sources.test.passRate).toBeNull();
    expect(summary.sources.test.failed).toBe(0);
  });
  it("malformed tool transport is a failure and cannot execute", async () => {
    const result = await runPublicEpisode(meta, fixture(), {
      mode: "pi",
      seed: 17,
      maxSteps: 2,
      adapter: {
        model: "test",
        complete: async () => ({
          text: '{"calls":"unsafe"}',
          usage: emptyUsage(),
        }),
      },
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("INVALID_MODEL_OUTPUT");
    expect(result.trace).toEqual([]);
  });
  it("keeps budget exhaustion out of scored denominator", async () => {
    const result = await runPublicEpisode(meta, fixture(), {
      mode: "pi",
      seed: 17,
      maxSteps: 2,
      adapter: {
        model: "test",
        complete: async () => {
          throw new EvalError("BUDGET_EXHAUSTED");
        },
      },
    });
    expect(result.status).toBe("budget_exhausted");
    expect(summarizePublic([result]).sources.test.passRate).toBeNull();
  });
});

function responses(texts: string[]) {
  let n = 0;
  return {
    model: "offline",
    complete: async () => ({ text: texts[n++], usage: emptyUsage() }),
  };
}
it.each(["", " "])(
  "public tools continue after blank final %j",
  async (blank) => {
    const bridge = fixture();
    const result = await runPublicEpisode(meta, bridge, {
      mode: "pi",
      seed: 17,
      maxSteps: 2,
      adapter: responses([
        JSON.stringify({
          calls: [{ action: "read", requestId: "r", input: {} }],
          final: blank,
        }),
        '{"final":"yes"}',
      ]),
    });
    expect(result.status).toBe("passed");
    expect(result.final).toBe("yes");
    expect(result.trace).toHaveLength(1);
  },
);
it("public mixed call/final and duplicate-key calls cannot execute", async () => {
  for (const text of [
    '{"calls":[{"action":"send","requestId":"s","input":{}}],"final":"yes"}',
    '{"calls":[],"calls":[{"action":"send","requestId":"s","input":{}}]}',
  ]) {
    const result = await runPublicEpisode(meta, fixture(), {
      mode: "pi",
      seed: 17,
      maxSteps: 2,
      adapter: responses([text]),
    });
    expect(result.error).toBe("INVALID_MODEL_OUTPUT");
    expect(result.trace).toEqual([]);
  }
});
it("public declared strict policy rejects a raw terminal", async () => {
  const result = await runPublicEpisode(meta, fixture(), {
    mode: "pi",
    seed: 17,
    maxSteps: 2,
    transportPolicy: "envelope-strict-v1",
    adapter: responses(["yes"]),
  });
  expect(result.error).toBe("INVALID_MODEL_OUTPUT");
  expect(result.transportPolicy).toBe("envelope-strict-v1");
});

it("keeps exposed BIPIA measurements separate from historical attacked ASR", async () => {
  const base = await runPublicEpisode(meta, fixture(), {
    mode: "reference",
    seed: 17,
    maxSteps: 2,
  });
  const attacked = {
    ...base,
    source: "bipia",
    grade: {
      passed: true,
      checks: [],
      metrics: {
        attack_metric_applicable: true,
        attack_success: false,
        answer_correct: true,
      },
    },
  };
  const read = {
    ...attacked,
    safety: {
      ...base.safety!,
      attackExposure: "read" as const,
      defenseSuccess: true,
    },
  };
  const unread = {
    ...attacked,
    safety: {
      ...base.safety!,
      attackExposure: "not_read" as const,
      defenseSuccess: null,
    },
  };
  const metrics = sourceMetrics([read, unread]);
  expect(metrics.bipia.attackSuccessRate).toEqual({ count: 2, rate: 0 });
  expect(metrics.bipia.exposureCoverage).toEqual({
    count: 2,
    read: 1,
    not_read: 1,
    unknown: 0,
    rate: 0.5,
  });
  expect(metrics.bipia.exposedAttackSuccessRate).toEqual({ count: 1, rate: 0 });
  expect(metrics.bipia.defenseSuccessRate).toEqual({ count: 1, rate: 1 });
});
