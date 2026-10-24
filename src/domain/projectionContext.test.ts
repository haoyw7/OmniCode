import { afterEach, expect, it, vi } from "vitest";
import { createSessionProjection } from "./apply";
import type { Session } from "../contracts/session";

afterEach(() => vi.restoreAllMocks());

it("replays the same transcript using only its explicit clock, identifiers and model names", () => {
  const initial = {
    id: "session", harness: "codex", cwd: "/repo", model: "codex:example",
    title: "Conversation", blocks: [], busy: false,
  } as unknown as Session;
  const original = structuredClone(initial);
  const unexpected = () => { throw new Error("Projection read a runtime global"); };
  vi.spyOn(Date, "now").mockImplementation(unexpected);
  vi.spyOn(crypto, "randomUUID").mockImplementation(unexpected);
  function replay() {
    let nextId = 0, now = 100;
    const projection = createSessionProjection({
      now: () => now,
      createId: () => `block-${++nextId}`,
      modelName: () => "Recorded model",
    });
    let session = projection.appendUser(initial, "Read the code");
    now = 125;
    session = projection.applyHarnessEvents(session, [
      { type: "reasoning.delta", text: "Inspecting" },
      { type: "reasoning.completed" },
      { type: "tool.started", callId: "read", title: "Read src/app.ts", kind: "read" },
    ]);
    now = 180;
    session = projection.applyHarnessEvent(session, { type: "tool.updated", callId: "read", title: "Read src/app.ts", kind: "read", status: "completed" });
    session = projection.applyHarnessEvent(session, { type: "message.delta", text: "Done" });
    now = 200;
    return projection.stopStreaming(session);
  }
  const first = replay();
  expect(replay()).toEqual(first);
  expect(first.blocks[0]).toMatchObject({ id: "block-1", durationMs: 100, turnModel: { name: "Recorded model" } });
  expect(initial).toEqual(original);
});

