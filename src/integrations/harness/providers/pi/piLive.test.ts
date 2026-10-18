import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  request: vi.fn(),
  resolveBinary: vi.fn(),
  spawnChild: vi.fn(),
  killChild: vi.fn(),
  writeChild: vi.fn(),
  frames: [] as Array<(record: Record<string, unknown>) => void>,
}));

vi.mock("../../core/child", () => ({
  killChild: mocks.killChild,
  resolveOmpBinary: vi.fn(),
  resolvePiBinary: mocks.resolveBinary,
  spawnChild: mocks.spawnChild,
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
  writeChild: mocks.writeChild,
}));

vi.mock("./piClient", () => ({
  PiRpc: class {
    constructor(
      _sessionId: string,
      onFrame: (record: Record<string, unknown>) => void,
    ) {
      mocks.frames.push(onFrame);
    }

    request = mocks.request;
    close = mocks.close;
    pushLine = vi.fn();
    cancelRequest = vi.fn();
  },
}));

import { bindPiSession, compactPiContext, stopPiSession, sendPiTurn, cancelPiTurn, respondPiQuestion, steerPiTurn } from "./pi";
import type { HarnessEvent } from "../../core/types";
import { sendTurn as sendFamilyTurn } from "./piFamily";
import { PI_FLAVOR } from "./piFlavor";

describe("Pi live session", () => {
  beforeEach(() => {
    mocks.close.mockReset();
    mocks.request.mockReset();
    mocks.resolveBinary.mockReset();
    mocks.spawnChild.mockReset();
    mocks.killChild.mockReset();
    mocks.writeChild.mockReset().mockResolvedValue(undefined);
    mocks.frames.length = 0;
    mocks.resolveBinary.mockResolvedValue({ path: "/fake/pi" });
    mocks.spawnChild.mockResolvedValue(undefined);
    mocks.killChild.mockResolvedValue(undefined);
    mocks.request.mockImplementation(
      async (command: Record<string, unknown>) => {
        if (command.type === "get_state") {
          return {
            data: {
              sessionId: "pi_session",
              model: { contextWindow: 200_000 },
            },
          };
        }
        if (command.type === "compact") {
          return { data: { estimatedTokensAfter: 32_000 } };
        }
        return { data: {} };
      },
    );
  });

  it("measures a Pi assistant message independently of turn settlement", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendPiTurn({ sessionId: "pi-rate", cwd: "/repo", model: "pi:default", runtimeMode: "supervised", text: "Hello", onEvent: e => events.push(e) });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ type: "prompt" }), 15_000));
    let now = 1_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const frame = mocks.frames[0]!;
    try {
      frame({ type: "message_start", message: { role: "assistant" } });
      frame({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello " } });
      now = 3_000;
      frame({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "world" } });
      frame({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }], usage: { output: 20 } } });
      now = 200_000;
      frame({ type: "agent_settled" });
      await turn;
      const samples = events.filter(e => e.type === "turn.metrics" && e.generationSample !== undefined);
      expect(samples.at(-1)?.generationSample).toMatchObject({ outputTokens: 20, durationMs: 2_000, tokenSource: "provider" });
    } finally { clock.mockRestore(); await stopPiSession("pi-rate"); }
  });

  it("resumes imported files exactly and reloads their latest history between idle operations", async () => {
    const source = { provider: "pi" as const, providerSessionId: "pi_session", path: "/native/import.jsonl", revision: "1", blockIds: [], createdAt: 1, updatedAt: 2 };
    bindPiSession("pi-import", "pi_session", "/repo", undefined, source);
    const input = { sessionId: "pi-import", cwd: "/repo", model: "pi:default", runtimeMode: "supervised" as const, onEvent: vi.fn() };
    await compactPiContext(input);
    await compactPiContext(input);
    expect(mocks.spawnChild).toHaveBeenCalledTimes(2);
    for (const call of mocks.spawnChild.mock.calls) expect(call[2]).toContain(source.path);
    await stopPiSession("pi-import");
  });

  it("keeps ordinary Pi sessions live when native state exposes their session file", async () => {
    const request = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      const reply = await request(command);
      return command.type === "get_state" ? { data: { ...reply.data, sessionFile: "/ordinary/pi.jsonl" } } : reply;
    });
    const input = { sessionId: "pi-ordinary-file", cwd: "/repo", model: "pi:default", runtimeMode: "supervised" as const, onEvent: vi.fn() };
    await compactPiContext(input);
    await compactPiContext(input);
    expect(mocks.spawnChild).toHaveBeenCalledOnce();
    await stopPiSession("pi-ordinary-file");
  });

  it("fails an imported resume instead of falling back to an empty Pi session", async () => {
    bindPiSession("pi-import-failed", "expected", "/repo", undefined, { provider: "pi", providerSessionId: "expected", path: "/native/missing.jsonl", revision: "1", blockIds: [], createdAt: 1, updatedAt: 2 });
    await expect(compactPiContext({ sessionId: "pi-import-failed", cwd: "/repo", model: "pi:default", runtimeMode: "supervised", onEvent: vi.fn() })).rejects.toThrow("did not resume");
    expect(mocks.spawnChild).toHaveBeenCalledOnce();
    await stopPiSession("pi-import-failed");
  });

  it("publishes the resolved Pi default model for provider usage", async () => {
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.type === "get_state") return { data: {
        sessionId: "pi_default",
        model: { provider: "openai-codex", id: "gpt-5.4", contextWindow: 200_000 },
      } };
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-default", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", onEvent: event => events.push(event),
    });
    expect(events).toContainEqual({
      type: "session.configChanged", model: "pi:openai-codex/gpt-5.4",
    });
    await stopPiSession("pi-default");
  });

  it("does not publish an intermediate default when explicit model selection fails", async () => {
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.type === "get_state") return { data: {
        sessionId: "pi_explicit",
        model: { provider: "anthropic", id: "claude-sonnet-5", contextWindow: 200_000 },
      } };
      if (command.type === "set_model") throw new Error("Model unavailable");
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    await expect(compactPiContext({
      sessionId: "pi-explicit", cwd: "/repo", model: "pi:openai-codex/gpt-5.4",
      runtimeMode: "supervised", onEvent: event => events.push(event),
    })).rejects.toThrow("Model unavailable");
    expect(events.filter(event => event.type === "session.configChanged")).toEqual([]);
    expect(mocks.request).toHaveBeenCalledWith({ type: "set_model", provider: "openai-codex", modelId: "gpt-5.4" });
    await stopPiSession("pi-explicit");
  });

  it("uses the compact RPC command and publishes the post-compact estimate", async () => {
    const events: HarnessEvent[] = [];

    await compactPiContext({
      sessionId: "pi-compact",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });

    expect(mocks.request).toHaveBeenCalledWith(
      { type: "compact" },
      30 * 60_000,
    );
    expect(events).toContainEqual({
      type: "context",
      used: 32_000,
      window: 200_000,
    });
    await stopPiSession("pi-compact");
  });

  it("publishes readable Ponytail status and extension notifications", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-ansi",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    const frame = mocks.frames[0]!;
    frame({
      type: "extension_ui_request",
      id: "ponytail-status",
      method: "setStatus",
      statusKey: "ponytail",
      statusText:
        "\u001b[38;5;241m○\u001b[39m \u001b[38;5;244mponytail:\u001b[39m \u001b[38;5;188m⚡ FULL\u001b[0m",
    });
    frame({
      type: "extension_ui_request",
      id: "plugin-notify",
      method: "notify",
      message: "\u001b[32mPlugin ready\u001b[0m",
    });
    frame({
      type: "extension_ui_request",
      id: "empty-status",
      method: "setStatus",
      statusText: "\u001b[0m",
    });
    expect(events.filter((event) => event.type === "status")).toEqual([
      { type: "status", key: "ponytail", text: "○ ponytail: ⚡ FULL" },
      { type: "status", text: "Plugin ready" },
    ]);
    await stopPiSession("pi-ansi");
  });

  it("finishes a handled command without waiting for a nonexistent run", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (command) => command.type === "prompt"
      ? { data: { disposition: "handled" } }
      : original(command));
    const events: HarnessEvent[] = [];
    let finished = false;
    const turn = sendPiTurn({ sessionId: "pi-handled", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", text: "/noop", onEvent: event => events.push(event),
    }).then(() => { finished = true; });
    try {
      await vi.waitFor(() => expect(finished).toBe(true), { timeout: 250 });
      expect(events.filter(event => event.type === "message.completed")).toHaveLength(1);
    } finally {
      await cancelPiTurn("pi-handled");
      await turn;
      await stopPiSession("pi-handled");
    }
  });

  it("waits beyond agent_end for automatic continuation and agent_settled", async () => {
    const events: HarnessEvent[] = [];
    let finished = false;
    const turn = sendPiTurn({ sessionId: "pi-settled", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", text: "hello", onEvent: event => events.push(event),
    }).then(() => { finished = true; });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: "prompt" }), 15_000));
    const frame = mocks.frames[0]!;
    try {
      frame({ type: "agent_end", willRetry: false });
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(finished).toBe(false);
      frame({ type: "auto_retry_start", attempt: 1, maxAttempts: 3 });
      frame({ type: "auto_retry_end", success: true });
      frame({ type: "agent_settled" });
      await turn;
      expect(events.filter(event => event.type === "message.completed")).toHaveLength(1);
    } finally {
      await cancelPiTurn("pi-settled");
      await turn;
      await stopPiSession("pi-settled");
    }
  });

  it("returns a chosen Pi option without changing its original value", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({ sessionId: "pi-select", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", onEvent: event => events.push(event) });
    const option = "\u001b[32mSecond\u001b[0m";
    try {
      mocks.frames[0]!({ type: "extension_ui_request", id: "select", method: "select",
        title: "Choose", options: ["First", option] });
      const question = events.find(event => event.type === "question.asked");
      expect(question?.type).toBe("question.asked");
      if (question?.type !== "question.asked") throw new Error("Missing Pi question");
      expect(question.questions[0]?.options[1]?.label).toBe("Second");
      respondPiQuestion("pi-select", question.requestId,
        { kind: "answered", answers: { select: ["1"] } });
      await vi.waitFor(() => expect(mocks.writeChild).toHaveBeenCalledWith("pi-select",
        JSON.stringify({ type: "extension_ui_response", id: "select", value: option })));
    } finally { await stopPiSession("pi-select"); }
  });

  it.each(["", "  first\nsecond  "])("returns exact editor text %j", async value => {
    const events: HarnessEvent[] = [];
    await compactPiContext({ sessionId: "pi-editor", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", onEvent: event => events.push(event) });
    try {
      mocks.frames[0]!({ type: "extension_ui_request", id: "editor", method: "editor",
        title: "Edit", prefill: "  prefill\n  ", placeholder: "Hint" });
      const question = events.find(event => event.type === "question.asked");
      expect(question?.type).toBe("question.asked");
      if (question?.type !== "question.asked") throw new Error("Missing Pi editor");
      expect(question.questions[0]?.input).toMatchObject({ kind: "multiline",
        initialValue: "  prefill\n  ", placeholder: "Hint", preserveWhitespace: true });
      respondPiQuestion("pi-editor", question.requestId,
        { kind: "answered", answers: {}, custom: { editor: value } });
      await vi.waitFor(() => expect(mocks.writeChild).toHaveBeenCalledWith("pi-editor",
        JSON.stringify({ type: "extension_ui_response", id: "editor", value })));
    } finally { await stopPiSession("pi-editor"); }
  });

  it("expires a Pi interaction once and ignores a late user reply", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({ sessionId: "pi-expire", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", onEvent: event => events.push(event) });
    try {
      mocks.frames[0]!({ type: "extension_ui_request", id: "expires", method: "input",
        title: "Input", timeout: 10 });
      await vi.waitFor(() => expect(events.some(event => event.type === "question.resolved")).toBe(true),
        { timeout: 250 });
      const question = events.find(event => event.type === "question.asked");
      if (question?.type !== "question.asked") throw new Error("Missing timed question");
      expect(question.autoResolveAt).toBeTypeOf("number");
      respondPiQuestion("pi-expire", question.requestId,
        { kind: "answered", answers: {}, custom: { expires: "late" } });
      expect(mocks.writeChild).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mocks.writeChild.mock.calls[0]![1])).toMatchObject({ id: "expires", cancelled: true });
    } finally { await stopPiSession("pi-expire"); }
  });

  it("publishes active-model thinking choices and native changes", async () => {
    mocks.request.mockImplementation(async command => {
      if (command.type === "get_state") return { data: { sessionId: "pi-levels",
        model: { provider: "anthropic", id: "claude", contextWindow: 200_000 }, thinkingLevel: "off" } };
      if (command.type === "get_available_thinking_levels") return { data: { levels: ["off", "high"] } };
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    try {
      await compactPiContext({ sessionId: "pi-levels", cwd: "/repo", model: "pi:default",
        runtimeMode: "supervised", onEvent: event => events.push(event) });
      expect(events).toContainEqual(expect.objectContaining({ type: "session.configChanged",
        modelSettingOptions: { model: "pi:anthropic/claude", settings: [expect.objectContaining({
          id: "thinking", options: [{ value: "off", label: "Off" }, { value: "high", label: "High" }],
        })] } }));
      mocks.frames[0]!({ type: "thinking_level_changed", level: "high" });
      expect(events).toContainEqual(expect.objectContaining({ type: "session.configChanged",
        modelSettings: { thinking: "high" } }));
    } finally { await stopPiSession("pi-levels"); }
  });

  it.each([true, false])("accepts native thinking clamping without publishing the requested level (event=%s)", async emitChange => {
    let thinking = "off";
    mocks.request.mockImplementation(async command => {
      if (command.type === "get_state") return { data: { sessionId: "pi-clamped",
        model: { provider: "deepseek", id: "flash" }, thinkingLevel: thinking } };
      if (command.type === "get_available_thinking_levels") return { data: { levels: ["off", "high"] } };
      if (command.type === "set_thinking_level") {
        thinking = "high";
        if (emitChange) mocks.frames[0]!({ type: "thinking_level_changed", level: thinking });
      }
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    try {
      await compactPiContext({ sessionId: "pi-clamped", cwd: "/repo", model: "pi:default",
        runtimeMode: "supervised", modelSettings: { thinking: "medium" }, onEvent: event => events.push(event) });
      expect(mocks.request).toHaveBeenCalledWith({ type: "set_thinking_level", level: "medium" });
      expect(mocks.request).toHaveBeenCalledWith({ type: "compact" }, 30 * 60_000);
      expect(events).toContainEqual(expect.objectContaining({ type: "session.configChanged",
        modelSettings: { thinking: "high" } }));
      expect(events.some(event => event.type === "session.configChanged" && event.modelSettings?.thinking === "medium")).toBe(false);
    } finally { await stopPiSession("pi-clamped"); }
  });

  it("reads thinking state after switching to an off-only model", async () => {
    let modelId = "reasoning";
    mocks.request.mockImplementation(async command => {
      if (command.type === "get_state") return { data: { sessionId: "pi-switch-thinking",
        model: { provider: "test", id: modelId }, thinkingLevel: modelId === "reasoning" ? "medium" : "off" } };
      if (command.type === "set_model") modelId = command.modelId;
      if (command.type === "get_available_thinking_levels") return { data: { levels: modelId === "reasoning" ? ["off", "medium"] : ["off"] } };
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    const input = { sessionId: "pi-switch-thinking", cwd: "/repo", runtimeMode: "supervised" as const,
      modelSettings: { thinking: "medium" }, onEvent: (event: HarnessEvent) => events.push(event) };
    try {
      await compactPiContext({ ...input, model: "pi:test/reasoning" });
      events.length = 0;
      await compactPiContext({ ...input, model: "pi:test/plain" });
      expect(events).toContainEqual(expect.objectContaining({ type: "session.configChanged",
        modelSettings: { thinking: "off" }, modelSettingOptions: { model: "pi:test/plain",
          settings: [expect.objectContaining({ value: "off", options: [{ value: "off", label: "Off" }] })] } }));
      expect(events.some(event => event.type === "session.configChanged" && event.modelSettings?.thinking === "medium")).toBe(false);
    } finally { await stopPiSession("pi-switch-thinking"); }
  });

  it("keeps native thinking when the capability query is unavailable", async () => {
    mocks.request.mockImplementation(async command => {
      if (command.type === "get_state") return { data: { sessionId: "pi-no-levels",
        model: { provider: "test", id: "model" }, thinkingLevel: "high" } };
      if (command.type === "get_available_thinking_levels") throw new Error("Unknown command");
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    try {
      await compactPiContext({ sessionId: "pi-no-levels", cwd: "/repo", model: "pi:default",
        runtimeMode: "supervised", modelSettings: { thinking: "medium" }, onEvent: event => events.push(event) });
      expect(mocks.request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "set_thinking_level" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "session.configChanged",
        modelSettings: { thinking: "high" }, modelSettingOptions: { model: "pi:test/model", settings: [] } }));
    } finally { await stopPiSession("pi-no-levels"); }
  });

  it("does not claim a rejected thinking setting was applied", async () => {
    mocks.request.mockImplementation(async command => {
      if (command.type === "get_state") return { data: { sessionId: "pi-rejected",
        model: { provider: "anthropic", id: "claude" }, thinkingLevel: "off" } };
      if (command.type === "get_available_thinking_levels") return { data: { levels: ["off", "high"] } };
      if (command.type === "set_thinking_level") throw new Error("Thinking change rejected");
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    await expect(compactPiContext({ sessionId: "pi-rejected", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", modelSettings: { thinking: "high" }, onEvent: event => events.push(event),
    })).rejects.toThrow("Thinking change rejected");
    expect(events.some(event => event.type === "session.configChanged" && event.modelSettings?.thinking === "high")).toBe(false);
    await stopPiSession("pi-rejected");
  });

  it("does not let a reply to a stopped process answer its replacement", async () => {
    const events: HarnessEvent[] = [];
    const open = () => compactPiContext({ sessionId: "pi-replace", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", onEvent: event => events.push(event) });
    await open();
    mocks.frames[0]!({ type: "extension_ui_request", id: "old", method: "input", title: "Old" });
    const old = events.find(event => event.type === "question.asked");
    if (old?.type !== "question.asked") throw new Error("Missing old question");
    await stopPiSession("pi-replace");
    await open();
    mocks.frames[1]!({ type: "extension_ui_request", id: "new", method: "input", title: "New" });
    const next = events.filter(event => event.type === "question.asked").at(-1);
    if (next?.type !== "question.asked") throw new Error("Missing replacement question");
    try {
      respondPiQuestion("pi-replace", old.requestId, { kind: "answered", answers: {}, custom: { old: "stale" } });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(events.some(event => event.type === "question.resolved" && event.requestId === next.requestId)).toBe(false);
      respondPiQuestion("pi-replace", next.requestId, { kind: "answered", answers: {}, custom: { new: "fresh" } });
      await vi.waitFor(() => expect(mocks.writeChild).toHaveBeenCalledWith("pi-replace",
        JSON.stringify({ type: "extension_ui_response", id: "new", value: "fresh" })));
    } finally { await stopPiSession("pi-replace"); }
  });

  it("routes a busy Pi slash command through prompt without ending the running turn", async () => {
    const events: HarnessEvent[] = [];
    let finished = false;
    const turn = sendPiTurn({ sessionId: "pi-command-steer", cwd: "/repo", model: "pi:default",
      text: "hello", runtimeMode: "supervised", onEvent: event => events.push(event) }).then(() => { finished = true; });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ type: "prompt" }), 15_000));
    try {
      await steerPiTurn({ sessionId: "pi-command-steer", cwd: "/repo", model: "pi:default", text: "/audit @raw" });
      expect(mocks.request).toHaveBeenCalledWith({ type: "prompt", message: "/audit @raw", streamingBehavior: "steer" }, 30 * 60_000);
      expect(finished).toBe(false);
    } finally { mocks.frames[0]!({ type: "agent_settled" }); await turn; await stopPiSession("pi-command-steer"); }
  });

  it.each([false, true])("waits for image saving and discards late cancelled output (cancel=%s)", async cancel => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    const events: HarnessEvent[] = [];
    const discard = vi.fn(async () => {});
    let save!: (value: { event: Extract<HarnessEvent, { type: "image.generated"; path: string }>; discard: () => Promise<void> }) => void;
    const materialize = vi.fn(() => new Promise<{ event: Extract<HarnessEvent, { type: "image.generated"; path: string }>; discard: () => Promise<void> }>(resolve => { save = resolve; }));
    let finished = false;
    const turn = sendFamilyTurn(PI_FLAVOR, { sessionId: "pi-image", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", text: "paint", onEvent: event => events.push(event) }, materialize)
      .then(() => { finished = true; });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ type: "prompt" }), 15_000));
    const frame = mocks.frames[0]!;
    const result = { type: "tool_execution_end", toolCallId: "paint",
      result: { content: [{ type: "image", mimeType: "image/png", data: png }] } };
    frame(result); frame(result); frame({ type: "agent_settled" });
    await vi.waitFor(() => expect(materialize).toHaveBeenCalledTimes(1));
    expect(finished).toBe(false);
    if (cancel) await cancelPiTurn("pi-image");
    save({ event: { type: "image.generated", itemId: "pi:paint:image:0", name: "saved.png",
      path: "/saved.png", mimeType: "image/png", size: 70 }, discard });
    await turn;
    if (cancel) await vi.waitFor(() => expect(discard).toHaveBeenCalledOnce());
    expect(events.filter(event => event.type === "image.generated")).toHaveLength(cancel ? 0 : 1);
    await stopPiSession("pi-image");
  });

  it("publishes animated extension status as one keyed slot", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-caveman",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    const frame = mocks.frames[0]!;
    for (const [id, statusText] of [
      ["frame-1", "⠋ \u001b[2mcaveman level: \u001b[0mULTRA"],
      ["frame-2", "⠙ \u001b[2mcaveman level: \u001b[0mULTRA"],
      ["clear", ""],
    ]) {
      frame({
        type: "extension_ui_request",
        id,
        method: "setStatus",
        statusKey: "caveman",
        statusText,
      });
    }
    expect(events.filter((event) => event.type === "status")).toEqual([
      { type: "status", key: "caveman", text: "⠋ caveman level: ULTRA" },
      { type: "status", key: "caveman", text: "⠙ caveman level: ULTRA" },
      { type: "status", key: "caveman", text: "" },
    ]);
    await stopPiSession("pi-caveman");
  });
});
