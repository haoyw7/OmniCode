/** Historical billing is independent of current-turn context and subscription limits. */
export const USAGE_CAPABILITY = "usage.v1";
export const USAGE_CONTRACT_VERSION = 1;
export const USAGE_PROVIDERS = [
  "claude",
  "codex",
  "grok",
  "pi",
  "omp",
  "opencode",
  "antigravity",
  "cursor",
] as const;
export type UsageProvider = (typeof USAGE_PROVIDERS)[number];
export interface UsageScanProgress {
  pending: boolean;
  providers: UsageProvider[];
}
export type UsageSpeed = "standard" | "fast" | "ultrafast";
export type UsageCostSource = "providerReported" | "modelPriced" | "unpriced";
/** The three input counters are disjoint; reasoning is included in output. */
export interface UsageTokenTotals {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}
export interface UsageRecord {
  provider: UsageProvider;
  timestampMs: number;
  model: string;
  rateModel?: string;
  sessionId: string;
  totals: UsageTokenTotals;
  reportedCostUsd: number | null;
  speed: UsageSpeed;
  dedupeKey: string | null;
  unresolvedServiceTierTurnId?: string;
  sourceId?: string;
  dedupeAliases?: readonly string[];
}
export const EMPTY_TOTALS: UsageTokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};
export const totalTokens = (totals: UsageTokenTotals) =>
  totals.uncachedInputTokens +
  totals.cachedInputTokens +
  totals.cacheCreationTokens +
  totals.outputTokens;
export const tokenCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
export const parseTimestampMs = (value: unknown): number | null => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
export const usageObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** State must be JSON serializable, including the resume point for contextual formats. */
export interface TranscriptUsageFormat<State = unknown> {
  usageMarkers: readonly string[];
  initial: () => State;
  parse: (value: unknown, state: State) => readonly UsageRecord[];
  malformed?: (state: State) => number;
}
export interface UsageCategoryCost {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}
export interface UsageModelPriceOverride {
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  cacheReadCostPerMillionTokens?: number;
  cacheWriteCostPerMillionTokens?: number;
}
export type UsagePriceOverrides = Record<string, UsageModelPriceOverride>;
export interface UsageBucket {
  day: string;
  hourStart?: string;
  sourceId?: string;
  provider: UsageProvider;
  model: string;
  totals: UsageTokenTotals;
  costUsd: number;
  cacheSavingsUsd: number;
  categoryCostUsd: UsageCategoryCost;
  otherCostUsd: number;
  fastCostUsd: number;
  ultrafastCostUsd: number;
  speedPremiumUsd: number;
  records: number;
  unpricedRecords: number;
}
export interface UsageSource {
  id: string;
  provider: UsageProvider;
  path: string;
  status: "ok" | "missing" | "partial" | "failed";
  scannedFiles: number;
  malformedRecords: number;
  distinctSessions?: number;
  message?: string;
}
export interface UsageSummaryInput {
  sinceDay: string;
  untilDay: string;
  timeZone: string;
  refresh?: boolean;
  resolution?: "day" | "hour";
  sinceTime?: string;
  untilTime?: string;
}
export interface UsageSummary {
  contractVersion: number;
  readAt: number;
  sinceDay: string;
  untilDay: string;
  timeZone: string;
  buckets: UsageBucket[];
  sources: UsageSource[];
  sessions: number;
  providerSessions?: Partial<Record<UsageProvider, number>>;
  pricing: {
    status: "fresh" | "cached" | "unavailable";
    fetchedAt: number | null;
    source: string;
    knownModels: number;
  };
  priceOverrides: UsagePriceOverrides;
  modelMappings?: Record<string, string>;
  cursorKeychainEnabled: boolean;
  scanDurationMs: number;
}
export interface UsageLimitWindow {
  id: string;
  label: string;
  scopeLabel?: string;
  usedPercent: number;
  resetsAt?: number;
  windowDurationMins?: number;
}
export interface UsageLimitSource {
  id: string;
  provider: UsageProvider;
  label: string;
  status: "ok" | "unavailable" | "error";
  windows: UsageLimitWindow[];
  message?: string;
  resetCreditsAvailable?: number;
  accountId?: string;
  accountKey?: string;
  email?: string;
  plan?: string;
  environmentKey?: string;
  environmentLabel?: string;
  updatedAt?: number;
}
