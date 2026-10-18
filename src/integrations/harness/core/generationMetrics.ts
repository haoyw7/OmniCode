import type { GenerationSample } from "../../../features/sessions/model/generationSample";
import type { HarnessEvent } from "./types";

type Emit = (event: HarnessEvent) => void;
type Usage = { key?: string; outputTokens?: number; durationMs?: number };
const trackers = new WeakMap<Emit, GenerationTracker>();

/** One accumulator per user turn, shared by desktop and Host adapters. */
class GenerationTracker {
  private requests = new Map<string, Usage | null>();
  private current?: string;
  private sequence = 0;
  private ended = false;
  private lastSample?: GenerationSample | null;
  constructor(private readonly emit: Emit) {}

  private publish() {
    let outputTokens = 0;
    let durationMs = 0;
    let complete = this.requests.size > 0;
    for (const usage of this.requests.values()) {
      if (!usage) {
        complete = false;
        continue;
      }
      outputTokens += usage.outputTokens!;
      durationMs += usage.durationMs!;
    }
    const sample: GenerationSample | null =
      complete &&
      Number.isSafeInteger(outputTokens) &&
      Number.isFinite(durationMs)
        ? {
            outputTokens,
            durationMs,
            tokenSource: "provider",
            method: "request-total",
            scope: "turn",
          }
        : null;
    if (JSON.stringify(sample) === JSON.stringify(this.lastSample)) return;
    this.lastSample = sample;
    this.emit({ type: "turn.metrics", generationSample: sample });
  }

  /** A request boundary only; message delivery time is never an API timer. */
  request() {
    if (this.ended) return;
    this.current = `request:${++this.sequence}`;
    this.requests.set(this.current, null);
  }

  usage(usage: Usage, total = false) {
    if (this.ended) return;
    if (total) {
      // A provider's turn aggregate replaces, rather than adds to, per-request data.
      this.requests.clear();
      this.current = "turn";
    }
    const key = usage.key ?? this.current ?? `request:${++this.sequence}`;
    this.current = key;
    const valid =
      Number.isSafeInteger(usage.outputTokens) &&
      usage.outputTokens! >= 0 &&
      typeof usage.durationMs === "number" &&
      Number.isFinite(usage.durationMs) &&
      usage.durationMs > 0;
    this.requests.set(key, valid ? usage : null);
    this.publish();
  }

  reset() {
    if (this.ended) return;
    const hadSample = this.requests.size > 0 || this.lastSample !== undefined;
    this.requests.clear();
    this.current = undefined;
    if (hadSample) this.publish();
  }

  event(event: HarnessEvent) {
    if (event.type === "session.error" || event.type === "session.ended")
      this.reset();
    this.emit(event);
  }

  finish() {
    if (this.ended) return;
    this.publish();
    this.ended = true;
  }
}

export function withGenerationMetrics(emit: Emit): Emit {
  const tracker = new GenerationTracker(emit);
  const measured: Emit = (event) => tracker.event(event);
  trackers.set(measured, tracker);
  return measured;
}

export function finishGenerationMetrics(emit: Emit): void {
  trackers.get(emit)?.finish();
}
export function resetGenerationMetrics(emit: Emit): void {
  trackers.get(emit)?.reset();
}
export function generationRequestStarted(emit: Emit): void {
  trackers.get(emit)?.request();
}
/** Completed LLM request: output includes reasoning and tool-call arguments. */
export function reportGenerationUsage(emit: Emit, usage: Usage): void {
  trackers.get(emit)?.usage(usage);
}
/** Provider aggregate of LLM requests, excluding tool execution and user waits. */
export function reportGenerationTotals(emit: Emit, usage: Usage): void {
  trackers.get(emit)?.usage(usage, true);
}

/** Binds collection to the provider send promise, including abort/error cleanup. */
export async function measureGenerationTurn<T extends { onEvent: Emit }>(
  input: T,
  send: (input: T) => Promise<void>,
): Promise<void> {
  const onEvent = withGenerationMetrics(input.onEvent);
  try {
    await send({ ...input, onEvent });
  } catch (error) {
    resetGenerationMetrics(onEvent);
    throw error;
  } finally {
    finishGenerationMetrics(onEvent);
  }
}
