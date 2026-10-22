import {
  EMPTY_TOTALS,
  totalTokens,
  type UsageBucket,
  type UsageSummaryInput,
} from "../../../integrations/harness/core/usage";

export function usageWindow(days: number, now = new Date()): UsageSummaryInput {
  const untilDay = localDay(now),
    since = new Date(now);
  if (days === 1) {
    const start = new Date(now.getTime() - 86400_000);
    return {
      sinceDay: localDay(start),
      untilDay,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      resolution: "hour",
      sinceTime: start.toISOString(),
      untilTime: now.toISOString(),
    };
  }
  since.setDate(since.getDate() - days + 1);
  return {
    sinceDay: localDay(since),
    untilDay,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export interface UsageModelRow {
  id: string;
  provider: UsageBucket["provider"];
  model: string;
  costUsd: number;
  tokens: number;
  records: number;
  unpricedRecords: number;
  totals: UsageBucket["totals"];
}
export function usageView(
  buckets: readonly UsageBucket[],
  hidden: readonly string[] = [],
) {
  const filtered = buckets.filter(
    (bucket) => !hidden.includes(bucket.provider),
  );
  const models = new Map<string, UsageModelRow>(),
    daily = new Map<string, { day: string; cost: number; tokens: number }>();
  const totals = { ...EMPTY_TOTALS },
    category = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, other: 0 };
  let cost = 0,
    savings = 0,
    premium = 0,
    unpriced = 0,
    requests = 0,
    fast = 0,
    ultrafast = 0;
  for (const bucket of filtered) {
    cost += bucket.costUsd;
    savings += bucket.cacheSavingsUsd;
    premium += bucket.speedPremiumUsd;
    fast += bucket.fastCostUsd;
    ultrafast += bucket.ultrafastCostUsd;
    unpriced += bucket.unpricedRecords;
    requests += bucket.records;
    for (const field of Object.keys(
      EMPTY_TOTALS,
    ) as (keyof typeof EMPTY_TOTALS)[])
      totals[field] += bucket.totals[field];
    for (const field of ["input", "cacheRead", "cacheWrite", "output"] as const)
      category[field] += bucket.categoryCostUsd[field];
    category.other += bucket.otherCostUsd;
    const id = `${bucket.provider}:${bucket.model}`,
      model = models.get(id) ?? {
        id,
        provider: bucket.provider,
        model: bucket.model,
        costUsd: 0,
        tokens: 0,
        records: 0,
        unpricedRecords: 0,
        totals: { ...EMPTY_TOTALS },
      };
    model.costUsd += bucket.costUsd;
    model.tokens += totalTokens(bucket.totals);
    model.records += bucket.records;
    model.unpricedRecords += bucket.unpricedRecords;
    for (const field of Object.keys(
      EMPTY_TOTALS,
    ) as (keyof typeof EMPTY_TOTALS)[])
      model.totals[field] += bucket.totals[field];
    models.set(id, model);
    const slot = bucket.hourStart ?? bucket.day;
    const day = daily.get(slot) ?? { day: slot, cost: 0, tokens: 0 };
    day.cost += bucket.costUsd;
    day.tokens += totalTokens(bucket.totals);
    daily.set(slot, day);
  }
  return {
    models: [...models.values()].sort(
      (a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens,
    ),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    cost,
    savings,
    premium,
    unpriced,
    requests,
    fast,
    ultrafast,
    totals,
    category,
  };
}
