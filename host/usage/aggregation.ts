import {
  EMPTY_TOTALS,
  type UsageBucket,
  type UsageRecord,
  type UsageSummaryInput,
  type UsagePriceOverrides,
} from "../../src/integrations/harness/core/usage";
import {
  cacheSavingsUsd,
  createOverrideRateTable,
  priceUsage,
  type RateTable,
} from "../../src/integrations/harness/core/usagePricing";

export function validateUsageInput(
  raw: Record<string, unknown>,
): UsageSummaryInput {
  const day = (value: unknown) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (
    !day(raw.sinceDay) ||
    !day(raw.untilDay) ||
    String(raw.sinceDay) > String(raw.untilDay) ||
    Date.parse(String(raw.untilDay)) - Date.parse(String(raw.sinceDay)) >
      366 * 86400_000 ||
    typeof raw.timeZone !== "string" ||
    (raw.refresh !== undefined && typeof raw.refresh !== "boolean")
  )
    throw new Error("Invalid usage date window");
  new Intl.DateTimeFormat("en", { timeZone: raw.timeZone }).format();
  if (
    raw.resolution !== undefined &&
    raw.resolution !== "day" &&
    raw.resolution !== "hour"
  )
    throw new Error("Invalid usage date window");
  for (const key of ["sinceTime", "untilTime"])
    if (
      raw[key] !== undefined &&
      (typeof raw[key] !== "string" ||
        !Number.isFinite(Date.parse(String(raw[key]))))
    )
      throw new Error("Invalid usage date window");
  if (
    raw.sinceTime &&
    raw.untilTime &&
    Date.parse(String(raw.sinceTime)) > Date.parse(String(raw.untilTime))
  )
    throw new Error("Invalid usage date window");
  return {
    sinceDay: String(raw.sinceDay),
    untilDay: String(raw.untilDay),
    timeZone: raw.timeZone,
    refresh: raw.refresh === true,
    resolution: raw.resolution === "hour" ? "hour" : "day",
    ...(raw.sinceTime ? { sinceTime: String(raw.sinceTime) } : {}),
    ...(raw.untilTime ? { untilTime: String(raw.untilTime) } : {}),
  };
}
export function aggregateUsage(
  records: readonly UsageRecord[],
  input: UsageSummaryInput,
  table: RateTable,
  prices: UsagePriceOverrides,
  mappings: Record<string, string> = {},
) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayOf = (ms: number) => {
    const parts = formatter.formatToParts(ms),
      get = (type: string) => parts.find((part) => part.type === type)!.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  const buckets = new Map<string, UsageBucket>(),
    seen = new Set<string>(),
    sessions = new Set<string>();
  const providerSessions = new Map<string, Set<string>>(),
    sourceSessions = new Map<string, Set<string>>();
  const overrides = createOverrideRateTable(prices);
  for (const record of records) {
    const day = dayOf(record.timestampMs);
    if (day < input.sinceDay || day > input.untilDay) continue;
    if (
      (input.sinceTime && record.timestampMs < Date.parse(input.sinceTime)) ||
      (input.untilTime && record.timestampMs > Date.parse(input.untilTime))
    )
      continue;
    const dedupe =
      record.dedupeKey === null
        ? null
        : `${record.provider}:${record.dedupeKey}`;
    if (dedupe !== null) {
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
    }
    if (record.sessionId) {
      sessions.add(`${record.provider}:${record.sessionId}`);
      const perProvider =
        providerSessions.get(record.provider) ?? new Set<string>();
      perProvider.add(record.sessionId);
      providerSessions.set(record.provider, perProvider);
      if (record.sourceId) {
        const perSource =
          sourceSessions.get(record.sourceId) ?? new Set<string>();
        perSource.add(record.sessionId);
        sourceSessions.set(record.sourceId, perSource);
      }
    }
    const hourStart =
      input.resolution === "hour"
        ? new Date(
            Math.floor(record.timestampMs / 3600_000) * 3600_000,
          ).toISOString()
        : undefined;
    const key = JSON.stringify([
      hourStart ?? day,
      record.sourceId,
      record.provider,
      record.model,
    ]);
    const bucket = buckets.get(key) ?? {
      day,
      hourStart,
      sourceId: record.sourceId,
      provider: record.provider,
      model: record.model,
      totals: { ...EMPTY_TOTALS },
      costUsd: 0,
      cacheSavingsUsd: 0,
      categoryCostUsd: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      otherCostUsd: 0,
      fastCostUsd: 0,
      ultrafastCostUsd: 0,
      speedPremiumUsd: 0,
      records: 0,
      unpricedRecords: 0,
    };
    for (const field of Object.keys(
      EMPTY_TOTALS,
    ) as (keyof typeof EMPTY_TOTALS)[])
      bucket.totals[field] += record.totals[field];
    const pricedRecord = mappings[record.model]
      ? { ...record, rateModel: mappings[record.model] }
      : record;
    const price = priceUsage(table, pricedRecord, overrides);
    bucket.records++;
    bucket.costUsd += price.costUsd;
    bucket.speedPremiumUsd += price.speedPremiumUsd;
    bucket.cacheSavingsUsd += cacheSavingsUsd(table, pricedRecord, overrides);
    if (record.speed === "fast") bucket.fastCostUsd += price.costUsd;
    if (record.speed === "ultrafast") bucket.ultrafastCostUsd += price.costUsd;
    if (price.costSource === "unpriced") bucket.unpricedRecords++;
    if (price.categoryCostUsd)
      for (const field of [
        "input",
        "cacheRead",
        "cacheWrite",
        "output",
      ] as const)
        bucket.categoryCostUsd[field] += price.categoryCostUsd[field];
    else bucket.otherCostUsd += price.costUsd;
    buckets.set(key, bucket);
  }
  return {
    buckets: [...buckets.values()].sort(
      (a, b) =>
        (a.hourStart ?? a.day).localeCompare(b.hourStart ?? b.day) ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model),
    ),
    sessions: sessions.size,
    providerSessions: Object.fromEntries(
      [...providerSessions].map(([provider, values]) => [
        provider,
        values.size,
      ]),
    ),
    sourceSessions: Object.fromEntries(
      [...sourceSessions].map(([id, values]) => [id, values.size]),
    ),
  };
}
