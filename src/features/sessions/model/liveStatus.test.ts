import { describe, expect, it } from "vitest";
import { LIVE_VERBS, liveStatus, liveVerb } from "./liveStatus";
import type { Block } from "../../../contracts/session";

const user: Block = { id: "u1", role: "user", text: "fix it", startedAt: 0 };

function thought(patch: Partial<Block> = {}): Block {
  return { id: "r1", role: "reasoning", text: "hmm", startedAt: 1_000, ...patch };
}

function command(status: string): Block {
  return {
    id: "t1",
    role: "tool",
    text: "Ran ls",
    tool: { kind: "execute", title: "ls", status },
  };
}

describe("liveStatus", () => {
  it("says what the turn is waiting on before anything else", () => {
    const status = liveStatus({
      turn: [user, thought({ streaming: true })],
      now: 5_000,
      waiting: "answers",
      startedAt: 0,
      seed: "u1",
    });
    expect(status.phase).toBe("waiting");
    expect(status.label).toEqual({ key: "Waiting for answers" });
    expect(status.elapsed).toBe("4s");
    expect(status.showClock).toBe(false);
  });

  it("times the current thought rather than the whole turn", () => {
    const at = (now: number) =>
      liveStatus({
        turn: [user, thought({ streaming: true })],
        now,
        startedAt: 0,
        seed: "u1",
      });
    expect(at(5_000).label).toEqual({ key: "Thinking…" });
    expect(at(5_000).elapsed).toBe("4s");
    expect(at(5_000).clock).toBe("thinking");
    expect(at(15_000).label).toEqual({ key: "Still thinking…" });
    expect(at(30_000).label).toEqual({ key: "Thinking more…" });
    expect(at(62_000).label).toEqual({ key: "Almost done thinking…" });
    expect(at(62_000).elapsed).toBe("1m 1s");
  });

  it("keeps the current response clock after a thought ends and starts a separate tool clock", () => {
    const earlier = thought({ id: "r0", durationMs: 3_000 });
    const latest = thought({ durationMs: 6_000 });
    const afterThought = liveStatus({
      turn: [user, earlier, latest],
      now: 8_000,
      startedAt: 0,
      seed: "u1",
    });
    expect(afterThought.phase).toBe("working");
    expect(afterThought.elapsed).toBe("7s");
    expect(afterThought.clock).toBe("round");

    const prose: Block = { id: "a1", role: "assistant", text: "Now fixing it" };
    const tool = liveStatus({
      turn: [user, latest, prose, { ...command("in_progress"), startedAt: 7_000 }],
      now: 9_000,
      startedAt: 0,
      seed: "u1",
    });
    expect(tool.phase).toBe("tool");
    expect(tool.elapsed).toBe("2s");
    expect(tool.clock).toBe("tool");
  });

  it("holds a filler verb from a tool call until the next model output", () => {
    const running = liveStatus({
      turn: [user, command("in_progress")],
      now: 2_000,
      seed: "u1",
    });
    expect(LIVE_VERBS).toContain((running.label as { key: string }).key);
    const done = liveStatus({
      turn: [user, command("completed")],
      now: 2_000,
      seed: "u1",
    });
    expect(done.label).toEqual(running.label);
    const status: Block = { id: "status", role: "system", text: "Reviewing" };
    expect(liveStatus({ turn: [user, command("completed"), status], now: 2_000, seed: "u1" }).label)
      .toEqual(running.label);
    const next = liveStatus({
      turn: [user, command("completed"), thought({ startedAt: 3_000 })],
      now: 4_000,
      seed: "u1",
    });
    expect(next.phase).toBe("working");
    expect(next.label).toEqual({ key: "Thinking…" });
  });

  it("keeps the clock when working and counts background tasks", () => {
    const status = liveStatus({
      turn: [user],
      now: 25_000,
      startedAt: 0,
      background: 1,
      seed: "u1",
    });
    expect(status.elapsed).toBe("25s");
    expect(status.background).toBe(1);
  });

  it("omits the clock when no start time was recorded", () => {
    const status = liveStatus({ turn: [user], now: 25_000, seed: "u1" });
    expect(status.elapsed).toBeUndefined();
    expect(status.showClock).toBe(false);
  });

  it("times thinking and replies once they last, but not tools or user waits", () => {
    const input = { startedAt: 0, seed: "u1" };
    const thinking = [user, thought({ streaming: true })];
    expect(liveStatus({ ...input, turn: thinking, now: 2_000 }).showClock).toBe(false);
    expect(liveStatus({ ...input, turn: thinking, now: 3_000 }).showClock).toBe(true);
    expect(liveStatus({ ...input, turn: thinking, now: 30_000, waiting: "approval" }).showClock).toBe(false);
    const running = [user, { ...command("in_progress"), startedAt: 1_000 }];
    expect(liveStatus({ ...input, turn: running, now: 30_000 }).showClock).toBe(false);
    expect(liveStatus({ ...input, turn: [user], now: 30_000 }).showClock).toBe(true);
    expect(liveStatus({ ...input, turn: [user, thought({ durationMs: 3_000 })], now: 30_000 }).showClock).toBe(true);
    const reply: Block = { id: "a1", role: "assistant", text: "Answer", streaming: true, startedAt: 12_000 };
    expect(liveStatus({ ...input, turn: [user, reply], now: 15_000 })).toMatchObject({
      label: { key: "Responding…" }, showClock: true,
    });
    const warning: Block = {
      id: "warning", role: "system", notice: "warning", text: "Reconnecting... 5/5",
    };
    // Prose resumes in the same block, before the retained retry warning.
    expect(liveStatus({ ...input, turn: [user, reply, warning], now: 15_000 })).toMatchObject({
      label: { key: "Responding…" }, showClock: true,
    });
  });

  it("falls back to the response clock when a tool has no recorded start", () => {
    const status = liveStatus({
      turn: [user, command("in_progress")], now: 15_000, startedAt: 0, seed: "u1",
    });
    expect(status).toMatchObject({ phase: "tool", elapsed: "15s", clock: "round" });
  });

  it("starts each response from its first token and ignores later content timestamps", () => {
    const earlier: Block = { id: "a0", role: "assistant", text: "First reply", startedAt: 1_000, sentAt: 4_000 };
    const latest: Block = { id: "a1", role: "assistant", text: "Next reply", streaming: true, startedAt: 12_000, sentAt: 14_000 };
    const input = { now: 15_000, startedAt: 0, seed: "u1" };
    expect(liveStatus({ ...input, turn: [user, earlier, latest] })).toMatchObject({
      phase: "working", clock: "round", elapsed: "3s", clockStartedAt: 12_000,
    });
    expect(liveStatus({ ...input, turn: [user, earlier, { ...latest, sentAt: 15_000 }], waiting: "approval" })).toMatchObject({
      phase: "waiting", elapsed: "3s", clockStartedAt: 12_000,
    });
  });

  it("starts the next round after the last concurrent tool finishes", () => {
    const first = { ...command("completed"), id: "first", startedAt: 2_000, durationMs: 10_000 };
    const second = { ...command("completed"), id: "second", startedAt: 8_000, durationMs: 2_000 };
    const status: Block = { id: "status", role: "system", text: "Reviewing" };
    const input = { now: 15_000, startedAt: 0, seed: "u1" };
    const turn = [user, first, second, status];
    expect(liveStatus({ ...input, turn })).toMatchObject({
      clock: "round", elapsed: "3s", clockStartedAt: 12_000,
    });
    // A later update to an earlier call cannot reset a reply already in progress.
    const reply: Block = { id: "a1", role: "assistant", text: "Answer", startedAt: 13_000, sentAt: 14_000 };
    expect(liveStatus({ ...input, turn: [...turn, reply] })).toMatchObject({
      elapsed: "2s", clockStartedAt: 13_000,
    });
  });

  it("uses a follow-up's own send time for its first response round", () => {
    const followUp: Block = { id: "follow-up", role: "user", text: "Also check this", sentAt: 12_000 };
    expect(liveStatus({ turn: [followUp], now: 15_000, startedAt: 0, seed: followUp.id })).toMatchObject({
      clock: "round", elapsed: "3s", clockStartedAt: 12_000,
    });
  });

  it("times the latest active call and returns to an earlier concurrent call", () => {
    const first = { ...command("in_progress"), id: "first", startedAt: 2_000 };
    const second = { ...command("in_progress"), id: "second", startedAt: 8_000 };
    const input = { now: 10_000, startedAt: 0, seed: "u1" };
    expect(liveStatus({ ...input, turn: [user, first, second] }).elapsed).toBe("2s");
    expect(liveStatus({ ...input, turn: [user, first, { ...second, tool: { ...second.tool, status: "completed" } }] }).elapsed).toBe("8s");
  });

  it("keeps the current thought clock across status pings and resets on a new thought", () => {
    const status: Block = { id: "status", role: "system", text: "Reviewing" };
    const input = { now: 15_000, startedAt: 0, seed: "u1" };
    expect(liveStatus({ ...input, turn: [user, thought({ streaming: true }), status] }).elapsed).toBe("14s");
    expect(liveStatus({ ...input, turn: [user, thought({ durationMs: 4_000 }), thought({ id: "next", startedAt: 12_000, streaming: true })] }).elapsed).toBe("3s");
  });

  it.each([
    [60_000, "1m 0s"],
    [3_600_000, "1h 0m 0s"],
    [3_601_000, "1h 0m 1s"],
  ])("retains ticking seconds across minute/hour carries at %s", (now, elapsed) => {
    expect(liveStatus({ turn: [user], now: Number(now), startedAt: 0, seed: "u1" }).elapsed).toBe(elapsed);
  });
});

describe("liveVerb", () => {
  it("holds still within a phase and varies across phases", () => {
    expect(liveVerb("u1", 3)).toBe(liveVerb("u1", 3));
    const verbs = new Set(Array.from({ length: 12 }, (_, phase) => liveVerb("u1", phase)));
    expect(verbs.size).toBeGreaterThan(3);
    for (const verb of verbs) expect(LIVE_VERBS).toContain(verb);
  });
});

describe("liveStatus starting", () => {
  const at = (turn: Block[]) => liveStatus({ turn, now: 5_000, startedAt: 0, seed: "u1" }).starting;

  it("lasts until the agent's first output, ignoring empty placeholders", () => {
    expect(at([user])).toBe(true);
    expect(at([user, thought({ text: "", streaming: true })])).toBe(true);
    expect(at([user, { id: "a1", role: "assistant", text: "", streaming: true }])).toBe(true);
    expect(at([user, thought({ streaming: true })])).toBe(false);
    expect(at([user, command("in_progress")])).toBe(false);
    expect(at([user, { id: "a1", role: "assistant", text: "Done", streaming: true }])).toBe(false);
  });
});
