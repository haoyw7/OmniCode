import {
  usageObject as object,
  tokenCount,
  parseTimestampMs,
  totalTokens,
  type UsageRecord,
} from "../../core/usage";

export interface PiUsageState {
  sessionId: string;
}
/** Pi and OMP retain the same native session-entry usage format. */
export function parsePiUsage(
  value: unknown,
  state: PiUsageState,
  provider: "pi" | "omp" = "pi",
): UsageRecord[] {
  const entry = object(value);
  if (entry.type === "session") {
    if (typeof entry.id === "string") state.sessionId = entry.id;
    return [];
  }
  if (
    !["message", "usage", "compaction", "branch_summary"].includes(
      String(entry.type),
    )
  )
    return [];
  const source = entry.type === "message" ? object(entry.message) : entry;
  if (
    entry.type === "message" &&
    source.role !== "assistant" &&
    source.role !== "toolResult"
  )
    return [];
  const timestampMs = parseTimestampMs(entry.timestamp);
  if (timestampMs === null || !entry.id || !source.usage) return [];
  const usage = object(source.usage);
  const rateModel =
    typeof source.model === "string"
      ? String(source.responseModel || source.model)
      : undefined;
  const model =
    rateModel && typeof source.provider === "string"
      ? `${source.provider}/${rateModel}`
      : "Tools/summaries";
  const totals = {
    uncachedInputTokens: tokenCount(usage.input),
    cachedInputTokens: tokenCount(usage.cacheRead),
    cacheCreationTokens: tokenCount(usage.cacheWrite),
    outputTokens: tokenCount(usage.output),
    reasoningTokens: Math.min(
      tokenCount(usage.reasoning),
      tokenCount(usage.output),
    ),
  };
  const cost = object(usage.cost).total;
  const reportedCostUsd =
    typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null;
  if (!totalTokens(totals) && reportedCostUsd === null) return [];
  return [
    {
      provider,
      timestampMs,
      model,
      rateModel,
      sessionId: state.sessionId,
      totals,
      reportedCostUsd,
      speed: "standard",
      dedupeKey: JSON.stringify([provider, entry.id, entry.timestamp, model]),
    },
  ];
}
