import { randomUUID } from "node:crypto";
import type { BinaryTransfer, BinaryTransferChunk } from "../src/contracts/hostMedia";

const CHUNK_BYTES = 3 * Math.floor((512 * 1024) / 3);
const MAX_BYTES = 80 * 1024 * 1024;
const TTL_MS = 2 * 60_000;

/** Immutable bounded snapshots avoid oversized RPC replies and mixed file revisions. */
export class BinaryTransfers {
  private entries = new Map<string, { scope: string; bytes: Buffer; expires: number }>();

  create(scope: string, bytes: Buffer): BinaryTransfer {
    if (bytes.length > MAX_BYTES) throw new Error("Binary transfer is too large");
    for (const [id, entry] of this.entries) if (entry.expires < Date.now()) this.entries.delete(id);
    let total = [...this.entries.values()].reduce((n, entry) => n + entry.bytes.length, 0);
    while (this.entries.size && (total + bytes.length > MAX_BYTES || this.entries.size >= 8)) {
      const [id, entry] = this.entries.entries().next().value!;
      total -= entry.bytes.length;
      this.entries.delete(id);
    }
    const transfer = randomUUID();
    this.entries.set(transfer, { scope, bytes, expires: Date.now() + TTL_MS });
    return { transfer, size: bytes.length };
  }

  read(scope: string, transfer: unknown, offset: unknown): BinaryTransferChunk {
    const entry = typeof transfer === "string" ? this.entries.get(transfer) : undefined;
    if (!entry || entry.scope !== scope || entry.expires < Date.now()) throw new Error("Binary transfer expired; retry the request");
    if (!Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > entry.bytes.length) throw new Error("Invalid binary transfer offset");
    const end = Math.min(entry.bytes.length, Number(offset) + CHUNK_BYTES);
    entry.expires = Date.now() + TTL_MS;
    return { data: entry.bytes.subarray(Number(offset), end).toString("base64"), offset: end, size: entry.bytes.length };
  }
}
