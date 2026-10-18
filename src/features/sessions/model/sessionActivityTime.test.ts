import { describe, expect, it } from "vitest";
import { sessionMessageActivityAt, sessionRecencyAt } from "./sessionActivity";
import type { Block } from "./session";

const blocks: Block[] = [
  { id: "u", role: "user", text: "Start", startedAt: 100, durationMs: 900 },
  { id: "a", role: "assistant", text: "Answer", sentAt: 300 },
  { id: "followup", role: "user", text: "Correction", sentAt: 400 },
  { id: "a2", role: "assistant", text: "Final answer", sentAt: 600 },
  { id: "tool", role: "tool", text: "Output", startedAt: 700, durationMs: 500 },
  { id: "reasoning", role: "reasoning", text: "Thought", startedAt: 800 },
  { id: "system", role: "system", text: "Saved", startedAt: 900 },
  { id: "draft", role: "user", text: "Unsent", draft: true, startedAt: 950 },
  {
    id: "internal",
    role: "user",
    text: "Continue",
    internal: true,
    startedAt: 980,
  },
];

describe("conversation message times", () => {
  it("holds a running conversation at the last submitted user message", () => {
    expect(sessionMessageActivityAt({ blocks, busy: true })).toBe(400);
    expect(
      sessionMessageActivityAt({
        blocks: [
          ...blocks,
          { id: "next", role: "user", text: "Again", startedAt: 1_000 },
        ],
        busy: true,
      }),
    ).toBe(1_000);
  });

  it("uses the last AI reply when complete, excluding tools, thoughts and saves", () => {
    expect(sessionMessageActivityAt({ blocks, busy: false })).toBe(600);
    expect(sessionMessageActivityAt({ blocks, busy: true }, false)).toBe(600);
  });

  it("accepts imported assistant timestamps and uses a user send before any reply", () => {
    expect(
      sessionMessageActivityAt({
        blocks: [
          {
            id: "a",
            role: "assistant",
            text: "Imported",
            startedAt: 200,
            durationMs: 50,
          },
        ],
        busy: false,
      }),
    ).toBe(250);
    expect(
      sessionMessageActivityAt({ blocks: blocks.slice(0, 1), busy: false }),
    ).toBe(100);
  });

  it("uses an update-time fallback for legacy messages without timestamps", () => {
    expect(
      sessionMessageActivityAt({
        blocks: [{ id: "a", role: "assistant", text: "Legacy" }],
        busy: false,
      }),
    ).toBeUndefined();
    expect(sessionRecencyAt({ updatedAt: 1_000 })).toBe(1_000);
    expect(sessionRecencyAt({ updatedAt: 1_000, activityAt: 600 })).toBe(600);
    expect(sessionRecencyAt({ updatedAt: 1_000, activityAt: NaN })).toBe(1_000);
    expect(
      sessionRecencyAt({
        updatedAt: 1_000,
        status: "running",
        lastUserMessageAt: 400,
      }),
    ).toBe(400);
  });
});
