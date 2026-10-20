import type { Block } from "./session";
import { formatLiveElapsed } from "./liveAgents";
import { isToolBlock, toolCallState } from "./transcriptActivity";

/**
 * The words under a live turn. A key is English UI text for `t()`; a literal
 * is already-built text shown as is.
 */
export type LiveStatusText =
  | { key: string; params?: Record<string, string | number> }
  | { literal: string };

export type LiveStatusPhase = "waiting" | "thinking" | "tool" | "working";

export interface LiveStatus {
  phase: LiveStatusPhase;
  label: LiveStatusText;
  /** Current thought/tool time, otherwise the current response round's time. */
  elapsed?: string;
  clock?: "thinking" | "tool" | "round";
  /** Brief activities, tool calls and user waits keep the status line text-only. */
  showClock: boolean;
  /** A new origin resets the digits without animating the old time backwards. */
  clockStartedAt?: number;
  /** How many tasks are still going outside the main stream. */
  background: number;
  /** Nothing from the agent yet: the turn is still starting up. */
  starting: boolean;
}

/**
 * Filler verbs shown only while tools run. A verb only says the agent is
 * alive; a new one each phase keeps a long turn from looking frozen. These are
 * English UI keys for `t()`.
 */
export const LIVE_VERBS = [
  "Brewing",
  "Pondering",
  "Mulling",
  "Computing",
  "Cooking",
  "Percolating",
  "Contemplating",
  "Scheming",
  "Imagining",
  "Tinkering",
  "Crafting",
  "Musing",
  "Noodling",
  "Simmering",
  "Synthesizing",
  "Weaving",
  "Conjuring",
  "Untangling",
  "Assembling",
  "Puzzling",
] as const;

export interface LiveStatusInput {
  /** The live turn's blocks, user prompt first. */
  turn: Block[];
  now: number;
  /** Initial origin, before the first response or tool boundary arrives. */
  startedAt?: number;
  /** What the turn is blocked on, if anything. */
  waiting?: "approval" | "answers";
  background?: number;
  /** Stable per turn, so the verb only changes with the phase. */
  seed: string;
}

export function liveStatus(input: LiveStatusInput): LiveStatus {
  const { turn, now } = input;
  const roundStartedAt = responseRoundStartedAt(turn, input.startedAt);
  const last = lastMeaningfulBlock(turn);
  const background = input.background ?? 0;
  const starting = !turn.some(isAgentOutput);
  const status = (
    phase: LiveStatusPhase,
    label: LiveStatusText,
    phaseStartedAt?: number,
  ): LiveStatus => {
    const origin = phaseStartedAt ?? roundStartedAt;
    return {
      phase,
      label,
      background,
      starting,
      // Thinking and replies are timed once they last; tool verbs and user
      // waits stay text-only.
      showClock: origin != null && now - origin >= 2_000 &&
        (phase === "thinking" || phase === "working"),
      ...(origin != null ? {
        elapsed: formatLiveElapsed(origin, now, true),
        clock: phaseStartedAt != null && (phase === "thinking" || phase === "tool")
          ? phase
          : "round",
        clockStartedAt: origin,
      } : {}),
    };
  };

  if (input.waiting) {
    return status("waiting", {
      key: input.waiting === "answers" ? "Waiting for answers" : "Waiting for approval",
    });
  }

  if (last?.role === "reasoning" && last.streaming) {
    const thoughtMs = last.startedAt != null ? now - last.startedAt : 0;
    return status("thinking", { key: thinkingKey(thoughtMs) }, last.startedAt);
  }

  // A finished call holds the verb until the model's next output arrives, so a
  // run of quick calls does not flicker back to "Thinking…" in between.
  const running = lastRunningTool(turn);
  const tool = running ?? (last && isToolBlock(last) ? last : undefined);
  if (tool) {
    return status("tool", { key: liveVerb(input.seed, turn.indexOf(tool)) }, running?.startedAt);
  }

  if (last?.streaming && (last.role === "assistant" || last.role === "plan")) {
    return status("working", { key: "Responding…" });
  }

  // Between tools the agent is still reasoning, even when no thought streams.
  return status("working", { key: "Thinking…" });
}

/**
 * Each new response starts a small round. Between responses, the latest tool
 * boundary starts the next round, including calls that complete out of order.
 * Status pings and further tokens in the same response do not move the origin.
 */
function responseRoundStartedAt(turn: Block[], fallback?: number): number | undefined {
  let toolBoundary: number | undefined;
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const block = turn[index];
    if (block.role === "user") return toolBoundary ?? block.sentAt ?? fallback;
    if (isToolBlock(block) && block.startedAt != null) {
      const boundary = block.startedAt + Math.max(0, block.durationMs ?? 0);
      toolBoundary = Math.max(toolBoundary ?? boundary, boundary);
    }
    if (
      block.role === "assistant" || block.role === "reasoning" ||
      block.role === "plan" || block.role === "image"
    ) {
      const origin = block.startedAt ?? block.sentAt;
      if (origin != null) return toolBoundary ?? origin;
    }
  }
  return toolBoundary ?? fallback;
}

function thinkingKey(thoughtMs: number): string {
  if (thoughtMs < 10_000) return "Thinking…";
  if (thoughtMs < 25_000) return "Still thinking…";
  if (thoughtMs < 50_000) return "Thinking more…";
  return "Almost done thinking…";
}

/** The newest block the agent produced, skipping empty placeholders. */
function lastMeaningfulBlock(turn: Block[]): Block | undefined {
  for (let index = turn.length - 1; index > 0; index -= 1) {
    const block = turn[index];
    if (block.role === "user") return undefined;
    if (block.role === "system" && (!block.notice || block.notice === "warning") && !block.question)
      continue;
    if (block.role === "reasoning" && !block.text.trim() && !block.streaming) continue;
    return block;
  }
  return undefined;
}

/** Empty placeholders and bookkeeping do not count as the agent responding. */
function isAgentOutput(block: Block): boolean {
  if (block.role === "user" || block.role === "system") return false;
  if (block.role === "assistant" || block.role === "reasoning") return !!block.text.trim();
  return true;
}

function isRunningTool(block: Block): boolean {
  return isToolBlock(block) && toolCallState(block) === "pending";
}

/** The latest active call supplies the tool clock, even with concurrent calls. */
function lastRunningTool(turn: Block[]): Block | undefined {
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const block = turn[index];
    if (block.role === "user") return undefined;
    if (isRunningTool(block)) return block;
  }
  return undefined;
}

/** A verb that holds still within a phase and moves on with the next one. */
export function liveVerb(seed: string, phase: number): string {
  return LIVE_VERBS[phaseHash(seed, phase) % LIVE_VERBS.length];
}

function phaseHash(seed: string, phase: number): number {
  const text = `${seed}:${phase}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
