import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../core/types";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  request: vi.fn(),
  frames: [] as Array<(record: Record<string, unknown>) => void>,
  currentMachine: "local",
  owners: new Map<string, string>(),
  spawned: [] as Array<{ id: string; machine: string }>,
}));

vi.mock("../../core/child", () => ({
  childUsesSelectedMachine: (id: string) => !mocks.owners.has(id) || mocks.owners.get(id) === mocks.currentMachine,
  killChild: async () => undefined,
  resolveOmpBinary: async () => ({ path: "/fake/omp" }),
  resolvePiBinary: async () => ({ path: "/fake/pi" }),
  spawnChild: async (id: string) => { mocks.owners.set(id, mocks.currentMachine); mocks.spawned.push({ id, machine: mocks.currentMachine }); },
  unwatchChild: () => undefined,
  watchChild: () => undefined,
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
  },
}));

const { runPiTextPrompt, stopPiTextPrompt, warmupPiText, warmupOmpText, stopOmpTextPrompt } = await import("./piText");

async function waitFor(predicate: () => boolean, label: string) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

beforeEach(() => {
  mocks.close.mockReset();
  mocks.request.mockReset().mockResolvedValue({ data: {} });
  mocks.frames.length = 0;
  mocks.currentMachine = "local"; mocks.owners.clear(); mocks.spawned.length = 0;
});

afterEach(async () => {
  await stopPiTextPrompt();
  await stopOmpTextPrompt();
});

it.each(["pi", "omp"])("does not reuse a warm %s text process across machines with the same cwd", async provider => {
  const warmup = provider === "pi" ? warmupPiText : warmupOmpText;
  for (const machine of ["local", "wsl:Ubuntu", "wsl:Debian", "local"]) {
    mocks.currentMachine = machine;
    await warmup("/repo");
    const count = mocks.spawned.length;
    await warmup("/repo");
    expect(mocks.spawned).toHaveLength(count);
  }
  expect(mocks.spawned).toEqual(["local", "wsl:Ubuntu", "wsl:Debian", "local"].map(machine => ({ id: `monocode-${provider}-text`, machine })));
});

it("forwards Pi text and reasoning deltas to an isolated prompt", async () => {
  const events: HarnessEvent[] = [];
  const result = runPiTextPrompt({
    cwd: "/repo",
    model: "anthropic/claude-haiku",
    prompt: "question",
    onEvent: (event) => events.push(event),
  });

  await waitFor(
    () =>
      mocks.request.mock.calls.some(([request]) => request.type === "prompt"),
    "prompt",
  );
  const frame = mocks.frames[0]!;
  frame({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "Checking" },
  });
  frame({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Partial answer" },
  });
  frame({ type: "agent_settled" });

  await expect(result).resolves.toBe("Partial answer");
  expect(events).toEqual([
    { type: "reasoning.delta", text: "Checking" },
    { type: "message.delta", text: "Partial answer" },
  ]);
});

it("keeps collecting after an intermediate Pi agent_end", async () => {
  let finished = false;
  const result = runPiTextPrompt({ cwd: "/repo", model: "anthropic/claude-haiku",
    prompt: "question", timeoutMs: 1000,
  }).then(value => { finished = true; return value; });
  await waitFor(() => mocks.request.mock.calls.some(([request]) => request.type === "prompt"), "prompt");
  const frame = mocks.frames[0]!;
  frame({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "First" } });
  frame({ type: "agent_end", willRetry: false });
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    frame({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " answer" } });
    frame({ type: "agent_settled" });
    await expect(result).resolves.toBe("First answer");
  } finally {
    frame({ type: "agent_settled" });
    await result;
  }
});
