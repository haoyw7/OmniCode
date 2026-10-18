import type { BotMessage } from "../../../src/features/bots/model/botView";
import { memoryDate } from "./memory";
import { bm25Scores, tokenizeMemorySearch } from "./memorySearch";

type ChatMessage = Extract<BotMessage, { kind: "user" | "assistant" }>;

export type ChatHit = {
  at: string;
  from: "user" | "assistant";
  text: string;
  /** The question this reply answered, or the reply this message received. */
  context?: { from: "user" | "assistant"; text: string };
};

const HIT_CHARS = 800;
const CONTEXT_CHARS = 300;

function clip(text: string, max: number): string {
  const value = text.trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Date and minute in the assistant's time zone, e.g. "2026-10-07 21:14". */
export function chatStamp(at: number, timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at);
  let time: string;
  try {
    time = format(timeZone);
  } catch {
    time = format("UTC");
  }
  return `${memoryDate(new Date(at), timeZone)} ${time}`;
}

/**
 * Searches the public conversation with the user. Whitespace-separated query
 * terms also match literally, so single characters and exact song or file
 * names are found even when word segmentation splits them differently.
 * Without a query, returns the latest messages since the given date.
 */
export function searchChat(
  messages: readonly BotMessage[],
  query: string,
  options: {
    timeZone: string;
    since?: string;
    limit?: number;
    /** Only messages created before this time, e.g. not yet in the brain's context. */
    before?: number;
    /** Minimum distinct segmented query words a hit must share. */
    minWords?: number;
  },
): ChatHit[] {
  const chat = messages.filter(
    (m): m is ChatMessage =>
      (m.kind === "user" || m.kind === "assistant") &&
      !m.streaming &&
      !!m.text.trim(),
  );
  const words = tokenizeMemorySearch(query);
  const literals = [
    ...new Set(query.toLowerCase().split(/\s+/).filter(Boolean)),
  ];
  if (!words.length && !literals.length && !options.since)
    throw new Error("query needs at least one searchable word");
  const indexes = chat
    .map((m, index) => ({ m, index }))
    .filter(
      ({ m }) =>
        (options.before === undefined || m.createdAt < options.before) &&
        (!options.since ||
          memoryDate(new Date(m.createdAt), options.timeZone) >= options.since),
    );
  const limit = options.limit ?? 20;
  let picked: number[];
  if (!literals.length) picked = indexes.slice(-limit).map(({ index }) => index);
  else {
    const scores = bm25Scores(
      words,
      indexes.map(({ m }) => m.text),
    );
    const wanted = new Set(words);
    picked = indexes
      .map(({ m, index }, i) => {
        const text = m.text.toLowerCase();
        return {
          index,
          literal: literals.filter((term) => text.includes(term)).length,
          score: scores[i],
        };
      })
      .filter(({ literal, score }) => literal > 0 || score > 0)
      .filter(
        ({ index }) =>
          !options.minWords ||
          new Set(
            tokenizeMemorySearch(chat[index].text).filter((w) => wanted.has(w)),
          ).size >= options.minWords,
      )
      .sort(
        (a, b) =>
          b.literal - a.literal ||
          b.score - a.score ||
          chat[b.index].createdAt - chat[a.index].createdAt,
      )
      .slice(0, limit)
      .map(({ index }) => index);
  }
  return picked.map((index) => {
    const m = chat[index];
    const neighbor = chat[m.kind === "user" ? index + 1 : index - 1];
    return {
      at: chatStamp(m.createdAt, options.timeZone),
      from: m.kind,
      text: clip(m.text, HIT_CHARS),
      ...(neighbor && neighbor.kind !== m.kind
        ? {
            context: {
              from: neighbor.kind,
              text: clip(neighbor.text, CONTEXT_CHARS),
            },
          }
        : {}),
    };
  });
}
