// Adapted from T3 Code (MIT); see licenses/T3Code-MIT.txt.
import { totalTokens, type UsageRecord } from "../../core/usage";
function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function tokens(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseOpenCodeMessage(
  source: string,
  fallback: {
    readonly id?: string;
    readonly sessionId?: string;
    readonly timestampMs?: number;
  } = {},
): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  const message = object(parsed);
  if (message.role !== undefined && message.role !== "assistant") return null;
  const usage = object(message.tokens);
  const cache = object(usage.cache);
  const modelReference = object(message.model);
  const model =
    text(modelReference.id) ||
    text(modelReference.modelID) ||
    text(message.modelID);
  const timestampMs = object(message.time).created ?? fallback.timestampMs;
  if (
    !model ||
    typeof timestampMs !== "number" ||
    !Number.isFinite(timestampMs)
  )
    return null;
  const reasoningTokens = tokens(usage.reasoning);
  const totals = {
    uncachedInputTokens: tokens(usage.input),
    cachedInputTokens: tokens(cache.read),
    cacheCreationTokens: tokens(cache.write),
    outputTokens: tokens(usage.output) + reasoningTokens,
    reasoningTokens,
  };
  if (totalTokens(totals) === 0) return null;
  const id = fallback.id || text(message.id);
  const cost = message.cost;
  return {
    provider: "opencode",
    timestampMs,
    model,
    sessionId: fallback.sessionId || text(message.sessionID),
    totals,
    // OpenCode writes zero for models without a known rate, including paid
    // subscription models. Let the shared price table estimate those records.
    reportedCostUsd:
      typeof cost === "number" && Number.isFinite(cost) && cost > 0
        ? cost
        : null,
    speed: "standard",
    dedupeKey: id ? `opencode:${id}` : null,
  };
}
