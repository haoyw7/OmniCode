import type { BotMessage } from "../../../src/features/bots/model/botView";
import type { Session } from "../../../src/features/sessions/model/session";

/**
 * The public chat never ends, but the brain's provider context does. Every turn
 * resends the whole native context, so once it grows past a budget, or the
 * user returns after a long break, the next wakeup starts a fresh brain
 * generation. Its first turn gets a brief of the chat: the latest exchanges
 * word for word and one line for each earlier one. Nothing is summarized by a
 * model, so rotation costs nothing and the full chat stays in the Host store;
 * the brain's own daily diary (diary.ts) carries the gist of earlier days.
 * Adapted from upstream Mono's `monoRotation`.
 */

/** Guess of a fresh brain's own context until its first turn is measured. */
export const DEFAULT_BASELINE = 20_000;
/** Rotate once the conversation has added this much on top of the baseline. */
export const GROWTH_TOKENS = 60_000;
/** Or once it fills this much of a smaller window, before native compaction. */
export const ROTATE_RATIO = 0.5;
/** A break this long starts fresh; any prompt cache is long cold by then... */
export const IDLE_ROTATE_MS = 6 * 60 * 60 * 1000;
/** ...as long as the context has grown to at least this many baselines. */
export const IDLE_MIN_BASELINES = 2;

const VERBATIM_EXCHANGES = 2;
const VERBATIM_USER_CHARS = 2_000;
const VERBATIM_REPLY_CHARS = 3_000;
const LINE_CHARS = 280;
const EARLIER_CHARS = 3_000;

export type RotationReason = "context" | "idle";

/** When the brain's last turn finished, or started if it never reported a length. */
function lastActivity(blocks: Session["blocks"]): number | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role !== "user" || block.draft || block.startedAt == null)
      continue;
    return block.startedAt + (block.durationMs ?? 0);
  }
  return undefined;
}

/** Whether the next wakeup should start a fresh brain generation, and why. */
export function rotationReason(
  brain: Pick<Session, "providerSessionId" | "context" | "blocks">,
  now: number,
  baseline = DEFAULT_BASELINE,
): RotationReason | undefined {
  // Nothing to rotate: the next turn already starts a new provider session.
  if (!brain.providerSessionId) return undefined;
  const used = brain.context?.used ?? 0;
  const window = brain.context?.window;
  if (
    used >= baseline + GROWTH_TOKENS ||
    (window && used / window >= ROTATE_RATIO)
  )
    return "context";
  const last = lastActivity(brain.blocks);
  if (
    last != null &&
    now - last >= IDLE_ROTATE_MS &&
    used >= baseline * IDLE_MIN_BASELINES
  )
    return "idle";
  return undefined;
}

type Exchange = { at: number; user: string; reply: string };

/** User messages and what the assistant finally said after each. */
function exchanges(messages: readonly BotMessage[]): Exchange[] {
  const out: Exchange[] = [];
  for (const message of messages) {
    if (message.kind === "user") {
      out.push({ at: message.createdAt, user: message.text.trim(), reply: "" });
      continue;
    }
    if (message.kind !== "assistant" || !message.text.trim()) continue;
    const current = out.at(-1);
    // Replies split into bubbles belong together; event replies stand alone.
    if (current) current.reply = [current.reply, message.text.trim()].filter(Boolean).join("\n");
    else out.push({ at: message.createdAt, user: "", reply: message.text.trim() });
  }
  return out.filter((exchange) => exchange.user || exchange.reply);
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 20) / 2);
  return `${text.slice(0, half).trimEnd()} […] ${text.slice(-half).trimStart()}`;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Keep the newest lines that fit, oldest first. */
function newestWithin(lines: string[], budget: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    used += lines[i].length + 1;
    if (used > budget) break;
    kept.unshift(lines[i]);
  }
  return kept;
}

/**
 * What a fresh brain is told about the conversation so far, from the public
 * chat without the current input. Empty when there is nothing to carry.
 */
export function conversationBrief(
  messages: readonly BotMessage[],
  when: (at: number) => string,
): string {
  const all = exchanges(messages);
  if (!all.length) return "";
  const verbatim = all.slice(-VERBATIM_EXCHANGES);
  const earlier = newestWithin(
    all.slice(0, -VERBATIM_EXCHANGES || undefined).map(
      (exchange) =>
        `- ${when(exchange.at)} · ${
          exchange.user
            ? `User: ${oneLine(exchange.user, LINE_CHARS)}${exchange.reply ? ` → You: ${oneLine(exchange.reply, LINE_CHARS)}` : ""}`
            : `You, on your own: ${oneLine(exchange.reply, LINE_CHARS)}`
        }`,
    ),
    EARLIER_CHARS,
  );
  const parts = [
    "This is the same long-lived conversation with the user, continued in a fresh context so it stays small; nothing was lost. Pick up where it left off and do not mention the switch unless asked.",
  ];
  if (earlier.length) parts.push(`Earlier, oldest first:\n${earlier.join("\n")}`);
  parts.push(
    `Most recent, word for word:\n\n${verbatim
      .map((exchange) =>
        exchange.user
          ? `User (${when(exchange.at)}):\n${clip(exchange.user, VERBATIM_USER_CHARS)}${
              exchange.reply
                ? `\n\nYou:\n${clip(exchange.reply, VERBATIM_REPLY_CHARS)}`
                : ""
            }`
          : `You, on your own (${when(exchange.at)}):\n${clip(exchange.reply, VERBATIM_REPLY_CHARS)}`,
      )
      .join("\n\n---\n\n")}`,
  );
  return `<previous_conversation>\n${parts.join("\n\n")}\n</previous_conversation>`;
}
