import type { Block } from "./session";
import {
  groupTurnItems,
  groupTurns,
  type TurnItem,
} from "./transcriptActivity";

/** Reuse unchanged history while immutable updates replace the live blocks. */
export class TranscriptTurnCache {
  private blocks: Block[] | undefined;
  private managed = false;
  private turns: Block[][] = [];
  private items = new WeakMap<Block[], Map<boolean, TurnItem[]>>();

  group(blocks: Block[], managed = false): Block[][] {
    if (this.blocks === blocks && this.managed === managed) return this.turns;
    const previous = new Map(this.turns.map((turn) => [turn[0].id, turn]));
    const next = groupTurns(blocks, managed).map((turn) => {
      const before = previous.get(turn[0].id);
      return before &&
        before.length === turn.length &&
        turn.every((block, index) => block === before[index])
        ? before
        : turn;
    });
    this.blocks = blocks;
    this.managed = managed;
    if (
      next.length !== this.turns.length ||
      next.some((turn, index) => turn !== this.turns[index])
    )
      this.turns = next;
    return this.turns;
  }

  turnItems(turn: Block[], settled: boolean): TurnItem[] {
    let variants = this.items.get(turn);
    const previous = variants?.get(settled);
    if (previous) return previous;
    const items = groupTurnItems(
      turn.filter((block) => !block.orchestration),
      { settled },
    );
    if (!variants) {
      variants = new Map();
      this.items.set(turn, variants);
    }
    variants.set(settled, items);
    return items;
  }
}
