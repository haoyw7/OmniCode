import type { GenerationSample } from "../../../contracts/session";
import type { HarnessEvent } from "../../../contracts/harness";

type Emit = (event: HarnessEvent) => void;
type Usage = {
  key?: string;
  outputTokens?: number;
  durationMs?: number;
  method?: GenerationSample["method"];
  tokenSource?: GenerationSample["tokenSource"];
};
const trackers = new WeakMap<Emit, GenerationTracker>();
type ObservedStream = {
  first?: number;
  last?: number;
  text: string;
  outputTokens?: number;
  closed: boolean;
  missing: boolean;
};
const eastAsian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const encoder = new TextEncoder();
const MIN_OBSERVED_SPAN_MS = 100;

/** Fallback only: not a model tokenizer or provider billing usage. */
export function estimateOutputTokens(text: string): number {
  let units = 0;
  for (const char of text)
    units += eastAsian.test(char) ? 1 : encoder.encode(char).length / 4;
  return Math.ceil(units);
}

/** One accumulator per user turn, shared by desktop and Host adapters. */
class GenerationTracker {
  private requests = new Map<string, Usage | null>();
  private current?: string;
  private sequence = 0;
  private ended = false;
  private lastSample?: GenerationSample | null;
  private stream?: { first?: number; last?: number; finished: boolean };
  private observed = new Map<string, ObservedStream>();
  private activeObserved?: string;
  constructor(private readonly emit: Emit) {}

  private publish() {
    let outputTokens = 0;
    let durationMs = 0;
    let complete = this.requests.size > 0;
    let method: GenerationSample["method"] | undefined;
    let estimated = false;
    for (const usage of this.requests.values()) {
      if (!usage) {
        complete = false;
        continue;
      }
      outputTokens += usage.outputTokens!;
      durationMs += usage.durationMs!;
      const nextMethod = usage.method ?? "request-total";
      if (method && method !== nextMethod) complete = false;
      method = nextMethod;
      estimated ||= usage.tokenSource === "text-estimate";
    }
    const sample: GenerationSample | null =
      complete &&
      Number.isSafeInteger(outputTokens) &&
      Number.isFinite(durationMs)
        ? {
            outputTokens,
            durationMs,
            tokenSource: estimated ? "text-estimate" : "provider",
            ...(estimated ? { estimator: "text-heuristic-v1" as const } : {}),
            method: method ?? "request-total",
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
    this.stream = { finished: false };
    // A previous request's sample is no longer a complete turn sample.
    this.publish();
  }

  streamDelta(text: string, receivedAt: number) {
    if (
      this.ended || !this.stream || this.stream.finished ||
      !text || !Number.isFinite(receivedAt)
    ) return;
    this.stream.first ??= receivedAt;
    this.stream.last = receivedAt;
  }

  streamUsage(outputTokens?: number) {
    if (this.ended || !this.stream || this.stream.finished) return;
    this.stream.finished = true;
    const { first, last } = this.stream;
    const duration = first != null && last != null ? last - first : 0;
    // A snapshot/single buffered chunk has no measurable streaming interval.
    this.usage({
      outputTokens,
      durationMs: duration >= MIN_OBSERVED_SPAN_MS ? duration : undefined,
      method: "stream-observed",
    });
  }

  /** Keyed protocols pair usage with a message; unkeyed protocols use output spans. */
  observe(text: string, at: number, key?: string) {
    if (this.ended || !text || !Number.isFinite(at)) return;
    const id = key != null ? `observed:${key}` :
      (this.activeObserved ??= `observed:auto:${++this.sequence}`);
    const stream = this.observed.get(id) ?? this.newObserved(id);
    if (stream.closed) return;
    stream.first ??= at;
    stream.last = at;
    stream.text += text;
  }

  private newObserved(id: string): ObservedStream {
    const stream = { text: "", closed: false, missing: false };
    this.observed.set(id, stream);
    this.requests.set(id, null);
    this.publish();
    return stream;
  }

  observedUsage(key: string, outputTokens?: number) {
    if (this.ended) return;
    const id = `observed:${key}`;
    if (outputTokens === 0 && !this.observed.has(id)) return;
    const stream = this.observed.get(id) ?? this.newObserved(id);
    if (Number.isSafeInteger(outputTokens) && outputTokens! >= 0)
      stream.outputTokens = outputTokens;
    this.closeObserved(id, stream);
  }

  missingObserved(key?: string) {
    if (this.ended) return;
    const id = key != null ? `observed:${key}` :
      (this.activeObserved ??= `observed:auto:${++this.sequence}`);
    const stream = this.observed.get(id) ?? this.newObserved(id);
    stream.missing = true;
    this.requests.set(id, null);
    this.publish();
  }

  private closeObserved(id: string, stream: ObservedStream) {
    stream.closed = true;
    const duration = stream.first != null && stream.last != null
      ? stream.last - stream.first : 0;
    this.usage({
      key: id,
      outputTokens: stream.outputTokens ?? estimateOutputTokens(stream.text),
      durationMs: !stream.missing && duration >= MIN_OBSERVED_SPAN_MS ? duration : undefined,
      method: "stream-observed",
      tokenSource: stream.outputTokens == null ? "text-estimate" : "provider",
    });
  }

  observedBoundary() {
    if (this.ended || !this.activeObserved) return;
    const id = this.activeObserved;
    this.activeObserved = undefined;
    const stream = this.observed.get(id);
    if (stream) this.closeObserved(id, stream);
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
    this.stream = undefined;
    this.observed.clear();
    this.activeObserved = undefined;
    if (hadSample) this.publish();
  }

  event(event: HarnessEvent) {
    if (event.type === "session.error" || event.type === "session.ended")
      this.reset();
    // Only unkeyed output spans use UI events as boundaries. Claude/OpenCode
    // have real message boundaries, including streamed tool arguments.
    if (event.type === "tool.started" || event.type === "tool.updated" ||
      event.type === "approval.requested" || event.type === "question.asked" ||
      event.type === "message.completed" ||
      (event.type === "background.updated" && event.tasks.length > 0))
      this.observedBoundary();
    this.emit(event);
  }

  forward(event: HarnessEvent) { this.emit(event); }

  finish() {
    if (this.ended) return;
    for (const [id, stream] of this.observed)
      if (!stream.closed) this.closeObserved(id, stream);
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
/** Nonempty text, reasoning or tool-argument delta at the adapter boundary. */
export function generationStreamDelta(
  emit: Emit,
  text: string,
  receivedAt = performance.now(),
): void {
  trackers.get(emit)?.streamDelta(text, receivedAt);
}
/** Pair provider tokens with this request's first-to-last observed output span. */
export function reportGenerationStreamUsage(emit: Emit, outputTokens?: number): void {
  trackers.get(emit)?.streamUsage(outputTokens);
}
/** Call only for original parent-stream deltas, never completion snapshots. */
export function observeGenerationDelta(emit: Emit, text: string, key?: string, receivedAt = performance.now()): void {
  trackers.get(emit)?.observe(text, receivedAt, key);
}
export function reportObservedGenerationUsage(emit: Emit, key: string, outputTokens?: number): void {
  trackers.get(emit)?.observedUsage(key, outputTokens);
}
export function invalidateObservedGeneration(emit: Emit, key?: string): void {
  trackers.get(emit)?.missingObserved(key);
}

/** Invoke after child routing. ACP context usage is not per-response output usage. */
export function emitAcpGenerationEvent(emit: Emit, event: HarnessEvent, params: unknown,
  receivedAt: number, sessionId: string): void {
  const envelope = params as { update?: Record<string, unknown>; sessionId?: string; session_id?: string } | null;
  const source = envelope?.sessionId ?? envelope?.session_id;
  if (source && source !== sessionId) {
    const tracker = trackers.get(emit);
    if (tracker) tracker.forward(event);
    else emit(event);
    return;
  }
  const update = envelope?.update ?? envelope as Record<string, unknown> | null;
  const kind = update?.sessionUpdate ?? update?.session_update ?? update?.type;
  if (event.type === "message.delta" || event.type === "reasoning.delta") {
    if (kind === "agent_message_chunk" || kind === "agent_thought_chunk")
      observeGenerationDelta(emit, event.text, undefined, receivedAt);
    else if (event.text) invalidateObservedGeneration(emit);
  }
  emit(event);
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
