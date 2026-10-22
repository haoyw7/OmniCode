import { expect, it } from "vitest";
import {
  EMPTY_TOTALS,
  type UsageLimitSource,
  type UsageSummary,
} from "../../../integrations/harness/core/usage";
import { mergeUsageSummaries } from "./usageMerge";
import { usagePools, effectiveUsageWindow, usagePace } from "./usagePools";
import { usageWindow } from "./usage";
const source = (id: string): UsageSummary => ({
  contractVersion: 1,
  readAt: 1,
  sinceDay: "2026-10-01",
  untilDay: "2026-10-21",
  timeZone: "UTC",
  sessions: 2,
  providerSessions: { codex: 2 },
  pricing: { status: "cached", source: "prices", fetchedAt: 1, knownModels: 1 },
  priceOverrides: {},
  cursorKeychainEnabled: false,
  scanDurationMs: 1,
  sources: [
    {
      id,
      provider: "codex",
      path: "same canonical history",
      status: "ok",
      scannedFiles: 1,
      malformedRecords: 0,
      distinctSessions: 2,
    },
  ],
  buckets: [
    {
      day: "2026-10-21",
      provider: "codex",
      model: "model",
      sourceId: id,
      totals: { ...EMPTY_TOTALS, outputTokens: 10 },
      costUsd: 1,
      categoryCostUsd: { input: 0, cacheRead: 0, cacheWrite: 0, output: 1 },
      otherCostUsd: 0,
      fastCostUsd: 0,
      ultrafastCostUsd: 0,
      speedPremiumUsd: 0,
      cacheSavingsUsd: 0,
      records: 1,
      unpricedRecords: 0,
    },
  ],
});
it("deduplicates the same history across environments while retaining independent sources", () => {
  const merged = mergeUsageSummaries([
    source("same"),
    source("same"),
    source("other"),
  ]);
  expect(merged.buckets).toHaveLength(2);
  expect(merged.duplicateSources).toBe(1);
  expect(merged.sessions).toBe(4);
  expect(merged.providerSessions.codex).toBe(4);
});
it("pools an account once, prefers its fresh snapshot, and sorts next session refill", () => {
  const account = (
    environment: string,
    updatedAt: number,
    used: number,
    resetsAt: number,
  ): UsageLimitSource => ({
    id: environment,
    environmentKey: environment,
    accountKey: "one-account",
    provider: "codex",
    label: "Work",
    status: "ok",
    updatedAt,
    windows: [{ id: "session", label: "5h", usedPercent: used, resetsAt }],
  });
  const pools = usagePools(
    [
      account("a", 1, 30, 500),
      account("b", 2, 40, 400),
      { ...account("c", 1, 10, 300), accountKey: "another-account" },
    ],
    100,
  );
  expect(pools[0].accounts.map((account) => account.environmentKey)).toEqual([
    "c",
    "b",
  ]);
  expect(pools[0].windows[0].members[1].window.usedPercent).toBe(40);
});
it("suppresses a five-hour pool exhausted by the weekly limit and exposes the effective refill", () => {
  const account: UsageLimitSource = {
    id: "a",
    provider: "codex",
    label: "Work",
    status: "ok",
    windows: [
      { id: "weekly", label: "Weekly", usedPercent: 100, resetsAt: 900 },
    ],
  };
  expect(
    effectiveUsageWindow(
      account,
      { id: "session", label: "5h", usedPercent: 30, resetsAt: 500 },
      100,
    ),
  ).toMatchObject({
    window: { usedPercent: 100, resetsAt: 900 },
    refillPercent: 100,
  });
  expect(
    usagePace(
      {
        id: "session",
        label: "5h",
        usedPercent: 30,
        resetsAt: 300_000,
        windowDurationMins: 10,
      },
      0,
    ),
  ).toBe(50);
});
it("requests exactly the last 24 hours with hourly resolution", () => {
  const window = usageWindow(1, new Date("2026-10-21T12:34:56Z"));
  expect(window.resolution).toBe("hour");
  expect(Date.parse(window.untilTime!) - Date.parse(window.sinceTime!)).toBe(
    86_400_000,
  );
  expect(usageWindow(7).sinceTime).toBeUndefined();
});
