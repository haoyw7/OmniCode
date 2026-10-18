/**
 * Edits to the assistant's memory documents, as text in and text out. The
 * memory control actions use these, so every entry the assistant writes has
 * the same shape: one dated bullet, superseded rather than deleted, and never
 * a secret. Lines without a date are the user's and are left alone. Ported
 * from upstream Mono's `monoMemory`; the documents live in the Host store.
 */

import { bm25Scores, tokenizeMemorySearch } from "./memorySearch";

/** Only this much of the resident memory loads into a turn, whichever cuts first. */
export const MEMORY_MAX_LINES = 200;
export const MEMORY_MAX_BYTES = 24 * 1024;

/** One entry is at most this long, so a single note cannot crowd out the rest. */
export const MEMORY_ENTRY_MAX = 1000;

const DATED = /^- (?:~~)?(\d{4}-\d{2}-\d{2}) · /;
const UNTIL = / · until (\d{4}-\d{2}-\d{2})\s*$/;

/** Calendar date in the assistant's time zone, the way entries are dated. */
export function memoryDate(now: Date, timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
];

/** Anything that looks like a credential, replaced before it reaches disk. */
export function redactSecrets(text: string): string {
  return SECRETS.reduce(
    (out, pattern) =>
      out.replace(pattern, (match) => `«redacted ${match.length} chars»`),
    text,
  );
}

/** A fact as one dated bullet: `- 2026-10-04 · fact · until 2026-11-01`. */
export function memoryEntry(
  fact: string,
  date: string,
  until?: string,
): string {
  const text = redactSecrets(fact).replace(/\s+/g, " ").trim();
  if (!text) throw new Error("fact must not be empty");
  if (text.length > MEMORY_ENTRY_MAX)
    throw new Error(`fact must be under ${MEMORY_ENTRY_MAX} characters`);
  if (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(until))
    throw new Error("until must be a date like 2026-10-31");
  return `- ${date} · ${text}${until ? ` · until ${until}` : ""}`;
}

function lines(text: string): string[] {
  return text.trim() ? text.replace(/\s+$/, "").split("\n") : [];
}

function join(list: string[]): string {
  return list.length ? `${list.join("\n")}\n` : "";
}

/** The fact a line holds, without its date, strike-through or until. */
function factOf(line: string): string {
  return line
    .replace(DATED, "")
    .replace(/^- /, "")
    .replace(UNTIL, "")
    .replace(/~~/g, "")
    .replace(/ · superseded \d{4}-\d{2}-\d{2}$/, "")
    .trim();
}

/** Appends the entry unless the same fact is already there. */
export function addMemoryEntry(
  text: string,
  entry: string,
): { text: string; added: boolean } {
  const list = lines(text);
  const fact = factOf(entry);
  if (list.some((line) => !line.includes("~~") && factOf(line) === fact))
    return { text: join(list), added: false };
  return { text: join([...list, entry]), added: true };
}

/** The one live line containing `find`; anything else is an error. */
function findLine(list: string[], find: string): number {
  const needle = find.trim();
  if (!needle) throw new Error("find must not be empty");
  const hits = list.flatMap((line, index) =>
    line.includes(needle) && !line.includes("~~") ? [index] : [],
  );
  if (hits.length === 0)
    throw new Error("No memory entry contains that text; read memory first");
  if (hits.length > 1)
    throw new Error(
      `${hits.length} entries contain that text; quote more of the one you mean`,
    );
  return hits[0];
}

/**
 * Strikes the old line through and adds the new fact after it, so the file
 * itself shows what changed and when.
 */
export function supersedeMemoryEntry(
  text: string,
  find: string,
  entry: string,
  date: string,
): string {
  const list = lines(text);
  const index = findLine(list, find);
  const old = list[index];
  const struck = old.startsWith("- ")
    ? `- ~~${old.slice(2)}~~ · superseded ${date}`
    : `~~${old}~~ · superseded ${date}`;
  list.splice(index, 1, struck, entry);
  return join(list);
}

/** Takes a line out entirely, for an entry that was simply wrong. */
export function removeMemoryEntry(
  text: string,
  find: string,
): { text: string; removed: string } {
  const list = lines(text);
  const index = findLine(list, find);
  const [removed] = list.splice(index, 1);
  return { text: join(list), removed };
}

function overBudget(list: string[]): boolean {
  const bytes = new TextEncoder().encode(join(list)).length;
  return list.length > MEMORY_MAX_LINES || bytes > MEMORY_MAX_BYTES;
}

/**
 * Keeps resident memory within what loads by moving the oldest dated entries out to
 * the archive: struck-through ones first, then expired ones, then the oldest
 * live ones. The user's undated lines and `keep` (the entry just written)
 * never move, so the file can still overflow when those fill it by themselves.
 */
export function fitMemoryBudget(
  text: string,
  keep: string | undefined,
  date: string,
): { text: string; moved: string[] } {
  const list = lines(text);
  const moved: string[] = [];
  const movable = (line: string) => DATED.test(line) && line !== keep;
  const expired = (line: string) => {
    const until = line.match(UNTIL)?.[1];
    return !!until && until < date;
  };
  const passes = [
    (line: string) => movable(line) && line.includes("~~"),
    (line: string) => movable(line) && expired(line),
    movable,
  ];
  for (const pick of passes) {
    while (overBudget(list)) {
      const index = list.findIndex(pick);
      if (index < 0) break;
      moved.push(...list.splice(index, 1));
    }
  }
  return { text: join(list), moved };
}

/** Lines moved out of resident memory, appended to the archive with the day. */
export function archiveMemoryEntries(
  archive: string,
  moved: string[],
  date: string,
): string {
  const header = lines(archive).length ? lines(archive) : ["# Archive", ""];
  return join([...header, ...moved.map((line) => `${line} · moved ${date}`)]);
}

/** Portable Markdown basename, shared by file paths and the legacy controls. */
export function validMemoryName(name: string): boolean {
  return name.length <= 80 && /^[\p{L}\p{N}_-][\p{L}\p{N} ._-]*$/u.test(name) &&
    !name.endsWith(".") && !name.endsWith(" ") &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

/** Keep historical ASCII aliases readable; new Unicode names use portable filenames. */
export function topicName(value: string): string {
  const name = value.trim().replace(/\.md$/i, "");
  const legacy = /^[A-Za-z0-9 ._-]+$/.test(name);
  if (
    !name || name.length > 80 || name.startsWith(".") ||
    (!legacy && (!validMemoryName(name) || /\.md$/i.test(name))) ||
    name.toLowerCase() === "archive"
  )
    throw new Error(
      "topic must be a short name of letters, numbers, spaces, dots and dashes",
    );
  return name;
}

export type MemoryHit = { file: string; line: string; date?: string };

/** `2026-10-01`, or a span back from `today`: `7d`, `24h`, `2w`. */
export function sinceDate(
  value: string,
  today: Date,
  timeZone: string,
): string {
  const span = value.trim().match(/^(\d{1,4})\s*([hdw])$/i);
  if (span) {
    const hours =
      Number(span[1]) *
      ({ h: 1, d: 24, w: 24 * 7 } as const)[
        span[2].toLowerCase() as "h" | "d" | "w"
      ];
    return memoryDate(new Date(today.getTime() - hours * 3_600_000), timeZone);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  throw new Error('since must be a date like 2026-10-01 or a span like "7d"');
}

/**
 * BM25 over individual facts across all memory documents. Metadata is kept
 * in results but not scored; historical facts remain searchable. Newer
 * entries win ties, then the original document/line order is preserved.
 */
export function searchMemory(
  files: { file: string; text: string }[],
  query: string,
  options: { since?: string; limit?: number } = {},
): MemoryHit[] {
  const words = tokenizeMemorySearch(query);
  if (!words.length && !options.since)
    throw new Error("query needs at least one searchable word");
  const candidates: { hit: MemoryHit; text: string }[] = [];
  for (const { file, text } of files) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || /^#{1,6}(?:\s|$)/.test(trimmed)) continue;
      const date = trimmed.match(DATED)?.[1];
      if (options.since && (!date || date < options.since)) continue;
      const fact = trimmed
        .replace(DATED, "")
        .replace(/^[-*]\s+/, "")
        .replace(/~~/g, "")
        .replace(/(?: · (?:until|superseded|moved) \d{4}-\d{2}-\d{2})+$/, "")
        .trim();
      if (fact)
        candidates.push({
          hit: { file, line, ...(date ? { date } : {}) },
          text: fact,
        });
    }
  }
  const scores = bm25Scores(
    words,
    candidates.map((candidate) => candidate.text),
  );
  return candidates
    .map(({ hit }, index) => ({ ...hit, score: scores[index] }))
    .filter((hit) => !words.length || hit.score > 0)
    .sort(
      (a, b) => b.score - a.score || (b.date ?? "").localeCompare(a.date ?? ""),
    )
    .slice(0, options.limit ?? 20)
    .map(({ score: _score, ...hit }) => hit);
}

/** One line of resident memory as the settings page lists it. */
export type MemoryLine = {
  /** Index of the line in the file, for removing it. */
  index: number;
  /** The fact itself, without its bullet, date or markers. */
  text: string;
  date?: string;
  until?: string;
  /** Superseded by a newer entry; kept for the record. */
  struck: boolean;
};

/**
 * Resident memory as a list of facts. Blank lines and headings are left out; any
 * other line is a fact, dated or not, so a hand-written file lists too.
 */
export function memoryLines(text: string): MemoryLine[] {
  const out: MemoryLine[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line)) return;
    const struck = /^- ~~/.test(line);
    const date = line.match(DATED)?.[1];
    const until = line.match(UNTIL)?.[1];
    const fact = line
      .replace(/^[-*]\s+/, "")
      .replace(/~~/g, "")
      .replace(/^\d{4}-\d{2}-\d{2} · /, "")
      .replace(UNTIL, "")
      .replace(/ · (?:superseded|moved) \d{4}-\d{2}-\d{2}.*$/, "")
      .trim();
    if (!fact) return;
    out.push({
      index,
      text: fact,
      struck,
      ...(date ? { date } : {}),
      ...(until ? { until } : {}),
    });
  });
  return out;
}

/** The file without one of its lines. */
export function withoutLine(text: string, index: number): string {
  const lines = text.split("\n");
  lines.splice(index, 1);
  return lines.join("\n");
}

/**
 * The file with one fact reworded in place. A dated entry is redated to
 * today and keeps its until; a line the user wrote stays undated.
 */
export function withLineEdited(
  text: string,
  index: number,
  fact: string,
  date: string,
): string {
  const lines = text.split("\n");
  const old = lines[index] ?? "";
  if (DATED.test(old.trim())) {
    lines[index] = memoryEntry(fact, date, old.match(UNTIL)?.[1]);
  } else {
    const clean = redactSecrets(fact).replace(/\s+/g, " ").trim();
    if (!clean) throw new Error("fact must not be empty");
    lines[index] = `${old.match(/^\s*[-*]\s+/)?.[0] ?? ""}${clean}`;
  }
  return lines.join("\n");
}

/** The part of resident memory that fits the budget: whole lines only. */
export function memoryWithinBudget(memory: string): {
  text: string;
  /** Lines past the budget, which do not load. */
  droppedLines: number;
} {
  const all = memory.trim() ? memory.replace(/\s+$/, "").split("\n") : [];
  const encoder = new TextEncoder();
  const kept: string[] = [];
  let bytes = 0;
  for (const line of all) {
    const size = encoder.encode(line).length + 1;
    if (kept.length >= MEMORY_MAX_LINES || bytes + size > MEMORY_MAX_BYTES)
      break;
    kept.push(line);
    bytes += size;
  }
  return { text: kept.join("\n"), droppedLines: all.length - kept.length };
}
