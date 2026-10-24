import { supportsBtwHarness, btwTurnHarness } from "../../../domain/btw";
import type { Block, BtwMessage, BtwThread, HarnessId } from "../../../contracts/session";
import type { BuiltinSkill } from "../../skills/model/skills";
import { groupTurns } from "./transcriptActivity";
import { resolveModel } from "../../../integrations/harness/core/modelCatalog";

export function sessionHasBtwThreads(blocks: Block[]): boolean {
  return blocks.some((block) => (block.btwThreads?.length ?? 0) > 0);
}

/** A side thread together with the turn it was asked about. */
export type BtwSessionThread = {
  thread: BtwThread;
  turn: Block[];
};

/** Every side thread in a session, oldest first. */
export function sessionBtwThreads(
  blocks: Block[],
  managed = false,
): BtwSessionThread[] {
  if (!sessionHasBtwThreads(blocks)) return [];
  const entries: BtwSessionThread[] = [];
  for (const turn of groupTurns(blocks, managed)) {
    const userBlock = turn.find((block) => block.role === "user");
    for (const thread of userBlock?.btwThreads ?? []) {
      entries.push({ thread, turn });
    }
  }
  return entries.sort((a, b) => a.thread.createdAt - b.thread.createdAt);
}

/** Provider for a BTW surface, including threads saved before a handoff. */
export function resolveBtwHarness(
  turnHarness: HarnessId | undefined,
  threads?: BtwThread[],
): HarnessId | undefined {
  if (supportsBtwHarness(turnHarness)) return turnHarness;
  const stored = threads
    ?.map((thread) => thread.harness)
    .find((harness) => supportsBtwHarness(harness));
  return stored;
}

/** Harness to drive BTW UI and requests for one turn. */
export function btwSurfaceHarness(
  blocks: Block[],
  turn: Block[],
  sessionHarness: HarnessId,
  threads?: BtwThread[],
): HarnessId | undefined {
  return resolveBtwHarness(
    btwTurnHarness(blocks, turn, sessionHarness),
    threads,
  );
}

export function sessionHasBtwEligibleTurn(
  blocks: Block[],
  sessionHarness: HarnessId,
  managed = false,
): boolean {
  const turns = groupTurns(blocks, managed);
  return btwOpenTargetTurnId(turns, blocks, sessionHarness, managed) != null;
}

/** Completed turn that should receive a composer `/btw` open request. */
export function btwOpenTargetTurnId(
  turns: Block[][],
  blocks: Block[],
  sessionHarness: HarnessId,
  managed = false,
): string | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    let completed = false;
    for (let i = turn.length - 1; i >= 0; i -= 1) {
      const block = turn[i];
      if (block.role !== "user" || (managed && block.internal)) continue;
      completed = block.durationMs != null;
      break;
    }
    if (!completed) continue;
    if (!supportsBtwHarness(btwTurnHarness(blocks, turn, sessionHarness))) {
      continue;
    }
    return turn[0]?.id;
  }
  return undefined;
}

export const BTW_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "btw",
  invocation: "btw",
  description: "Ask a read-only side question about the current turn.",
  scope: "builtin",
  source: "omnicode",
};

/** Consume `/btw` when it is the leading composer command. */
export function consumeBtwCommand(text: string): {
  text: string;
  matched: boolean;
} {
  const match = text.match(/^\s*\/btw(?:\s+([\s\S]*))?\s*$/i);
  if (!match) return { text, matched: false };
  return { text: match[1]?.trim() ?? "", matched: true };
}

/**
 * Text left after a `/btw ` typed at the start of the composer, or null. The
 * trailing whitespace is what commits the command while typing.
 */
export function consumeBtwPrefix(text: string): string | null {
  const match = text.match(/^\s*\/btw\s+/i);
  return match ? text.slice(match[0].length) : null;
}

/**
 * A side thread as ordinary transcript blocks, so it renders through the
 * main transcript: each question is a user turn, each reply its answer, and
 * a reply still streaming is the live turn.
 */
export function btwThreadBlocks(input: {
  messages: BtwMessage[];
  pendingBlocks?: Block[];
  running: boolean;
  /** When the thread last changed, to close a turn that failed unanswered. */
  updatedAt?: number;
  harness?: HarnessId;
  model?: string;
}): Block[] {
  const { messages, running, harness, model } = input;
  const turnModel =
    harness && model
      ? { harness, id: model, name: resolveModel(harness, model).name }
      : undefined;
  const blocks: Block[] = [];
  messages.forEach((message, index) => {
    if (message.role === "assistant") {
      if (message.blocks?.length) blocks.push(...message.blocks);
      else
        blocks.push({ id: message.id, role: "assistant", text: message.text });
      return;
    }
    const answer = messages[index + 1];
    const last = index === messages.length - 1;
    const endedAt =
      answer?.role === "assistant"
        ? answer.createdAt
        : last && !running
          ? (input.updatedAt ?? message.createdAt)
          : undefined;
    blocks.push({
      id: message.id,
      role: "user",
      text: message.text,
      startedAt: message.createdAt,
      ...(endedAt != null
        ? { durationMs: Math.max(0, endedAt - message.createdAt) }
        : {}),
      ...(turnModel ? { turnModel } : {}),
    });
    if (last && running) blocks.push(...(input.pendingBlocks ?? []));
  });
  return blocks;
}

export function replaceBtwThread(block: Block, thread: BtwThread): Block {
  const threads = block.btwThreads ?? [];
  const index = threads.findIndex((entry) => entry.id === thread.id);
  if (index < 0) return block;
  const next = threads.slice();
  next[index] = thread;
  return { ...block, btwThreads: next };
}
