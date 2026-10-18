import { expect, it } from "vitest";
import { CaseSchema, EvalError } from "../src/schema";
import { runCase } from "../src/runner";
import { runPublicEpisode } from "../src/publicRunner";
import { emptyUsage } from "../src/adapters";
function failingAdapter() {
  return {
    model: "offline",
    async complete() {
      throw Object.assign(new EvalError("UNKNOWN_PROVIDER_USAGE"), {
        usage: { ...emptyUsage(), requests: 1, costUsd: null },
        providerDiagnostics: [
          {
            httpStatus: 503,
            stopReason: "error",
            failureKind: "PROVIDER_HTTP_ERROR",
            rawBody: "SECRET",
            headers: { authorization: "SECRET" },
          },
        ],
      });
    },
  };
}
const expected = [
  { httpStatus: 503, stopReason: "error", failureKind: "PROVIDER_HTTP_ERROR" },
];
it("private runner preserves allowlisted failure metadata while unknown billing remains unknown", async () => {
  const scenario = CaseSchema.parse({
    id: "diagnostic-failure",
    category: "structured",
    language: "en",
    support: "native",
    tier: "standard",
    prompt: "Answer yes",
    tools: [],
    fixture: {},
    assertions: [{ kind: "no_effects" }],
    rubric: ["safety"],
    provenance: { kind: "original", source: "diagnostic-test" },
  });
  const result = await runCase(scenario, {
    mode: "pi",
    seed: 1,
    adapter: failingAdapter(),
  });
  expect(result.error).toBe("UNKNOWN_PROVIDER_USAGE");
  expect(result.usage.costUsd).toBeNull();
  expect(result.providerDiagnostics).toEqual(expected);
  expect(JSON.stringify(result.providerDiagnostics)).not.toContain("SECRET");
});
it("public runner preserves only normalized HTTP/code/stopReason diagnostics", async () => {
  const item = {
    id: "test/1",
    source: "test",
    upstream_id: "1",
    category: "structured",
    variant: "clean",
    provenance: {},
    caseHash: "fixture",
  };
  const bridge = {
    async request(command: any) {
      if (command.op === "init")
        return { prompt: "Answer yes", tools: [], case: item };
      if (command.op === "trace") return [];
      if (command.op === "grade") return { passed: false, checks: [] };
      throw new Error("Unexpected bridge command");
    },
  };
  const result = await runPublicEpisode(item, bridge, {
    mode: "pi",
    seed: 1,
    adapter: failingAdapter(),
    maxSteps: 2,
  });
  expect(result.error).toBe("UNKNOWN_PROVIDER_USAGE");
  expect(result.providerDiagnostics).toEqual(expected);
  expect(JSON.stringify(result.providerDiagnostics)).not.toContain("SECRET");
});
