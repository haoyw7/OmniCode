// Adapted from T3 Code (MIT); see licenses/T3Code-MIT.txt.
import {
  totalTokens,
  parseTimestampMs,
  type UsageTokenTotals,
  type UsageRecord,
  type UsageSpeed,
} from "../../core/usage";
type CodexTokenUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};
const CODEX_USAGE_FIELDS: (keyof CodexTokenUsage)[] = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];
function isCodexTokenUsage(
  value: Record<string, unknown>,
): value is CodexTokenUsage {
  return (
    CODEX_USAGE_FIELDS.every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isSafeInteger(value[key]) &&
        (value[key] as number) >= 0,
    ) &&
    Number(value.cached_input_tokens) +
      Number(value.cache_write_input_tokens) <=
      Number(value.input_tokens) &&
    Number(value.reasoning_output_tokens) <= Number(value.output_tokens) &&
    Number(value.total_tokens) >=
      Number(value.input_tokens) + Number(value.output_tokens)
  );
}
function readCodexTokenUsage(value: unknown): CodexTokenUsage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const raw = value as Record<string, unknown>;
  const input = raw["input_tokens"];
  const output = raw["output_tokens"];
  if (typeof input !== "number" || typeof output !== "number") return null;
  const usage = {
    input_tokens: input,
    cached_input_tokens:
      raw["cached_input_tokens"] === undefined ? 0 : raw["cached_input_tokens"],
    cache_write_input_tokens:
      raw["cache_write_input_tokens"] === undefined
        ? 0
        : raw["cache_write_input_tokens"],
    output_tokens: output,
    reasoning_output_tokens:
      raw["reasoning_output_tokens"] === undefined
        ? 0
        : raw["reasoning_output_tokens"],
    total_tokens:
      raw["total_tokens"] === undefined ? input + output : raw["total_tokens"],
  };
  return isCodexTokenUsage(usage) ? usage : null;
}

function advanceCodexUsage(
  previous: CodexTokenUsage | null,
  last: CodexTokenUsage,
) {
  return readCodexTokenUsage(
    Object.fromEntries(
      CODEX_USAGE_FIELDS.map((key) => [
        key,
        (previous?.[key] ?? 0) + last[key],
      ]),
    ),
  );
}

/**
 * Codex `token_count` events carry no model or service tier, so both are carried forward: the model
 * from the most recent `turn_context`, the tier from the most recent `thread_settings_applied`.
 */
export interface CodexScanState {
  model: string;
  speed: UsageSpeed;
  sessionId: string;
  lastUsageSignature: string | null;
  lastCumulativeUsage: CodexTokenUsage | null;
  malformedRecords: number;
  sawSessionMeta: boolean;
  modelProvider: string;
  turnId: string;
  sawThreadSettings: boolean;
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
}
export function initialCodexScanState(): CodexScanState {
  return {
    model: "",
    speed: "standard",
    sessionId: "",
    lastUsageSignature: null,
    lastCumulativeUsage: null,
    malformedRecords: 0,
    sawSessionMeta: false,
    modelProvider: "",
    turnId: "",
    sawThreadSettings: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
  };
}

/**
 * A forked or subagent rollout opens with the parent's full history copied in,
 * every line re-stamped to the fork instant. Those copies are written in one
 * synchronous burst (observed gaps 0-40ms), while the child's first genuine
 * usage event only lands after a real model turn (observed 5s+).
 */
const FORK_COPY_MAX_GAP_MS = 1000;

function isForkedSessionMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload["forked_from_id"] === "string") return true;
  const source = payload["source"];
  if (typeof source !== "object" || source === null) return false;
  const subagent = (source as Record<string, unknown>)["subagent"];
  if (typeof subagent !== "object" || subagent === null) return false;
  const spawn = (subagent as Record<string, unknown>)["thread_spawn"];
  if (typeof spawn !== "object" || spawn === null) return false;
  return (
    typeof (spawn as Record<string, unknown>)["parent_thread_id"] === "string"
  );
}

/**
 * Cumulative counters validate request deltas. Older events without cumulative counters use
 * normalized consecutive-request deduplication.
 */
export function parseCodexLine(
  line: string,
  state: CodexScanState,
): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  return parseCodexRecord(parsed, state);
}

export function parseCodexRecord(
  parsed: unknown,
  state: CodexScanState,
): UsageRecord | null {
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const payload = record["payload"];
  if (typeof payload !== "object" || payload === null) return null;
  const payloadRecord = payload as Record<string, unknown>;
  const payloadType = payloadRecord["type"];

  if (record["type"] === "session_meta") {
    // Only the first meta describes this file's own session. A forked rollout
    // repeats the ancestors' metas right after it; letting those through would
    // reassign every subsequent record to an ancestor session.
    if (state.sawSessionMeta) return null;
    state.sawSessionMeta = true;
    const id = payloadRecord["id"] ?? payloadRecord["session_id"];
    if (typeof id === "string") state.sessionId = id;
    if (typeof payloadRecord["model_provider"] === "string") {
      state.modelProvider = payloadRecord["model_provider"];
    }
    const metaTimestampMs = parseTimestampMs(record["timestamp"]);
    if (metaTimestampMs !== null && isForkedSessionMeta(payloadRecord)) {
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = metaTimestampMs;
    }
    return null;
  }

  if (record["type"] === "turn_context") {
    if (typeof payloadRecord["model"] === "string")
      state.model = payloadRecord["model"];
    // Model carry is useful for usage, but history recovery needs this context's own identity.
    state.turnId =
      typeof payloadRecord["turn_id"] === "string" &&
      typeof payloadRecord["model"] === "string" &&
      payloadRecord["model"].length > 0
        ? payloadRecord["turn_id"]
        : "";
    return null;
  }

  if (payloadType === "thread_settings_applied") {
    state.sawThreadSettings = true;
    const settings = payloadRecord["thread_settings"];
    if (typeof settings === "object" && settings !== null) {
      state.speed = codexSpeed(
        (settings as Record<string, unknown>)["service_tier"],
      );
    }
    return null;
  }

  if (payloadType !== "token_count") return null;

  const info = payloadRecord["info"];
  if (typeof info !== "object" || info === null) return null;
  const infoRecord = info as Record<string, unknown>;

  // Codex may re-emit these counters after the model or timestamp becomes available.
  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null || state.model.length === 0) return null;

  const last = readCodexTokenUsage(infoRecord["last_token_usage"]);
  const rawCumulative = infoRecord["total_token_usage"];
  const hasCumulative = rawCumulative !== undefined && rawCumulative !== null;
  const cumulative = hasCumulative ? readCodexTokenUsage(rawCumulative) : null;

  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
      state.forkCopyAnchorMs = timestampMs;
      // Copied history is already billed in the parent, but establishes the child's baseline.
      const signature = last === null ? null : JSON.stringify(last);
      if (cumulative !== null) state.lastCumulativeUsage = cumulative;
      else if (
        !hasCumulative &&
        last !== null &&
        signature !== state.lastUsageSignature
      ) {
        state.lastCumulativeUsage = advanceCodexUsage(
          state.lastCumulativeUsage,
          last,
        );
      }
      state.lastUsageSignature = signature;
      return null;
    }
    state.suppressingForkCopies = false;
    state.lastUsageSignature = null;
  }

  const previous = state.lastCumulativeUsage;
  // A valid snapshot remains the next baseline even when its paired request is malformed.
  if (cumulative !== null) state.lastCumulativeUsage = cumulative;
  if (last === null || (hasCumulative && cumulative === null)) {
    state.malformedRecords += 1;
    return null;
  }

  // Zero-component counters report context size, not a request: fill_to_context_window, or the
  // post-compaction marker whose total is the new context size (its cumulative may reset to zero).
  if (last.input_tokens + last.output_tokens === 0) {
    state.lastUsageSignature = null;
    return null;
  }

  if (
    cumulative !== null &&
    previous !== null &&
    CODEX_USAGE_FIELDS.every((key) => cumulative[key] === previous[key])
  ) {
    return null;
  }

  if (last.total_tokens !== last.input_tokens + last.output_tokens) {
    state.malformedRecords += 1;
    return null;
  }

  const signature = JSON.stringify(last);
  if (cumulative !== null) {
    // A session resumed in a new Codex process restarts its cumulative counters at this request.
    const restarted = CODEX_USAGE_FIELDS.every(
      (key) => cumulative[key] === last[key],
    );
    if (
      !restarted &&
      !CODEX_USAGE_FIELDS.every(
        (key) => cumulative[key] - (previous?.[key] ?? 0) === last[key],
      )
    ) {
      state.malformedRecords += 1;
      return null;
    }
  } else {
    if (signature === state.lastUsageSignature) return null;
    // Advance expected totals for billed legacy requests so a cumulative re-emission is stale.
    const advanced = advanceCodexUsage(previous, last);
    if (advanced === null) {
      state.malformedRecords += 1;
      return null;
    }
    state.lastCumulativeUsage = advanced;
  }
  state.lastUsageSignature = signature;

  const inputTokens = last.input_tokens;
  const cachedInputTokens = last.cached_input_tokens;
  const cacheCreationTokens = last.cache_write_input_tokens;
  const outputTokens = last.output_tokens;

  const totals: UsageTokenTotals = {
    // Codex reports `input_tokens` inclusive of the cached portion.
    uncachedInputTokens: inputTokens - cachedInputTokens - cacheCreationTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    // Reported inside output_tokens, surfaced separately for the token mix.
    reasoningTokens: last.reasoning_output_tokens,
  };

  if (totalTokens(totals) === 0) return null;

  return {
    provider: "codex",
    timestampMs,
    model: state.model,
    sessionId: state.sessionId,
    totals,
    reportedCostUsd: null,
    speed: state.speed,
    ...(!state.sawThreadSettings &&
    state.modelProvider === "openai" &&
    state.sessionId.length > 0 &&
    state.turnId.length > 0
      ? { unresolvedServiceTierTurnId: state.turnId }
      : {}),
    dedupeKey: null,
  };
}

/**
 * Codex omits the field when no tier was requested, which bills as standard, as
 * do `default` and `standard`. `fast` is accepted as an alias of `priority`.
 */
function codexSpeed(serviceTier: unknown): UsageSpeed {
  if (serviceTier === "priority" || serviceTier === "fast") return "fast";
  if (serviceTier === "ultrafast") return "ultrafast";
  return "standard";
}
