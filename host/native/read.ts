import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  NativeSessionFile,
  NativeSessionProvider,
} from "../../src/integrations/harness/core/nativeSessions";
import {
  MAX_BYTES,
  OPENCODE_SESSIONS,
  jsonlRevision,
  openCodeRow,
  openOpenCode,
  type NativeSource,
} from "./sources";

/** Native transcript reads: incremental JSONL tails and consistent OpenCode snapshots. */

const HEAD_BYTES = 4096;
/** Lines below this size are returned verbatim; only large records are rewritten. */
const COMPACT_LINE_BYTES = 8 * 1024;
/** Blobs (base64 images, signatures) above this size carry no transcript text. */
const BLOB_BYTES = 1024;

export type NativeRead = {
  /** Revision of exactly the bytes returned. */
  revision: string;
  text: string;
  /** End of the complete lines returned; the next incremental read starts here. */
  offset: number;
  /** Fingerprint of the file prefix, so rewrites force a full reload. */
  head: string;
  appended: boolean;
};

function readRange(fd: number, start: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const read = readSync(fd, buffer, done, length - done, start + done);
    if (!read) break;
    done += read;
  }
  return buffer.subarray(0, done);
}

function fingerprint(fd: number, end: number): string {
  return createHash("sha256").update(readRange(fd, 0, Math.min(end, HEAD_BYTES))).digest("hex");
}

function readOnce(path: string, from?: { offset: number; head: string }): NativeRead | null {
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd, { bigint: true });
    const size = Number(before.size);
    if (size > MAX_BYTES) throw new Error("Native session exceeds 64 MiB");
    const start =
      from && from.offset > 0 && from.offset <= size && fingerprint(fd, from.offset) === from.head
        ? from.offset
        : 0;
    const bytes = readRange(fd, start, Math.min(size, MAX_BYTES) - start);
    const after = fstatSync(fd, { bigint: true });
    if (jsonlRevision(before) !== jsonlRevision(after)) return null;
    // Complete lines only, so an append never splits a record or a UTF-8 sequence.
    const complete = bytes.lastIndexOf(0x0a) + 1;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, complete));
    const offset = start + complete;
    return {
      revision: jsonlRevision(after),
      text,
      offset,
      head: fingerprint(fd, offset),
      appended: start > 0,
    };
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Native session is not valid UTF-8");
    throw error;
  } finally {
    closeSync(fd);
  }
}

export async function readJsonl(path: string, from?: { offset: number; head: string }): Promise<NativeRead> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const read = readOnce(path, from);
    if (read) return read;
    await sleep(25);
  }
  throw new Error("Native session changed while reading; try again");
}

function looksLikeBlob(value: string): boolean {
  return (
    value.length > BLOB_BYTES &&
    (value.startsWith("data:") || !/\s/.test(value.slice(0, 256)))
  );
}

/** Blank binary payloads that parsers render as placeholders anyway. */
function stripBlobs(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(stripBlobs);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  delete record.encrypted_content;
  for (const [key, item] of Object.entries(record)) {
    if (["data", "image_url", "url", "signature"].includes(key) && typeof item === "string" && looksLikeBlob(item))
      record[key] = "";
    else stripBlobs(item);
  }
}

/** Row kinds a parser never reads, recognizable before parsing the line. */
function droppableKind(provider: NativeSessionProvider, line: string): boolean {
  const head = line.slice(0, 160);
  if (provider === "pi" || provider === "omp") return head.includes('"type":"custom"');
  if (provider === "codex") return head.includes('"type":"event_msg"') || head.includes('"type":"compacted"');
  return false;
}

const pick = (record: Record<string, unknown>, keep: (key: string) => boolean) => {
  for (const key of Object.keys(record)) if (!keep(key)) delete record[key];
};

/** Drop what the transcript parsers never read: extension events, duplicate tool output and base64. */
export function compactLine(provider: NativeSessionProvider, line: string): string | null {
  if (line.length < COMPACT_LINE_BYTES && !droppableKind(provider, line)) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = typeof record.type === "string" ? record.type : "";
  if ((provider === "pi" || provider === "omp") && kind === "custom")
    pick(record, (key) => ["type", "id", "parentId", "timestamp"].includes(key));
  else if (provider === "codex" && kind === "event_msg") {
    const payload = record.payload as Record<string, unknown> | undefined;
    if (payload && typeof payload === "object") {
      if (payload.type === "task_started") pick(payload, (key) => key === "type" || key === "turn_id");
      else if (payload.type !== "user_message") pick(payload, (key) => key === "type");
    }
  } else if (provider === "codex" && kind === "compacted") delete record.payload;
  else if (provider === "claude") delete record.toolUseResult;
  stripBlobs(record);
  return JSON.stringify(record);
}

export function compactText(provider: NativeSessionProvider, text: string): string {
  let changed = false;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const compact = compactLine(provider, lines[index]);
    if (compact !== null) {
      lines[index] = compact;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : text;
}

const jsonText = (text: unknown) => {
  try {
    return typeof text === "string" ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/** One consistent snapshot of an OpenCode conversation as `{session, messages:[{info, parts}]}`. */
export function readOpenCode(source: NativeSource, path: string, id: string): NativeRead {
  const db = openOpenCode(path);
  try {
    db.exec("BEGIN");
    try {
      const row = db.prepare(`${OPENCODE_SESSIONS} AND s.id = ?`).get(id);
      const file = row && openCodeRow(source, path, row as Record<string, unknown>);
      if (!file) throw new Error("Native session is no longer available");
      const session = db
        .prepare("SELECT id, directory, title, time_created, model FROM session WHERE id = ?")
        .get(id) as Record<string, unknown>;
      const messages: { id: string; timeCreated: number; info: unknown; parts: Record<string, unknown>[] }[] = [];
      const index = new Map<string, number>();
      for (const message of db
        .prepare("SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id")
        .all(id)) {
        index.set(String(message.id), messages.length);
        messages.push({ id: String(message.id), timeCreated: Number(message.time_created), info: jsonText(message.data), parts: [] });
      }
      let size = 0;
      for (const part of db
        .prepare("SELECT id, message_id, data FROM part WHERE session_id = ? ORDER BY time_created, id")
        .all(id)) {
        size += String(part.data ?? "").length;
        if (size > MAX_BYTES) throw new Error("Native session exceeds 64 MiB");
        const at = index.get(String(part.message_id));
        if (at === undefined) continue;
        const data = jsonText(part.data);
        messages[at].parts.push({ ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}), id: String(part.id) });
      }
      const text = JSON.stringify({
        session: {
          id: session.id,
          directory: session.directory,
          title: session.title ?? null,
          timeCreated: Number(session.time_created),
          model: session.model == null ? null : jsonText(session.model),
        },
        messages,
      });
      return { revision: file.revision, text, offset: 0, head: "", appended: false };
    } finally {
      db.exec("COMMIT");
    }
  } finally {
    db.close();
  }
}

/**
 * Reads complete history for parsing, reusing the last complete JSONL prefix
 * when the file only grew. The cache key is the source identity.
 */
export class NativeReader {
  private cache = new Map<string, { text: string; offset: number; head: string }>();
  constructor(private readonly limit = 32) {}

  async read(source: NativeSource, file: NativeSessionFile): Promise<{ revision: string; content: string }> {
    if (source.storage.kind === "sqlite") {
      const read = readOpenCode(source, file.path, file.providerSessionId);
      return { revision: read.revision, content: read.text };
    }
    const key = file.path;
    const cached = this.cache.get(key);
    const read = await readJsonl(file.path, cached && { offset: cached.offset, head: cached.head });
    const text = compactText(file.provider, read.text);
    const content = read.appended && cached ? cached.text + text : text;
    this.cache.delete(key);
    this.cache.set(key, { text: content, offset: read.offset, head: read.head });
    if (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value!);
    return { revision: read.revision, content };
  }

  /** Complete-line prefix of a JSONL source, for identifying records written before `size`. */
  async prefix(file: NativeSessionFile, size: number): Promise<string> {
    const fd = openSync(file.path, "r");
    try {
      const bytes = readRange(fd, 0, Math.min(size, MAX_BYTES));
      return compactText(file.provider, bytes.subarray(0, bytes.lastIndexOf(0x0a) + 1).toString("utf8"));
    } finally {
      closeSync(fd);
    }
  }

  forget(path: string): void {
    this.cache.delete(path);
  }
}
