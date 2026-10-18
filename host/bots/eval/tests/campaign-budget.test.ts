import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampaignBudget } from "../src/campaignBudget";
import { emptyUsage } from "../src/adapters";
const usage = (costUsd: number | null) => ({
  ...emptyUsage(),
  requests: 1,
  costUsd,
});
describe("durable campaign budget", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "campaign-budget-test-"));
    const path = join(dir, "budget.json");
    return { path, clean: () => rmSync(dir, { recursive: true, force: true }) };
  }
  it("reserves before inference, persists each completion and never resets across phases", () => {
    const { path, clean } = setup();
    try {
      const b = new CampaignBudget(path, 2, 0.02, 0.01);
      b.reserve();
      expect(JSON.parse(readFileSync(path, "utf8")).requests).toBe(1);
      b.actualUsd += 0.003; // Existing PiAdapter accounts success before settle.
      b.recordUsage(usage(0.003));
      expect(b.actualUsd).toBe(0.003);
      b.reserve();
      b.recordUsage(usage(0.004));
      expect(b.actualUsd).toBe(0.007);
      expect(() => b.reserve()).toThrow(/BUDGET_EXHAUSTED/);
      expect(() => new CampaignBudget(path, 200, 2, 0.01)).toThrow(
        /already exists/,
      );
    } finally {
      clean();
    }
  });
  it("stops all further calls after missing cost or an unsettled request", () => {
    const { path, clean } = setup();
    try {
      const b = new CampaignBudget(path, 200, 2, 0.01);
      b.reserve();
      expect(() => b.reserve()).toThrow(/UNSETTLED_REQUEST/);
      b.recordUsage(usage(null));
      expect(() => b.reserve()).toThrow(/USAGE_UNKNOWN/);
      const saved = JSON.parse(readFileSync(path, "utf8"));
      expect(saved.reportedUsd).toBeNull();
      expect(saved.requests).toBe(1);
    } finally {
      clean();
    }
  });
  it("enforces actual cost independently of nominal reservation", () => {
    const { path, clean } = setup();
    try {
      const b = new CampaignBudget(path, 200, 2, 0.01);
      b.reserve();
      b.recordUsage(usage(1.995));
      expect(() => b.reserve()).toThrow(/BUDGET_EXHAUSTED/);
    } finally {
      clean();
    }
  });
  it("accounts a failed provider request and refuses unknown usage afterwards", () => {
    const { path, clean } = setup();
    try {
      const b = new CampaignBudget(path, 200, 2, 0.01);
      b.reserve();
      b.failClosed("TIMEOUT");
      expect(() => b.reserve()).toThrow(/USAGE_UNKNOWN/);
      expect(JSON.parse(readFileSync(path, "utf8")).blockedReason).toBe(
        "TIMEOUT",
      );
    } finally {
      clean();
    }
  });
});

it("releases only unused conservative cost reservation after known billing and keeps next worst case within total", () => {
  const dir = mkdtempSync(join(tmpdir(), "campaign-bound-test-"));
  try {
    const b = new CampaignBudget(
      join(dir, "budget.json"),
      200,
      2,
      0.6256,
      "catalog-upper-bound",
    );
    b.reserve();
    expect(b.reservedUsd).toBe(0.6256);
    b.recordUsage(usage(0.003));
    expect(b.reservedUsd).toBe(0.003);
    b.reserve();
    b.recordUsage(usage(0.004));
    expect(b.reservedUsd).toBe(0.007);
    b.actualUsd = 1.5;
    expect(() => b.reserve()).toThrow("BUDGET_EXHAUSTED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("retains upper-bound liability and blocks after unknown billing", () => {
  const dir = mkdtempSync(join(tmpdir(), "campaign-bound-test-"));
  try {
    const b = new CampaignBudget(
      join(dir, "budget.json"),
      200,
      2,
      0.6256,
      "catalog-upper-bound",
    );
    b.reserve();
    b.recordUsage(usage(null));
    expect(b.reservedUsd).toBe(0.6256);
    expect(() => b.reserve()).toThrow("USAGE_UNKNOWN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
