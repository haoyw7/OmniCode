import { it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestGate } from "../src/nativePiFixtureAdapter";
import { ProviderDiagnosticJournal } from "../src/providerJournal";
import { CampaignBudget } from "../src/campaignBudget";
import { emptyUsage } from "../src/adapters";
const endpoint = "https://chatgpt.com/backend-api/codex/responses";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "provider-journal-test-"));
  const path = join(dir, "provider-diagnostics.jsonl");
  const journal = new ProviderDiagnosticJournal(path);
  const budget = new CampaignBudget(
    join(dir, "budget.json"),
    200,
    2,
    0.6256,
    "catalog-upper-bound",
  );
  return {
    dir,
    path,
    journal,
    budget,
    read: () =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((x) => JSON.parse(x)),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}
it("persists unknown usage and correlation without payloads, preserving the blocked budget", async () => {
  const t = setup();
  try {
    const gate = createRequestGate(
      t.budget,
      async () =>
        new Response("SECRET_BODY", {
          status: 503,
          headers: {
            "x-request-id": "req_0123456789abcdef",
            authorization: "SECRET_AUTH",
          },
        }),
      (u) => t.budget.recordUsage(u),
      undefined,
      {
        journal: t.journal,
        context: { caseId: "test-case", phase: "prompt", arm: "control" },
      },
    );
    await gate.fetch(endpoint, {
      headers: { authorization: "SECRET_AUTH" },
      body: "SECRET_PROMPT",
      method: "POST",
    });
    expect(() =>
      gate.record(
        { ...emptyUsage(), requests: 1, costUsd: null },
        { stopReason: "error", failureKind: "PROVIDER_HTTP_ERROR" },
      ),
    ).toThrow("UNKNOWN_PROVIDER_USAGE");
    const rows = t.read();
    expect(rows.map((r) => r.event)).toEqual([
      "request_started",
      "http_response",
      "request_terminal",
    ]);
    expect(new Set(rows.map((r) => r.localRequestId)).size).toBe(1);
    expect(rows.at(-1)).toMatchObject({
      providerRequestId: "req_0123456789abcdef",
      httpStatus: 503,
      terminalState: "failed",
      usageMissing: true,
      failureKind: "PROVIDER_HTTP_ERROR",
      caseId: "test-case",
    });
    expect(readFileSync(t.path, "utf8")).not.toContain("SECRET");
    expect(statSync(t.path).mode & 0o777).toBe(0o600);
    expect(t.budget.snapshot()).toMatchObject({
      requests: 1,
      reportedUsd: null,
      reservedUsd: 0.6256,
    });
    expect(() => t.budget.reserve()).toThrow("USAGE_UNKNOWN");
    expect(() => new ProviderDiagnosticJournal(t.path)).toThrow();
  } finally {
    t.clean();
  }
});
it("saves transport failure before an SDK can discard its exception", async () => {
  const t = setup();
  try {
    const gate = createRequestGate(
      t.budget,
      async () => {
        throw new Error("ECONNRESET SECRET_EXCEPTION");
      },
      undefined,
      undefined,
      { journal: t.journal },
    );
    await expect(gate.fetch(endpoint)).rejects.toThrow("ECONNRESET");
    expect(() => gate.finish()).toThrow("UNKNOWN_PROVIDER_USAGE");
    expect(t.read().at(-1)).toMatchObject({
      httpStatus: null,
      terminalState: "failed",
      failureKind: "NETWORK_ERROR",
      usageMissing: true,
    });
    expect(readFileSync(t.path, "utf8")).not.toContain("SECRET");
  } finally {
    t.clean();
  }
});
it("writes cancellation and completed states while retaining unanswered starts as unknown", async () => {
  const t = setup();
  try {
    const gate = createRequestGate(
      t.budget,
      async () =>
        new Response("offline", {
          headers: { "x-request-id": "Bearer SECRET_AUTH" },
        }),
      (u) => t.budget.recordUsage(u),
      undefined,
      { journal: t.journal },
    );
    await gate.fetch(endpoint);
    expect(t.read().at(-1)).toMatchObject({
      event: "http_response",
      terminalState: null,
      providerRequestId: null,
    });
    gate.finalizePending("TIMEOUT");
    expect(t.read().at(-1)).toMatchObject({
      terminalState: "cancelled",
      failureKind: "TIMEOUT",
      usageMissing: true,
    });
    expect(() => gate.finish()).toThrow("UNKNOWN_PROVIDER_USAGE");
    const b = new CampaignBudget(
      join(t.dir, "second-budget.json"),
      200,
      2,
      0.6256,
      "catalog-upper-bound",
    );
    const second = createRequestGate(
      b,
      async () => new Response("offline"),
      (u) => b.recordUsage(u),
      undefined,
      { journal: t.journal },
    );
    await second.fetch(endpoint);
    second.record(
      { ...emptyUsage(), requests: 1, costUsd: 0.001 },
      { stopReason: "stop", failureKind: null },
    );
    second.finish();
    expect(t.read().at(-1)).toMatchObject({
      terminalState: "completed",
      usageMissing: false,
    });
  } finally {
    t.clean();
  }
});
it("does not send or reserve when durable diagnostic storage fails before dispatch", async () => {
  const t = setup();
  try {
    rmSync(t.path);
    mkdirSync(t.path);
    let sends = 0;
    const gate = createRequestGate(
      t.budget,
      async () => {
        sends++;
        return new Response("offline");
      },
      undefined,
      undefined,
      { journal: t.journal },
    );
    await expect(gate.fetch(endpoint)).rejects.toThrow(
      "DIAGNOSTIC_WRITE_FAILED",
    );
    expect(sends).toBe(0);
    expect(t.budget.requests).toBe(0);
  } finally {
    t.clean();
  }
});
it("keeps a completed response distinct from unusable billing and stops nonetheless", async () => {
  const t = setup();
  try {
    const gate = createRequestGate(
      t.budget,
      async () => new Response("offline"),
      (u) => t.budget.recordUsage(u),
      undefined,
      { journal: t.journal },
    );
    await gate.fetch(endpoint);
    expect(() =>
      gate.record(
        { ...emptyUsage(), requests: 1, costUsd: null },
        { stopReason: "stop", failureKind: "MISSING_USAGE" },
      ),
    ).toThrow("UNKNOWN_PROVIDER_USAGE");
    expect(t.read().at(-1)).toMatchObject({
      terminalState: "completed",
      usageMissing: true,
      failureKind: "MISSING_USAGE",
    });
    expect(() => t.budget.reserve()).toThrow("USAGE_UNKNOWN");
  } finally {
    t.clean();
  }
});
it("saves provider terminal evidence even if the separate budget settlement writer fails", async () => {
  const t = setup();
  try {
    const gate = createRequestGate(
      t.budget,
      async () => new Response("offline"),
      () => {
        throw new Error("SETTLEMENT_FAILURE");
      },
      undefined,
      { journal: t.journal },
    );
    await gate.fetch(endpoint);
    expect(() =>
      gate.record(
        { ...emptyUsage(), requests: 1, costUsd: 0.001 },
        { stopReason: "stop", failureKind: null },
      ),
    ).toThrow("SETTLEMENT_FAILURE");
    expect(t.read().at(-1)).toMatchObject({
      terminalState: "completed",
      usageMissing: false,
    });
  } finally {
    t.clean();
  }
});
