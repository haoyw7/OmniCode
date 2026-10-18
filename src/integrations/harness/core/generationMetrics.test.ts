import { describe, expect, it } from "vitest";
import type { HarnessEvent } from "./types";
import {
  emitGenerationText,
  estimateOutputTokens,
  finishGenerationMetrics,
  generationRequestStarted,
  reportGenerationUsage,
  resetGenerationMetrics,
  withGenerationMetrics,
  emitAcpGenerationEvent,
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

describe("generation samples", () => {
  it("pairs reported tokens with the stream, excluding reasoning and trailing waits", () => {
    const { emit, sample } = setup();
    emit({ type: "reasoning.delta", text: "think" });
    emitGenerationText(emit, "first ", "m", 10_000);
    emitGenerationText(emit, "second", "m", 12_000);
    reportGenerationUsage(emit, {
      key: "m",
      outputTokens: 76,
      reasoningTokens: 16,
    });
    emit({ type: "message.completed" });
    expect(sample()).toMatchObject({
      outputTokens: 60,
      durationMs: 2_000,
      tokenSource: "provider",
    });
  });

  it("keeps the latest text segment and excludes tool/user waits", () => {
    const { emit, sample } = setup();
    emitGenerationText(emit, "abcd", undefined, 0);
    emitGenerationText(emit, "efgh", undefined, 1_000);
    emit({ type: "tool.started", callId: "t", title: "Tool" });
    expect(sample()?.durationMs).toBe(1_000);
    emit({ type: "tool.updated", callId: "t", status: "completed" });
    emitGenerationText(emit, "中文", undefined, 100_000);
    expect(sample()).toBeNull();
    emitGenerationText(emit, "回复", undefined, 102_000);
    reportGenerationUsage(emit, { outputTokens: 1_000 }); // includes tool parameters
    expect(sample()).toMatchObject({
      outputTokens: 4,
      durationMs: 2_000,
      tokenSource: "text-estimate",
    });
  });

  it("does not mix different message IDs or missing reasoning accounting", () => {
    const { emit, sample } = setup();
    emit({ type: "reasoning.delta", text: "hidden reasoning" });
    emitGenerationText(emit, "abcd", "m", 0);
    emitGenerationText(emit, "efgh", "m", 1_000);
    reportGenerationUsage(emit, { key: "other", outputTokens: 500 });
    expect(sample()?.tokenSource).toBe("text-estimate");
    reportGenerationUsage(emit, { key: "m", outputTokens: 500 });
    expect(sample()?.tokenSource).toBe("text-estimate");
  });

  it.each([0, 50, 99])(
    "rejects undersampled/buffered durations (%i ms)",
    (duration) => {
      const { emit, sample } = setup();
      emitGenerationText(emit, "a", undefined, 0);
      emitGenerationText(emit, "b", undefined, duration);
      finishGenerationMetrics(emit);
      expect(sample()).toBeNull();
    },
  );

  it("clears a previous sample when the latest segment is only one chunk", () => {
    const { emit, sample } = setup();
    emitGenerationText(emit, "a", "first", 0);
    emitGenerationText(emit, "b", "first", 1_000);
    emit({ type: "message.completed" });
    emitGenerationText(emit, "single", "last", 10_000);
    finishGenerationMetrics(emit);
    expect(sample()).toBeNull();
  });

  it("request boundaries permit new usage without reusing the previous segment", () => {
    const { emit, sample } = setup();
    emitGenerationText(emit, "abcd", "a", 0);
    emitGenerationText(emit, "efgh", "a", 1_000);
    reportGenerationUsage(emit, { outputTokens: 10 });
    generationRequestStarted(emit);
    reportGenerationUsage(emit, { outputTokens: 900 });
    expect(sample()?.outputTokens).toBe(10);
    emitGenerationText(emit, "ijkl", "b", 50_000);
    emitGenerationText(emit, "mnop", "b", 52_000);
    reportGenerationUsage(emit, { outputTokens: 20 });
    expect(sample()).toMatchObject({ outputTokens: 20, durationMs: 2_000 });
  });

  it("rejects snapshots and ignores child steps", () => {
    const { emit, sample } = setup();
    emitGenerationText(emit, "abcd", "m", 0);
    emitGenerationText(emit, "efgh", "m", 1_000);
    emit({
      type: "agent.step",
      callId: "child",
      stepId: "s",
      kind: "message",
      text: "child",
    });
    emit({ type: "message.completed" });
    expect(sample()?.outputTokens).toBe(2);
    emit({ type: "message.delta", text: "snapshot suffix" });
    expect(sample()).toBeNull();
  });

  it("resets on cancel/error and ignores observations after the send finishes", () => {
    const { emit, sample } = setup();
    emitGenerationText(emit, "a", undefined, 0);
    emitGenerationText(emit, "b", undefined, 1_000);
    resetGenerationMetrics(emit);
    finishGenerationMetrics(emit);
    emitGenerationText(emit, "late", undefined, 3_000);
    reportGenerationUsage(emit, { outputTokens: 300 });
    expect(sample()).toBeNull();
  });

  it("distinguishes ACP chunks from whole-message snapshots", () => {
    const { emit, sample } = setup();
    const params = { update: { sessionUpdate: "agent_message_chunk" } };
    emitAcpGenerationEvent(
      emit,
      { type: "message.delta", text: "你好" },
      params,
      0,
    );
    emitAcpGenerationEvent(
      emit,
      { type: "message.delta", text: "世界" },
      params,
      1_000,
    );
    emit({ type: "message.completed" });
    expect(sample()?.outputTokens).toBe(4);
    emitAcpGenerationEvent(
      emit,
      { type: "message.delta", text: "你好世界" },
      { update: { sessionUpdate: "agent_message" } },
      5_000,
    );
    expect(sample()).toBeNull();
  });
});

describe("text-heuristic-v1", () => {
  it.each([
    ["", 0],
    ["abcdefgh", 2],
    ["你好世界", 4],
    ["日本語かな한글", 7],
    ["😀", 1],
    ["你好abcd😀", 4],
  ])("estimates %j", (text, expected) => {
    expect(estimateOutputTokens(text)).toBe(expected);
  });
  it("is independent of chunking, including split surrogate pairs", () => {
    const text = '你好 const x = "😀";';
    const run = (chunks: string[]) => {
      const { emit, sample } = setup();
      chunks.forEach((chunk, i) =>
        emitGenerationText(emit, chunk, undefined, i * 200),
      );
      finishGenerationMetrics(emit);
      return sample()?.outputTokens;
    };
    expect(run(text.split(""))).toBe(run([text.slice(0, 3), text.slice(3)]));
  });
});

it("does not measure another ACP session or let its snapshots clear the parent", () => {
  const { emit, sample } = setup();
  emitGenerationText(emit, "你好", undefined, 0);
  emitAcpGenerationEvent(
    emit,
    { type: "message.delta", text: "a whole foreign response" },
    { sessionId: "child", update: { sessionUpdate: "agent_message" } },
    100,
    "parent",
  );
  emitGenerationText(emit, "世界", undefined, 1_000);
  finishGenerationMetrics(emit);
  expect(sample()).toMatchObject({ outputTokens: 4, durationMs: 1_000 });
});

it("uses text estimation when upstream reports sparse zero or invalid output usage", () => {
  for (const outputTokens of [0, -1, Infinity, NaN]) {
    const { emit, sample } = setup();
    emitGenerationText(emit, "你好", undefined, 0);
    emitGenerationText(emit, "世界", undefined, 1_000);
    reportGenerationUsage(emit, { outputTokens });
    expect(sample()).toMatchObject({
      outputTokens: 4,
      tokenSource: "text-estimate",
    });
  }
});
