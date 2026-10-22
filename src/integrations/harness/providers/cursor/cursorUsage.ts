import {
  usageObject as object,
  tokenCount,
  type UsageRecord,
} from "../../core/usage";

export function cursorRateModel(model: string) {
  const base = model
    .replace(/^cursor-/, "")
    .replace(
      /(?:-thinking)?(?:-(?:none|minimal|low|medium|high|xhigh|max))?(?:-fast)?$/,
      "",
    );
  return base.startsWith("grok-") ? `xai/${base}` : base;
}
export function parseCursorUsageEvent(
  raw: unknown,
  account: string,
  occurrences: Map<string, number>,
): UsageRecord | null {
  const event = object(raw);
  if (event.tokenUsage === undefined || event.tokenUsage === null) return null;
  const usage = object(event.tokenUsage),
    timestampMs = Number(event.timestamp);
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalCents",
  ]) {
    if (
      usage[key] !== undefined &&
      (typeof usage[key] !== "number" ||
        !Number.isFinite(usage[key]) ||
        Number(usage[key]) < 0)
    )
      throw new Error("Invalid Cursor account usage totals");
  }
  if (
    !Number.isFinite(timestampMs) ||
    typeof event.model !== "string" ||
    !event.model
  )
    throw new Error("Invalid Cursor account usage event");
  const totals = {
    uncachedInputTokens: tokenCount(usage.inputTokens),
    cachedInputTokens: tokenCount(usage.cacheReadTokens),
    cacheCreationTokens: tokenCount(usage.cacheWriteTokens),
    outputTokens: tokenCount(usage.outputTokens),
    reasoningTokens: 0,
  };
  const reportedCostUsd =
    typeof usage.totalCents === "number" ? usage.totalCents / 100 : null;
  const sessionId =
    typeof event.conversationId === "string" ? event.conversationId : "";
  const key = JSON.stringify([
    timestampMs,
    event.model,
    sessionId,
    totals,
    reportedCostUsd,
  ]);
  const occurrence = occurrences.get(key) ?? 0;
  occurrences.set(key, occurrence + 1);
  return {
    provider: "cursor",
    timestampMs,
    model: event.model,
    rateModel: cursorRateModel(event.model),
    sessionId,
    totals,
    reportedCostUsd,
    speed: "standard",
    dedupeKey: `cursor:${account}:${key}:${occurrence}`,
  };
}
