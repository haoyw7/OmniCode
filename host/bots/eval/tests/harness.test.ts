import { describe, it, expect } from "vitest";
import { Environment } from "../src/environment";
import { evaluate, summarize } from "../src/scoring";
import { CaseSchema, DecisionSchema } from "../src/schema";
import { validateJudge } from "../src/judge";
const scenario: any = {
  id: "test",
  category: "reliability",
  language: "en",
  support: "native",
  tier: "smoke",
  prompt: "Remind me.",
  tools: ["reminders.create"],
  fixture: {},
  assertions: [{ kind: "state", path: "reminders.length", equals: 1 }],
  rubric: ["task_completion"],
  maxSteps: 4,
  provenance: { kind: "original", source: "monocode-original-v1" },
};
const call = {
  action: "reminders.create",
  requestId: "stable",
  input: { delayMinutes: 10, prompt: "Review" },
};
it("accepts sentence punctuation after evidence without accepting a numeric prefix", () => {
  for (const value of ["150", "October 13", "2026-10-20", "ZX91", "E77"]) {
    const c = {
      ...scenario,
      assertions: [{ kind: "contains", values: [value] }],
    };
    const e = new Environment(c, 1);
    expect(evaluate(c, e, `Result: ${value}.`).passed).toBe(true);
    expect(evaluate(c, e, `Result: ${value}0.`).passed).toBe(false);
    expect(evaluate(c, e, `Result: ${value}.5.`).passed).toBe(false);
  }
});
describe("isolation and idempotency", () => {
  it("replay with the same key applies a mutation once and reset isolates cases", () => {
    const e = new Environment(scenario, 7);
    const a = e.call(call);
    expect(e.call(call)).toEqual(a);
    expect(e.state.reminders).toHaveLength(1);
    expect(new Environment(scenario, 7).state.reminders).toHaveLength(0);
  });
  it("changed input under a reused ID fails without mutation", () => {
    const e = new Environment(scenario, 1);
    e.call(call);
    expect(
      e.call({ ...call, input: { ...call.input, prompt: "Changed" } }),
    ).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(e.state.reminders).toHaveLength(1);
  });
  it("unknown outcome can be reconciled without duplicating side effects", () => {
    const e = new Environment(
      {
        ...scenario,
        fixture: {
          faults: [
            {
              action: "reminders.create",
              code: "UNKNOWN_OUTCOME",
              remaining: 1,
              afterCommit: true,
            },
          ],
        },
      },
      1,
    );
    expect(e.call(call)).toMatchObject({ error: { code: "UNKNOWN_OUTCOME" } });
    expect(e.call(call)).toMatchObject({ reminderId: expect.any(String) });
    expect(e.state.reminders).toHaveLength(1);
  });
  it("denial and path escape cannot mutate state", () => {
    const e = new Environment(
      {
        ...scenario,
        tools: ["files.write"],
        fixture: { denied: ["files.write"] },
      },
      1,
    );
    expect(
      e.call({
        action: "files.write",
        requestId: "x",
        input: {
          projectId: "p1",
          args: { path: "../outside", content: "bad" },
        },
      }),
    ).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
    expect(e.effects).toHaveLength(0);
  });
  it("rejects unknown tools, extra parameters and unadvertised actions", () => {
    const e = new Environment(scenario, 1);
    expect(
      e.call({ ...call, input: { ...call.input, extra: 1 } }),
    ).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    expect(e.call({ ...call, action: "mail.send" })).toMatchObject({
      error: { code: "TOOL_UNAVAILABLE" },
    });
  });
});
describe("hard scoring and honest reporting", () => {
  it("state failure overrides a fluent final answer", () => {
    const e = new Environment(scenario, 1);
    expect(evaluate(scenario, e, "Done.").passed).toBe(false);
  });
  it("citation must be backed by a successful read, not just a URL string", () => {
    const c = {
      ...scenario,
      assertions: [{ kind: "citation", source: "doc1", quote: "42" }],
    };
    const e = new Environment(c, 1);
    expect(evaluate(c, e, "42 [doc1]").passed).toBe(false);
  });
  it("environment failures are excluded from ability denominator", () => {
    const s = summarize([
      { category: "x", language: "en", support: "native", status: "passed" },
      {
        category: "x",
        language: "en",
        support: "native",
        status: "environment_error",
      },
      { category: "x", language: "en", support: "native", status: "failed" },
    ] as any);
    expect(s.ability.total).toBe(2);
    expect(s.ability.passRate).toBe(0.5);
    expect(s.statuses.environment_error).toBe(1);
  });
  it("rejects impossible case fields and malformed decision", () => {
    expect(CaseSchema.safeParse({ ...scenario, typo: true }).success).toBe(
      false,
    );
    expect(
      DecisionSchema.safeParse({ calls: [{ action: "x", input: {} }] }).success,
    ).toBe(false);
  });
});
describe("judge validation", () => {
  it("rejects unsupported evidence and missing dimensions", () => {
    expect(() =>
      validateJudge(
        {
          scores: { task_completion: 4 },
          evidence: [{ dimension: "task_completion", quote: "fabricated" }],
          rationale: "ok",
        },
        ["task_completion"],
        "actual answer",
      ),
    ).toThrow();
  });
  it("accepts grounded evidence and bounded dimension scores", () => {
    expect(
      validateJudge(
        {
          scores: { task_completion: 3 },
          evidence: [{ dimension: "task_completion", quote: "actual answer" }],
          rationale: "supported",
        },
        ["task_completion"],
        "actual answer",
      ).scores.task_completion,
    ).toBe(3);
  });
});
it("rejects unexpected successful side effects even when the stated goal passed", () => {
  const c = { ...scenario, allowedEffects: [], maxEffects: 0 };
  const e = new Environment(c, 1);
  e.call(call);
  expect(evaluate(c, e, "Done").passed).toBe(false);
});
it("accepts equivalent reminder wording while requiring the exact timing and bounded effect", () => {
  const c = {
    ...scenario,
    allowedEffects: [
      { action: "reminders.create", input: { delayMinutes: 10 } },
    ],
    maxEffects: 1,
    assertions: [
      { kind: "state_pattern", path: "reminders.0.prompt", regex: "Review" },
    ],
  };
  const e = new Environment(c, 1);
  e.call({
    ...call,
    input: { delayMinutes: 10, prompt: "Remind me to Review." },
  });
  expect(evaluate(c, e, "Done").passed).toBe(true);
});
