import { randomUUID } from "node:crypto";
import type { BotMessage } from "../../../src/features/bots/model/botView";
import { chatStamp } from "./chatSearch";
import { memoryDate } from "./memory";
import { QUIET_MARKER } from "./prompt";
import type { BotThreadStore } from "./store";

/**
 * Once a day ends, the brain writes a short diary entry about that day's chat
 * into one topic note. A fresh brain generation reads the newest entries, and
 * memory.search finds older ones, so rotation keeps the gist of every day
 * instead of only one line per exchange.
 */
export const DIARY_TOPIC = "chat-days";
/** A day is written up once this much of the next local day has passed. */
const DAY_END_GRACE_MS = 4 * 60 * 60 * 1000;
/** Days caught up after the Host was off, or when diaries first appear. */
const BACKFILL_DAYS = 3;
const MESSAGE_CHARS = 1_000;
const TRANSCRIPT_CHARS = 16_000;
const BRIEF_CHARS = 3_000;

/** Local dates whose diary is due: finished days within the backfill window. */
export function dueDiaryDays(now: number, timeZone: string): string[] {
  const settled = now - DAY_END_GRACE_MS;
  return Array.from({ length: BACKFILL_DAYS }, (_, i) =>
    memoryDate(new Date(settled - (i + 1) * 86_400_000), timeZone),
  ).reverse();
}

/** The day's chat as the brain reads it, clipped from the middle if long. */
export function diaryTranscript(
  messages: readonly BotMessage[],
  day: string,
  timeZone: string,
): string {
  const lines = messages.flatMap((m) =>
    (m.kind === "user" || m.kind === "assistant") &&
    !m.streaming &&
    m.text.trim() &&
    memoryDate(new Date(m.createdAt), timeZone) === day
      ? [
          `${chatStamp(m.createdAt, timeZone).slice(11)} ${m.kind === "user" ? "User" : "You"}: ${
            m.text.trim().length > MESSAGE_CHARS
              ? `${m.text.trim().slice(0, MESSAGE_CHARS)}…`
              : m.text.trim()
          }`,
        ]
      : [],
  );
  if (!lines.some((line) => /^\d\d:\d\d User: /.test(line))) return "";
  const text = lines.join("\n");
  if (text.length <= TRANSCRIPT_CHARS) return text;
  const half = TRANSCRIPT_CHARS / 2;
  return `${text.slice(0, half)}\n[… middle of the day left out …]\n${text.slice(-half)}`;
}

export function diaryWakeupText(day: string, transcript: string): string {
  return `Housekeeping, not a message from the user: write your diary entry for ${day}. Save it with memory.add {topic:${JSON.stringify(DIARY_TOPIC)},fact:"${day}: …"} as one entry of 3–6 sentences in the user's language: what they asked for, what was done or decided (with exact names such as songs, files or projects), what is still open, and anything they said about themselves. Also save any lasting fact from that day that is missing from your memory, and if the user taught you a multi-step procedure that day or corrected how you do one, save or update its playbook. Do not contact agents or check anything else, then reply exactly ${QUIET_MARKER}.
Chat on ${day} (local time):
${transcript}`;
}

/**
 * Queues each finished day's diary once; days without user messages are
 * skipped. Returns false when scheduled work is off, so the caller checks again.
 */
export function enqueueDiaries(store: BotThreadStore, now = Date.now()): boolean {
  const config = store.get();
  if (
    !config?.enabled ||
    !config.triggers.schedule ||
    ["paused", "disabled", "interrupted", "failed"].includes(config.lifecycle)
  )
    return false;
  const timeZone = config.timezone ?? "UTC";
  const written = store.memoryDoc(`topic:${DIARY_TOPIC}`).text;
  const days = dueDiaryDays(now, timeZone).filter(
    (day) => !written.includes(` · ${day}: `),
  );
  if (!days.length) return true;
  const messages = store.latestMessages();
  store.host.transaction(() => {
    for (const day of days) {
      const transcript = diaryTranscript(messages, day, timeZone);
      if (!transcript) continue;
      const rootCauseId = `diary:${day}`;
      store.enqueue(
        {
          id: randomUUID(),
          kind: "schedule",
          text: diaryWakeupText(day, transcript),
          rootCauseId,
          state: "pending",
          createdAt: now,
          attempts: 0,
        },
        rootCauseId,
      );
      store.writeChain(rootCauseId, { count: 0, paused: false, startedAt: now });
    }
  });
  return true;
}

/** The newest diary entries that fit, oldest first, for a fresh brain. */
export function diaryBrief(text: string): string {
  const entries = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !line.startsWith("- ~~"));
  const kept: string[] = [];
  let used = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    used += entries[i].length + 1;
    if (used > BRIEF_CHARS) break;
    kept.unshift(entries[i]);
  }
  return kept.join("\n");
}
