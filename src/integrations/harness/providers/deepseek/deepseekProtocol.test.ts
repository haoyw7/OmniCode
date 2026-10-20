import { describe, expect, it } from "vitest";
import {
  DeepseekEventMapper,
  deepseekModels,
  deepseekSelection,
  deepseekQuestions,
  deepseekContent,
} from "./deepseekProtocol";

describe("DeepSeek bridge projection", () => {
  it("shows native retry failures without ending the turn and deduplicates durable replay", () => {
    const mapper = new DeepseekEventMapper();
    const envelope = { kind: "durable", data: { seq: 1, type: "llm/retry", data: {
      retry: 1, maxRetries: 2, failure: { code: "TRANSPORT", message: "Connection reset" },
    } } };
    expect(mapper.events(envelope, "root")).toEqual([{
      type: "status", key: "deepseek-retry", notice: "warning",
      text: "Retrying (1/2)…\nConnection reset · TRANSPORT",
    }]);
    expect(mapper.events(envelope, "root")).toEqual([]);
    expect(mapper.events({ kind: "durable", data: { seq: 2, type: "llm/retry-started", data: {} } }, "root"))
      .toEqual([]);
    expect(mapper.events({ kind: "durable", data: { seq: 3, type: "assistant/message",
      data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "Recovered" }] } } } }, "root"))
      .toEqual([{ type: "message.delta", text: "Recovered" }]);
    expect(mapper.events({ ...envelope, sourceSessionId: "child", data: { ...envelope.data,
      data: { retry: 8, failure: { message: "Still offline" } } } }, "root")).toEqual([{
      type: "status", key: "deepseek-retry:child", notice: "warning",
      text: "Subagent · Retrying…\nStill offline",
    }]);
  });

  it("reconciles a committed tail and aggregates real request usage once per turn", () => {
    const mapper = new DeepseekEventMapper();
    const stream = (data: object) =>
      mapper.events({ kind: "assistant.stream", data }, "root");
    const durable = (seq: number, type: string, data: object) =>
      mapper.events({ kind: "durable", data: { seq, type, data } }, "root");
    durable(0, "turn/start", { turn: 1 });
    stream({ type: "start", attemptId: "first", turn: 1, step: 1 });
    stream({
      type: "chunk",
      attemptId: "first",
      index: 0,
      chunk: { type: "text-delta", text: "hello" },
    });
    const committed = {
      turn: 1,
      step: 1,
      message: { content: [{ type: "text", text: "hello world" }] },
      usage: { inputTokens: 10, outputTokens: 2 },
    };
    expect(durable(1, "assistant/message", committed)).toEqual([
      { type: "message.delta", text: " world" },
      { type: "turn.metrics", inputTokens: 10, outputTokens: 2 },
    ]);
    expect(durable(1, "assistant/message", committed)).toEqual([]);
    expect(
      durable(2, "assistant/message", {
        turn: 1,
        step: 2,
        message: { content: [] },
        usage: { inputTokens: 15, outputTokens: 3 },
      }),
    ).toEqual([{ type: "turn.metrics", inputTokens: 25, outputTokens: 5 }]);
  });

  it("scopes repeated tool IDs to their agents and preserves structured edit previews", () => {
    const mapper = new DeepseekEventMapper();
    const call = (sourceSessionId: string, path: string) =>
      mapper.events(
        {
          kind: "durable",
          sourceSessionId,
          data: {
            seq: 1,
            type: "tool/call",
            data: {
              callId: "same",
              name: "edit",
              arguments: JSON.stringify({ file_path: path }),
            },
          },
        },
        "root",
      );
    call("root", "root.ts");
    call("child", "child.ts");
    expect(mapper.tool("root", "same")?.preview?.path).toBe("root.ts");
    expect(mapper.tool("child", "same")?.preview?.path).toBe("child.ts");
    const result = mapper.events(
      {
        kind: "durable",
        sourceSessionId: "root",
        data: {
          seq: 2,
          type: "tool/result",
          data: {
            message: {
              toolCallId: "same",
              content: [{ type: "text", text: "edited" }],
            },
            meta: {
              diffs: [{ path: "root.ts", oldText: "old\n", newText: "new\n" }],
            },
          },
        },
      },
      "root",
    );
    expect(result[0]).toMatchObject({
      type: "tool.updated",
      callId: "root:same",
      status: "completed",
      preview: { path: "root.ts", additions: 1, deletions: 1 },
    });
    expect(
      mapper.events(
        {
          kind: "image",
          sourceSessionId: "child",
          data: { itemId: "image", data: "YWJj", name: "image.png" },
        },
        "root",
      )[0],
    ).toMatchObject({ agentCallId: "dsh-agent:child" });
  });
  it("preserves opaque routes, the provider default effort, and native question labels", () => {
    const models = deepseekModels([
      {
        id: "route/a",
        name: "A",
        models: [
          {
            id: "model:b",
            name: "Model",
            reasoning: { efforts: [{ id: "high", name: "High" }] },
          },
        ],
      },
    ]);
    expect(deepseekSelection(models[0].id, { reasoning_effort: "" })).toEqual({
      provider: "route/a",
      model: "model:b",
    });
    expect(models[0].settings?.[0].options[0].value).toBe("");
    expect(
      deepseekQuestions([
        {
          id: "q",
          question: "Choose",
          detail: "# Plan",
          intent: { kind: "plan-review", approve: "Run" },
          options: [{ label: "Run", description: "Native text" }],
        },
      ])[0],
    ).toMatchObject({
      detail: "# Plan",
      intent: { approve: "Run" },
      options: [{ id: "Run", label: "Run", description: "Native text" }],
    });
  });

  it("deduplicates transient chunks and committed snapshots and separates retries", () => {
    const mapper = new DeepseekEventMapper();
    const frame = (data: object) =>
      mapper.events(
        { kind: "assistant.stream", sourceSessionId: "root", data },
        "root",
      );
    frame({ type: "start", attemptId: "a", turn: 1, step: 1 });
    const chunk = {
      type: "chunk",
      attemptId: "a",
      index: 0,
      chunk: { type: "text-delta", text: "hello" },
    };
    expect(frame(chunk)).toEqual([{ type: "message.delta", text: "hello" }]);
    expect(frame(chunk)).toEqual([]);
    const commit = {
      kind: "durable",
      sourceSessionId: "root",
      data: {
        seq: 1,
        type: "assistant/message",
        data: {
          turn: 1,
          step: 1,
          message: { content: [{ type: "text", text: "hello" }] },
        },
      },
    };
    expect(mapper.events(commit, "root")).toEqual([]);
    expect(mapper.events(commit, "root")).toEqual([]);
    expect(
      frame({ type: "start", attemptId: "b", turn: 1, step: 1 }),
    ).toContainEqual({ type: "message.completed" });
    expect(frame({ ...chunk, attemptId: "b" })).toEqual([
      { type: "message.delta", text: "hello" },
    ]);
  });

  it("fails on missing stream chunks rather than silently dropping text", () => {
    const mapper = new DeepseekEventMapper();
    mapper.events(
      {
        kind: "assistant.stream",
        data: { type: "start", attemptId: "a", turn: 1, step: 1 },
      },
      "root",
    );
    expect(() =>
      mapper.events(
        {
          kind: "assistant.stream",
          data: {
            type: "chunk",
            attemptId: "a",
            index: 2,
            chunk: { type: "text-delta", text: "lost" },
          },
        },
        "root",
      ),
    ).toThrow("missing chunk");
  });

  it("keeps images and generic file references in an attachment-only turn", () => {
    expect(
      deepseekContent("", [
        {
          id: "f",
          name: "report.pdf",
          kind: "file",
          mimeType: "application/pdf",
          path: "/tmp/report.pdf",
          size: 1,
        },
        {
          id: "i",
          name: "image.png",
          kind: "image",
          mimeType: "image/png",
          data: "data:image/png;base64,YWJj",
          size: 3,
        },
      ]),
    ).toEqual([
      { type: "text", text: "[Attached file: report.pdf (/tmp/report.pdf)]" },
      { type: "image", mimeType: "image/png", data: "YWJj" },
    ]);
  });
});
