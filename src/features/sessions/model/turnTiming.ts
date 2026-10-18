import type { Block } from "./session";

/** Follow-ups share the active run's clock while retaining their own send time. */
export function userTurnStartTimes(blocks: readonly Block[]): Map<string, number> {
  const starts = new Map<string, number>();
  let startedAt: number | undefined;
  for (const block of blocks) {
    if (block.role === "handoff") startedAt = undefined;
    if (block.role !== "user") continue;
    if (block.startedAt != null || block.sentAt == null || block.draft) {
      startedAt = block.draft ? undefined : block.startedAt;
    }
    if (startedAt != null) starts.set(block.id, startedAt);
    // A completed run cannot supply a clock for a later follow-up.
    if (block.durationMs != null) startedAt = undefined;
  }
  return starts;
}
