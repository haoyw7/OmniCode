import type { GenerationSample } from "../../../features/sessions/model/generationSample";
import type { HarnessEvent } from "./types";

type Emit = (event: HarnessEvent) => void;
type Segment = {
  key?: string;
  text: string;
  first: number;
  last: number;
  chunks: number;
  closed: boolean;
};
type Usage = { key?: string; outputTokens?: number; reasoningTokens?: number };
const trackers = new WeakMap<Emit, GenerationTracker>();
const eastAsian =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const encoder = new TextEncoder();

/** Deterministic fallback, deliberately independent of chunk boundaries. */
export function estimateOutputTokens(text: string): number {
  let units = 0;
  for (const char of text)
    units += eastAsian.test(char) ? 1 : encoder.encode(char).length / 4;
  return Math.ceil(units);
}

/** One instance per send, shared by every provider and both runtimes. */
class GenerationTracker {
  private segment?: Segment;
  private segments = 0;
  private unsafe = false;
  private reasoning = false;
  private reported?: number;
  private published = false;
  private ended = false;
  constructor(private readonly emit: Emit) {}

  private publish(sample: GenerationSample | null) {
    this.published = true;
    this.emit({ type: "turn.metrics", generationSample: sample });
  }

  private sample(): GenerationSample | null {
    const s = this.segment;
    if (!s || s.chunks < 2 || s.last - s.first < 100) return null;
    return {
      outputTokens: this.reported ?? estimateOutputTokens(s.text),
      durationMs: s.last - s.first,
      tokenSource: this.reported == null ? "text-estimate" : "provider",
      method: "stream-estimate",
      scope: "last-text-segment",
      ...(this.reported == null
        ? { estimator: "text-heuristic-v1" as const }
        : {}),
    };
  }

  text(text: string, key: string | undefined, at: number) {
    if (!this.ended && text) {
      if (!this.segment || this.segment.closed || this.segment.key !== key) {
        if (this.published) this.publish(null);
        this.segment = {
          key,
          text: "",
          first: at,
          last: at,
          chunks: 0,
          closed: false,
        };
        this.segments++;
        this.reported = undefined;
      }
      this.segment.text += text;
      this.segment.last = at;
      this.segment.chunks++;
    }
    this.emit({ type: "message.delta", text });
  }

  close() {
    if (this.ended || !this.segment || this.segment.closed) return;
    this.segment.closed = true;
    this.publish(this.sample());
  }

  usage(usage: Usage) {
    if (this.ended) return;
    const s = this.segment;
    const n = usage.outputTokens;
    const reasoning = usage.reasoningTokens;
    if (
      s &&
      this.segments === 1 &&
      !this.unsafe &&
      (usage.key == null || s.key === usage.key) &&
      n != null &&
      Number.isSafeInteger(n) &&
      n > 0 &&
      n - (reasoning ?? 0) > 0 &&
      (!this.reasoning || reasoning != null) &&
      (reasoning == null ||
        (Number.isSafeInteger(reasoning) && reasoning >= 0 && reasoning <= n))
    ) {
      this.reported = n - (reasoning ?? 0);
    }
    const wasClosed = s?.closed;
    this.close();
    if (wasClosed && this.reported != null) this.publish(this.sample());
  }

  /** A verified model-request boundary; not a generic token snapshot update. */
  request() {
    this.close();
    this.segments = 0;
    this.unsafe = false;
    this.reasoning = false;
    this.reported = undefined;
    // Keep the displayed result, but never pair the old segment with new usage.
    this.segment = undefined;
  }

  reset() {
    if (this.ended) return;
    if (this.segment || this.published) this.publish(null);
    this.segment = undefined;
    this.segments = 0;
    this.unsafe = false;
    this.reasoning = false;
    this.reported = undefined;
  }

  event(event: HarnessEvent) {
    if (!this.ended) {
      switch (event.type) {
        case "message.delta":
          // Untagged text is a snapshot/remainder, never a timed stream chunk.
          if (event.text) {
            this.reset();
            this.publish(null);
            this.unsafe = true;
          }
          break;
        case "session.error":
        case "session.ended":
          this.reset();
          break;
        case "reasoning.delta":
          this.close();
          this.reasoning = true;
          break;
        case "message.completed":
          this.close();
          break;
        case "tool.started":
        case "tool.updated":
        case "approval.requested":
        case "question.asked":
        case "plan":
          this.close();
          this.unsafe = true;
          break;
        case "background.updated":
          if (event.tasks.length) {
            this.close();
            this.unsafe = true;
          }
          break;
        case "image.generated":
          if (!event.agentCallId) {
            this.close();
            this.unsafe = true;
          }
          break;
      }
    }
    this.emit(event);
  }

  forward(event: HarnessEvent) {
    this.emit(event);
  }
  finish() {
    this.close();
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
export function reportGenerationUsage(emit: Emit, usage: Usage): void {
  trackers.get(emit)?.usage(usage);
}

/** Called only for original, deduplicated streaming text, after parent routing. */
export function emitGenerationText(
  emit: Emit,
  text: string,
  key?: string,
  receivedAt = performance.now(),
): void {
  const tracker = trackers.get(emit);
  if (tracker) tracker.text(text, key, receivedAt);
  else emit({ type: "message.delta", text });
}

/** ACP full messages and history snapshots must never become timed chunks. */
export function emitAcpGenerationEvent(
  emit: Emit,
  event: HarnessEvent,
  params: unknown,
  receivedAt = performance.now(),
  sessionId?: string,
): void {
  const envelope = params as {
    update?: Record<string, unknown>;
    sessionId?: string;
    session_id?: string;
  } | null;
  const sourceSession = envelope?.sessionId ?? envelope?.session_id;
  if (sessionId && sourceSession && sourceSession !== sessionId) {
    const tracker = trackers.get(emit);
    if (tracker) tracker.forward(event);
    else emit(event);
    return;
  }
  const update = (envelope?.update ?? params) as Record<string, unknown> | null;
  const kind = update?.sessionUpdate ?? update?.session_update ?? update?.type;
  if (event.type === "message.delta" && kind === "agent_message_chunk") {
    const id = update?.messageId ?? update?.message_id;
    emitGenerationText(
      emit,
      event.text,
      typeof id === "string" ? id : undefined,
      receivedAt,
    );
  } else emit(event);
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
