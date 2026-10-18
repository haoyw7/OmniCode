import { describe, expect, it } from "vitest";
import { contextFromUsageSnapshot } from "../../../integrations/harness/providers/claude/claudeProtocol";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import { newSession } from "./session";
import { contextBreakdownRows } from "./contextBreakdown";
import { dropContextWindow, mergeContextUsage } from "./contextUsage";

const native = {
  totalTokens: 100_000, rawMaxTokens: 200_000,
  categories: [
    { name: "Messages", tokens: 60_000, kind: "used" },
    { name: "System prompt", tokens: 10_000, kind: "used" },
    { name: "System tools", tokens: 15_000, kind: "used" },
    { name: "Skills", tokens: 5_000, kind: "used" },
    { name: "MCP tools", tokens: 10_000, kind: "used" },
    { name: "Autocompact buffer", tokens: 30_000, kind: "buffer" },
    { name: "Free space", tokens: 70_000, kind: "free" },
    { name: "MCP tools (deferred)", tokens: 90_000, kind: "deferred" },
  ],
  messageBreakdown: { toolResultTokens: 40_000 },
};

describe("context breakdown accounting", () => {
  it("splits tool results without counting them twice and excludes deferred schemas", () => {
    const usage = contextFromUsageSnapshot(native, 100)!;
    const rows = contextBreakdownRows(usage);
    expect(rows.find((row) => row.name === "Messages")?.tokens).toBe(20_000);
    expect(rows.find((row) => row.name === "Tool results")?.tokens).toBe(40_000);
    expect(rows.filter((row) => row.kind === "used").reduce((sum, row) => sum + row.tokens, 0)).toBe(usage.used);
    expect(rows.filter((row) => row.kind !== "deferred").reduce((sum, row) => sum + row.percent!, 0)).toBe(100);
    expect(rows.at(-1)?.percent).toBeNull();
    expect(native.categories[0].tokens).toBe(60_000);
  });

  it("retains the last snapshot during growth and invalidates it after compaction or model switches", () => {
    const usage = contextFromUsageSnapshot(native, 100)!;
    const grown = mergeContextUsage(usage, { used: 120_000 });
    const rows = contextBreakdownRows(grown);
    expect(rows.find((row) => row.name === "Since last update")?.tokens).toBe(20_000);
    expect(rows.find((row) => row.kind === "free")?.tokens).toBe(50_000);
    expect(mergeContextUsage(grown, { used: 20_000 }).breakdown).toBeUndefined();
    expect(mergeContextUsage(grown, { window: 1_000_000 }).breakdown).toBeUndefined();
    expect(dropContextWindow(grown)?.breakdown).toBeUndefined();
    expect(mergeContextUsage(grown, { breakdown: null })).toEqual({ used: 120_000, window: 200_000 });
  });

  it("applies refreshed categories even if the aggregate is unchanged", () => {
    const first = contextFromUsageSnapshot(native, 100)!;
    const session = applyHarnessEvent(newSession("claude", "/repo"), { type: "context", ...first });
    expect(applyHarnessEvent(session, { type: "context", used: first.used })).toBe(session);
    const fresh = contextFromUsageSnapshot({ ...native, messageBreakdown: { toolResultTokens: 30_000 } }, 200)!;
    const next = applyHarnessEvent(session, { type: "context", ...fresh });
    expect(next).not.toBe(session);
    expect(next.context?.breakdown?.updatedAt).toBe(200);
    expect(next.context?.breakdown?.toolResultTokens).toBe(30_000);
  });

  it("extends the provider's existing delta row instead of showing duplicate growth", () => {
    const usage = contextFromUsageSnapshot({ ...native, categories: [
      { name: "Messages", tokens: 90_000, kind: "used" },
      { name: "Since last update", tokens: 10_000, kind: "used" },
    ] }, 100)!;
    const rows = contextBreakdownRows(mergeContextUsage(usage, { used: 120_000 }));
    expect(rows.filter((row) => row.name === "Since last update")).toMatchObject([{ tokens: 30_000 }]);
    expect(rows.filter((row) => row.kind === "used").reduce((sum, row) => sum + row.tokens, 0)).toBe(120_000);
  });

  it("does not subtract impossible result counts or invent unavailable categories", () => {
    const usage = contextFromUsageSnapshot({ ...native, messageBreakdown: { toolResultTokens: 80_000 } })!;
    const rows = contextBreakdownRows(usage);
    expect(rows.find((row) => row.name === "Messages")?.tokens).toBe(60_000);
    expect(rows.some((row) => row.name === "Tool results")).toBe(false);
    expect(contextBreakdownRows({ used: 100_000, window: 200_000 })).toEqual([]);
  });
});
