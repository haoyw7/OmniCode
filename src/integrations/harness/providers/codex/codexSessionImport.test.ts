import { describe, expect, it } from "vitest";
import { parseCodexSession } from "./codexSessionImport";
import type { NativeSessionFile } from "../../core/nativeSessions";

const file: NativeSessionFile = {
  provider: "codex",
  providerSessionId: "thread-id",
  cwd: "/repo",
  path: "/codex/session.jsonl",
  revision: "1",
  modifiedAt: 10,
};
const header = {
  type: "session_meta",
  payload: { id: "thread-id", cwd: "/repo", timestamp: "2026-10-01T00:00:00Z" },
};
const lines = (...records: unknown[]) =>
  [header, ...records].map((record) => JSON.stringify(record)).join("\n") +
  "\n";

describe("Codex session import", () => {
  it("uses native user messages once, ignores instructions, and preserves tools/model/reasoning", () => {
    const source = lines(
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "private instructions" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-10-05T10:00:00Z",
        payload: { type: "user_message", message: "hello" },
      },
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1" },
      },
      { type: "turn_context", payload: { model: "gpt-5.4", effort: "high" } },
      {
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "thinking" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-1",
          name: "shell",
          arguments: "{}",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "done",
        },
      },
      {
        type: "response_item",
        timestamp: "2026-10-05T10:00:10Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "answer" }],
        },
      },
      {
        type: "event_msg",
        payload: { type: "agent_message", message: "answer" },
      },
    );
    const result = parseCodexSession(source, file);
    expect(result.blocks.map((block) => block.text)).toEqual([
      "hello",
      "thinking",
      "{}",
      "answer",
    ]);
    expect(result.blocks[0].providerTurnId).toBe("turn-1");
    expect(result.blocks[0].startedAt).toBe(Date.parse("2026-10-05T10:00:00Z"));
    expect(result.blocks[3].startedAt).toBe(Date.parse("2026-10-05T10:00:10Z"));
    expect(result.blocks[2].tool?.detail).toBe("done");
    expect(result.model).toBe("codex:gpt-5.4");
    expect(result.modelSettings).toEqual({ reasoningEffort: "high" });
  });
  it("supports response-only history and omits an incomplete last line", () => {
    const result = parseCodexSession(
      lines({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "old" }],
        },
      }) + '{"type":',
      file,
    );
    expect(result.blocks[0].text).toBe("old");
  });
  it("rejects corruption and changed identity instead of replacing history", () => {
    expect(() => parseCodexSession(lines() + "broken\n", file)).toThrow(
      "line 2",
    );
    expect(() =>
      parseCodexSession(lines(), { ...file, providerSessionId: "other" }),
    ).toThrow("identity");
  });
});
