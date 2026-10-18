import { useSyncExternalStore } from "react";
import type { Block, PlanBlockMeta } from "./session";
import { legacyTaskListFromText } from "./taskList";

/** The message sent when the user approves a plan from its decision panel. */
export const IMPLEMENT_PLAN_PROMPT = "Implement the plan.";

export function planBuildable(
  text: string,
  plan: PlanBlockMeta | undefined,
  streaming?: boolean,
): boolean {
  return (
    !streaming &&
    !!text.trim() &&
    plan?.status !== "streaming" &&
    plan?.status !== "building" &&
    plan?.status !== "built"
  );
}

/** Plans whose decision the user skipped, kept for the app's lifetime. */
const skipped = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function skipPlanDecision(blockId: string): void {
  if (skipped.has(blockId)) return;
  skipped.add(blockId);
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The newest plan still awaiting a decision, unless the user moved on. */
export function latestPlanDecision(blocks: Block[]): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "user" && !block.draft) return undefined;
    if (block.role !== "plan" || block.orchestration) continue;
    if (legacyTaskListFromText(block.text)) return undefined;
    if (!planBuildable(block.text, block.plan, block.streaming)) return undefined;
    return skipped.has(block.id) ? undefined : block.id;
  }
  return undefined;
}

/** The plan to ask about while the conversation is idle and has no question. */
export function usePlanDecision(
  blocks: Block[] | undefined,
  enabled: boolean,
): string | undefined {
  useSyncExternalStore(subscribe, () => version);
  return enabled && blocks ? latestPlanDecision(blocks) : undefined;
}
