import { describe, expect, it } from "vitest";
import type { HarnessEvent } from "../../../contracts/harness";
import { formatGenerationRate, sanitizeGenerationSample } from "../../../features/sessions/model/generationSample";
import { finishGenerationMetrics, generationRequestStarted, generationStreamDelta, reportGenerationStreamUsage, reportGenerationUsage, reportGenerationTotals, resetGenerationMetrics, withGenerationMetrics, measureGenerationTurn, observeGenerationDelta, reportObservedGenerationUsage, invalidateObservedGeneration, emitAcpGenerationEvent, estimateOutputTokens } from "./generationMetrics";

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

describe("protocol streaming samples", () => {
  it("pairs late and repeated usage with its message instead of the current one", () => {
    const { emit, sample } = setup();
    observeGenerationDelta(emit, "a", "a", 1_000);
    observeGenerationDelta(emit, "b", "a", 2_000);
    observeGenerationDelta(emit, "c", "b", 100_000);
    reportObservedGenerationUsage(emit, "a", 20);
    reportObservedGenerationUsage(emit, "a", 20);
    observeGenerationDelta(emit, "d", "b", 102_000);
    reportObservedGenerationUsage(emit, "b", 40);
    finishGenerationMetrics(emit);
    expect(sample()).toMatchObject({ outputTokens: 60, durationMs: 3_000, tokenSource: "provider" });
  });

  it("excludes tool, approval and background waits from unkeyed streams", () => {
    const { emit, sample } = setup();
    observeGenerationDelta(emit, "你好", undefined, 1_000);
    observeGenerationDelta(emit, "世界", undefined, 3_000);
    emit({ type: "tool.updated", callId: "t", status: "in_progress" });
    emit({ type: "approval.requested", requestId: 1, title: "Allow" });
    emit({ type: "background.updated", tasks: ["child"] });
    observeGenerationDelta(emit, "abcd", undefined, 200_000);
    observeGenerationDelta(emit, "efgh", undefined, 201_000);
    finishGenerationMetrics(emit);
    expect(sample()).toEqual({ outputTokens: 6, durationMs: 3_000,
      tokenSource: "text-estimate", estimator: "text-heuristic-v1", method: "stream-observed", scope: "turn" });
    expect(sanitizeGenerationSample(sample())).toEqual(sample());
  });

  it("counts only parent ACP chunks, including thinking, and ignores context totals", () => {
    const { emit, sample } = setup();
    const chunk = (text: string, at: number, sessionId = "parent", thinking = false) =>
      emitAcpGenerationEvent(emit, { type: thinking ? "reasoning.delta" : "message.delta", text },
        { sessionId, update: { sessionUpdate: thinking ? "agent_thought_chunk" : "agent_message_chunk" } }, at, "parent");
    chunk("你好", 1_000, "parent", true);
    chunk("child output", 90_000, "child");
    chunk("世界", 3_000);
    emitAcpGenerationEvent(emit, { type: "turn.metrics", outputTokens: 90_000 },
      { sessionId: "parent", update: { sessionUpdate: "usage_update" } }, 500_000, "parent");
    finishGenerationMetrics(emit);
    expect(sample()).toMatchObject({ outputTokens: 4, durationMs: 2_000, tokenSource: "text-estimate" });
  });

  it("does not pretend an unobserved snapshot suffix was streamed", () => {
    const { emit, sample } = setup();
    observeGenerationDelta(emit, "a", "m", 1_000);
    observeGenerationDelta(emit, "b", "m", 2_000);
    reportObservedGenerationUsage(emit, "m", 20);
    invalidateObservedGeneration(emit, "m");
    reportObservedGenerationUsage(emit, "m", 30);
    finishGenerationMetrics(emit);
    expect(sample()).toBeNull();
  });

  it("rejects full ACP messages and locally batched output as timing samples", () => {
    for (const kind of ["agent_message", "agent_message_chunk"]) {
      const { emit, sample } = setup();
      for (const at of [1_000, 1_001])
        emitAcpGenerationEvent(emit, { type: "message.delta", text: "你好" },
          { update: { sessionUpdate: kind } }, at, "parent");
      finishGenerationMetrics(emit);
      expect(sample()).toBeNull();
    }
  });

  it("keeps the fallback independent of chunk boundaries, including surrogate pairs", () => {
    const text = "abc你好🙂 xyz";
    const { emit, sample } = setup();
    text.split("").forEach((char, i) => observeGenerationDelta(emit, char, "m", i * 100));
    finishGenerationMetrics(emit);
    expect(sample()?.outputTokens).toBe(estimateOutputTokens(text));
  });

  it("clears both native and estimated samples on cancellation and ignores late frames", () => {
    const { emit, sample } = setup();
    observeGenerationDelta(emit, "a", "m", 1_000);
    observeGenerationDelta(emit, "b", "m", 2_000);
    emit({ type: "session.error", message: "cancelled" });
    finishGenerationMetrics(emit);
    observeGenerationDelta(emit, "late", "m", 3_000);
    reportObservedGenerationUsage(emit, "m", 100);
    expect(sample()).toBeNull();
  });
});

describe("observed generation throughput", () => {
  it("sums streaming spans without initial, tool or usage-report waits", () => {
    const { emit, sample } = setup();
    generationRequestStarted(emit);
    generationStreamDelta(emit, "", 1_000);
    generationStreamDelta(emit, "thinking", 9_000);
    generationStreamDelta(emit, "answer", 11_000);
    reportGenerationStreamUsage(emit, 100);
    expect(sample()).toMatchObject({ outputTokens: 100, durationMs: 2_000 });
    generationRequestStarted(emit);
    expect(sample()).toBeNull();
    generationStreamDelta(emit, "{", 200_000);
    generationStreamDelta(emit, "}", 203_000);
    reportGenerationStreamUsage(emit, 150);
    // Repeated completion and late output must not change a completed sample.
    generationStreamDelta(emit, "late", 300_000);
    reportGenerationStreamUsage(emit, 150);
    finishGenerationMetrics(emit);
    expect(sample()).toEqual({ outputTokens: 250, durationMs: 5_000,
      method: "stream-observed", tokenSource: "provider", scope: "turn" });
    expect(formatGenerationRate(sample()!, "en")).toBe("50");
  });

  it.each([[], [1_000], [1_000, 1_000], [2_000, 1_000]])(
    "does not invent timing from missing, buffered or invalid deltas: %j",
    (...times: number[]) => {
      const { emit, sample } = setup();
      generationRequestStarted(emit);
      for (const time of times) generationStreamDelta(emit, "text", time);
      reportGenerationStreamUsage(emit, 100);
      finishGenerationMetrics(emit);
      expect(sample()).toBeNull();
    },
  );

  it("never mixes request time and streaming time in one rate", () => {
    const { emit, sample } = setup();
    generationRequestStarted(emit);
    generationStreamDelta(emit, "a", 1_000);
    generationStreamDelta(emit, "b", 2_000);
    reportGenerationStreamUsage(emit, 100);
    generationRequestStarted(emit);
    reportGenerationUsage(emit, { outputTokens: 100, durationMs: 8_000 });
    expect(sample()).toBeNull();
  });

  it("resets streaming timing on cancellation and ignores late frames", () => {
    const { emit, sample } = setup();
    generationRequestStarted(emit);
    generationStreamDelta(emit, "a", 1_000);
    generationStreamDelta(emit, "b", 2_000);
    reportGenerationStreamUsage(emit, 100);
    resetGenerationMetrics(emit);
    generationStreamDelta(emit, "late", 3_000);
    reportGenerationStreamUsage(emit, 100);
    finishGenerationMetrics(emit);
    expect(sample()).toBeNull();
  });
});
