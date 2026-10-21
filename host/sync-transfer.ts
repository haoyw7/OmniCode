import { randomUUID } from "node:crypto";
import type {
  SessionSync,
  SessionSyncChunk,
  SessionSyncResponse,
} from "../src/features/connections/model/protocol";

// The desktop rejects host responses over 16 MiB. Syncs above the inline limit
// are served as pieces of one serialized revision, each well under that cap
// after JSON string escaping, so neither a long transcript nor a single huge
// block can produce an oversized response.
export const INLINE_SYNC_BYTES = 4 * 1024 * 1024;
export const SYNC_CHUNK_BYTES = 4 * 1024 * 1024;
const TRANSFER_TTL_MS = 2 * 60_000;
const MAX_TRANSFERS = 8;

const encodedBytes = (value: string) =>
  Buffer.byteLength(JSON.stringify(value));

export class SyncTransfers {
  private transfers = new Map<
    string,
    { sessionId: string; text: string; expires: number; chunk: number }
  >();

  constructor(
    private readonly limits = {
      inline: INLINE_SYNC_BYTES,
      chunk: SYNC_CHUNK_BYTES,
    },
  ) {}

  respond(sessionId: string, sync: SessionSync, maxBytes?: number): SessionSyncResponse {
    const inline = maxBytes ?? this.limits.inline;
    // UTF-8 uses at most 3 bytes per UTF-16 unit; skip measuring small syncs.
    if (sync.kind === "unchanged") return sync;
    const text = JSON.stringify(sync);
    if (
      text.length * 3 <= inline ||
      Buffer.byteLength(text) <= inline
    )
      return sync;
    this.prune();
    const transfer = randomUUID();
    this.transfers.set(transfer, {
      sessionId,
      text,
      chunk: maxBytes ?? this.limits.chunk,
      expires: Date.now() + TRANSFER_TTL_MS,
    });
    return { kind: "chunked", transfer, length: text.length };
  }

  chunk(sessionId: string, transfer: string, offset: number): SessionSyncChunk {
    const entry = this.transfers.get(transfer);
    if (!entry || entry.sessionId !== sessionId || entry.expires < Date.now())
      throw new Error("Session transfer expired; reload the session");
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > entry.text.length
    )
      throw new Error("Invalid session transfer offset");
    // Transcript JSON usually encodes near one byte per UTF-16 unit; shrink
    // the piece when escaping or non-ASCII text makes it larger.
    let end = Math.min(
      entry.text.length,
      offset + Math.max(1, Math.floor((entry.chunk * 2) / 3)),
    );
    while (
      end - offset > 1 &&
      encodedBytes(entry.text.slice(offset, end)) > entry.chunk
    )
      end = offset + Math.ceil((end - offset) / 2);
    // Never split a surrogate pair: a lone surrogate is not valid JSON text
    // for the desktop's native parser.
    const code = entry.text.charCodeAt(end - 1);
    if (
      end < entry.text.length &&
      end - offset > 1 &&
      code >= 0xd800 &&
      code <= 0xdbff
    )
      end--;
    const data = entry.text.slice(offset, end);
    entry.expires = Date.now() + TRANSFER_TTL_MS;
    if (end === entry.text.length) this.transfers.delete(transfer);
    return { data };
  }

  private prune() {
    const now = Date.now();
    for (const [id, entry] of this.transfers)
      if (entry.expires < now) this.transfers.delete(id);
    while (this.transfers.size >= MAX_TRANSFERS)
      this.transfers.delete(this.transfers.keys().next().value!);
  }
}
