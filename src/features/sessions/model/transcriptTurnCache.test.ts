import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { groupTurns } from "./transcriptActivity";
import { TranscriptTurnCache } from "./transcriptTurnCache";

function conversation(): Block[] {
  return Array.from({ length: 20 }, (_, index): Block[] => [
    { id: `u${index}`, role: "user", text: `Question ${index}` },
    { id: `a${index}`, role: "assistant", text: `Answer ${index}` },
  ]).flat();
}

describe("transcript turn cache", () => {
  it("reuses settled history as the latest reply streams", () => {
    const cache = new TranscriptTurnCache();
    const blocks = conversation();
    const before = cache.group(blocks);
    const previousItems = before.map((turn, index) =>
      cache.turnItems(turn, index < before.length - 1),
    );
    const updated = blocks.slice();
    updated[updated.length - 1] = {
      ...updated[updated.length - 1],
      text: "More output",
    };
    const after = cache.group(updated);
    for (let index = 0; index < 19; index++) {
      expect(after[index]).toBe(before[index]);
      expect(cache.turnItems(after[index], true)).toBe(previousItems[index]);
    }
    expect(after[19]).not.toBe(before[19]);
    expect(cache.turnItems(after[19], false)).not.toBe(previousItems[19]);
  });

  it("updates an edited historical turn without changing its neighbors", () => {
    const cache = new TranscriptTurnCache();
    const blocks = conversation();
    const before = cache.group(blocks);
    const edited = blocks.slice();
    edited[3] = { ...edited[3], text: "Corrected answer" };
    const after = cache.group(edited);
    expect(after[1]).not.toBe(before[1]);
    expect(cache.turnItems(after[1], true)).toContainEqual({
      type: "block",
      block: edited[3],
    });
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it("keeps live and settled folding distinct", () => {
    const cache = new TranscriptTurnCache();
    const turn: Block[] = [
      { id: "u", role: "user", text: "Check this" },
      {
        id: "interjection",
        role: "system",
        text: "Review note",
        interjection: { source: "omp-advisor", severity: "concern" },
      },
    ];
    const live = cache.turnItems(turn, false);
    const settled = cache.turnItems(turn, true);
    expect(live[1].type).toBe("block");
    expect(settled[1].type).toBe("activity");
    expect(cache.turnItems(turn, false)).toBe(live);
    expect(cache.turnItems(turn, true)).toBe(settled);
  });

  it("preserves handoffs, managed turns and rewinds", () => {
    const cache = new TranscriptTurnCache();
    const blocks: Block[] = [
      ...conversation().slice(0, 4),
      { id: "handoff", role: "handoff", text: "Switch provider" },
      { id: "internal", role: "user", text: "Continue", internal: true },
      { id: "reply", role: "assistant", text: "Done" },
    ];
    expect(cache.group(blocks)).toEqual(groupTurns(blocks));
    expect(cache.group(blocks, true)).toEqual(groupTurns(blocks, true));
    expect(cache.group(blocks)).toEqual(groupTurns(blocks));
    expect(cache.group(blocks.slice(0, 2))).toEqual(
      groupTurns(blocks.slice(0, 2)),
    );
  });

  it("reuses groups for local renders and equivalent immutable arrays", () => {
    const cache = new TranscriptTurnCache();
    const blocks = conversation();
    const before = cache.group(blocks);
    expect(cache.group(blocks)).toBe(before);
    expect(cache.group(blocks.slice())).toBe(before);
  });
});
