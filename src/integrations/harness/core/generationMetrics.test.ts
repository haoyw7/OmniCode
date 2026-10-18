import { describe, expect, it } from "vitest";
import type { HarnessEvent } from "./types";
import {
  formatGenerationRate,
  sanitizeGenerationSample,
} from "../../../features/sessions/model/generationSample";
import {
  finishGenerationMetrics,
  generationRequestStarted,
  reportGenerationUsage,
  reportGenerationTotals,
  resetGenerationMetrics,
  withGenerationMetrics,
  measureGenerationTurn,
} from "./generationMetrics";

function setup() {
  const events: HarnessEvent[] = [];
  const emit = withGenerationMetrics((e) => events.push(e));
  return {
    events,
    emit,
    sample: () =>
      events.filter((e) => e.type === "turn.metrics").at(-1)?.generationSample,
  };
}

describe("turn request throughput", () => {
  it("divides summed output by summed request time instead of averaging rates", () => {
    const { emit, sample } = setup();
    generationRequestStarted(emit);
    emit({ type: "reasoning.delta", text: "thinking" });
    emit({ type: "tool.started", callId: "t", title: "Tool" });
    reportGenerationUsage(emit, { outputTokens: 100, durationMs: 1_000 });
    emit({
      type: "approval.requested",
      requestId: "approval",
      title: "Approve",
    } as HarnessEvent);
    emit({ type: "tool.updated", callId: "t", status: "completed" });
    generationRequestStarted(emit);
    emit({ type: "message.delta", text: "A buffered whole response" });
    reportGenerationUsage(emit, { outputTokens: 300, durationMs: 9_000 });
    finishGenerationMetrics(emit);
    expect(sample()).toEqual({
      outputTokens: 400,
      durationMs: 10_000,
      tokenSource: "provider",
      method: "request-total",
      scope: "turn",
    });
    expect(formatGenerationRate(sample()!, "en")).toBe("40");
  });

  it("accepts tool-only and zero-output requests and includes their request durations", () => {
    const { emit, sample } = setup();
    generationRequestStarted(emit);
    reportGenerationUsage(emit, { outputTokens: 0, durationMs: 1_000 });
    generationRequestStarted(emit);
    reportGenerationUsage(emit, { outputTokens: 20, durationMs: 1_000 });
    expect(sample()).toMatchObject({ outputTokens: 20, durationMs: 2_000 });
  });

  it("replaces provider totals without double counting repeated result frames", () => {
    const { emit, sample } = setup();
    reportGenerationUsage(emit, {
      key: "a",
      outputTokens: 100,
      durationMs: 1_000,
    });
    for (let i = 0; i < 2; i++)
      reportGenerationTotals(emit, { outputTokens: 500, durationMs: 10_000 });
    expect(sample()).toMatchObject({ outputTokens: 500, durationMs: 10_000 });
  });

  it("deduplicates identified request reports and allows corrected totals", () => {
    const { emit, sample } = setup();
    reportGenerationUsage(emit, {
      key: "a",
      outputTokens: 100,
      durationMs: 1_000,
    });
    reportGenerationUsage(emit, {
      key: "b",
      outputTokens: 200,
      durationMs: 2_000,
    });
    reportGenerationUsage(emit, {
      key: "a",
      outputTokens: 110,
      durationMs: 1_100,
    });
    expect(sample()).toMatchObject({ outputTokens: 310, durationMs: 3_100 });
  });

  it.each([undefined, 0, -1, Infinity, NaN])(
    "does not use partial totals when a request duration is %s",
    (durationMs) => {
      const { emit, sample } = setup();
      generationRequestStarted(emit);
      reportGenerationUsage(emit, { outputTokens: 100, durationMs: 1_000 });
      generationRequestStarted(emit);
      reportGenerationUsage(emit, { outputTokens: 200, durationMs });
      finishGenerationMetrics(emit);
      expect(sample()).toBeNull();
    },
  );

  it.each([undefined, -1, 1.5, Infinity, NaN])(
    "rejects invalid output %s without estimating from text",
    (outputTokens) => {
      const { emit, sample } = setup();
      emit({ type: "message.delta", text: "A very long response" });
      reportGenerationUsage(emit, { outputTokens, durationMs: 1_000 });
      expect(sample()).toBeNull();
    },
  );

  it("does not report a whole-turn rate for an unfinished request", () => {
    const { emit, sample } = setup();
    generationRequestStarted(emit);
    reportGenerationUsage(emit, { outputTokens: 100, durationMs: 1_000 });
    generationRequestStarted(emit);
    finishGenerationMetrics(emit);
    expect(sample()).toBeNull();
  });

  it("clears cancellation and ignores reports after finish", () => {
    const { emit, sample } = setup();
    reportGenerationTotals(emit, { outputTokens: 100, durationMs: 1_000 });
    resetGenerationMetrics(emit);
    finishGenerationMetrics(emit);
    reportGenerationTotals(emit, { outputTokens: 999, durationMs: 1_000 });
    expect(sample()).toBeNull();
  });

  it("cleans up a rejected provider send", async () => {
    const events: HarnessEvent[] = [];
    await expect(
      measureGenerationTurn(
        { onEvent: (e) => events.push(e) },
        async ({ onEvent }) => {
          reportGenerationTotals(onEvent, {
            outputTokens: 100,
            durationMs: 1_000,
          });
          throw new Error("failed");
        },
      ),
    ).rejects.toThrow("failed");
    expect(
      events.filter((e) => e.type === "turn.metrics").at(-1)?.generationSample,
    ).toBeNull();
  });

  it("leaves unsupported protocols unavailable even with streamed text", () => {
    const { emit, sample } = setup();
    emit({ type: "message.delta", text: "Hello" });
    emit({ type: "message.delta", text: " world" });
    finishGenerationMetrics(emit);
    expect(sample()).toBeNull();
  });

  it("rejects old stream history while preserving valid request totals", () => {
    const value = {
      outputTokens: 850,
      durationMs: 243,
      tokenSource: "provider",
      method: "request-total",
      scope: "turn",
    };
    expect(sanitizeGenerationSample(value)).toEqual(value);
    expect(
      sanitizeGenerationSample({
        ...value,
        method: "stream-estimate",
        scope: "last-text-segment",
      }),
    ).toBeNull();
    expect(
      sanitizeGenerationSample({ ...value, tokenSource: "text-estimate" }),
    ).toBeNull();
  });
});
