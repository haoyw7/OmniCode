import { open, readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type {
  TranscriptUsageFormat,
  UsageRecord,
} from "../../src/integrations/harness/core/usage";
import { yieldUsage } from "./files";

const CACHE_VERSION = 1;
interface ScanCache {
  version: number;
  identity: string;
  size: number;
  mtime: number;
  offset: number;
  anchor: string;
  state: unknown;
  records: UsageRecord[];
  malformed: number;
}
const digest = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
const MAX_LINE = 32 * 1024 * 1024;
/** Persist only normalized billing records and parser state, never conversation text. */
export class TranscriptUsageCache {
  constructor(private readonly directory: string) {}

  async read(
    path: string,
    format: TranscriptUsageFormat,
  ): Promise<{ records: UsageRecord[]; malformed: number }> {
    const handle = await open(path, "r");
    try {
      const info = await handle.stat();
      const identity = `${info.dev}:${info.ino}`;
      const cachePath = `${this.directory}/${createHash("sha256").update(path).digest("hex")}.json`;
      let cached: ScanCache | undefined;
      try {
        const value = JSON.parse(
          await readFile(cachePath, "utf8"),
        ) as ScanCache;
        if (
          value.version === CACHE_VERSION &&
          value.identity === identity &&
          value.size <= info.size &&
          value.offset <= value.size &&
          Array.isArray(value.records)
        ) {
          const bytes = Buffer.alloc(Math.min(256, value.offset));
          await handle.read(
            bytes,
            0,
            bytes.length,
            value.offset - bytes.length,
          );
          if (
            digest(bytes) === value.anchor &&
            (value.size < info.size || value.mtime === info.mtimeMs)
          )
            cached = value;
        }
      } catch {
        /* Cache loss never prevents reading native history. */
      }
      if (cached?.size === info.size && cached.mtime === info.mtimeMs)
        return {
          records: cached.records,
          malformed: cached.malformed + (format.malformed?.(cached.state) ?? 0),
        };
      const state = cached?.state ?? format.initial();
      const records = cached?.records ?? [];
      let malformed = cached?.malformed ?? 0;
      let position = cached?.offset ?? 0,
        offset = position,
        pending = "",
        oversized = false;
      const decoder = new StringDecoder("utf8");
      const buffer = Buffer.alloc(256 * 1024);
      while (position < info.size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, info.size - position),
          position,
        );
        if (!bytesRead) break;
        position += bytesRead;
        // Delimit in bytes so resumed UTF-8 and partial final lines stay exact.
        let start = 0;
        for (let index = 0; index < bytesRead; index++) {
          if (buffer[index] !== 10) continue;
          const part = decoder.write(buffer.subarray(start, index));
          if (!oversized) pending += part;
          if (pending.length > MAX_LINE) oversized = true;
          if (
            !oversized &&
            format.usageMarkers.some((marker) => pending.includes(marker))
          ) {
            try {
              records.push(...format.parse(JSON.parse(pending), state));
            } catch {
              malformed++;
            }
          } else if (oversized) malformed++;
          pending = "";
          oversized = false;
          decoder.end();
          start = index + 1;
          offset = position - bytesRead + start;
        }
        if (!oversized)
          pending += decoder.write(buffer.subarray(start, bytesRead));
        if (pending.length > MAX_LINE) {
          pending = "";
          oversized = true;
        }
        await yieldUsage();
      }
      const anchorBytes = Buffer.alloc(Math.min(256, offset));
      await handle.read(
        anchorBytes,
        0,
        anchorBytes.length,
        offset - anchorBytes.length,
      );
      const value: ScanCache = {
        version: CACHE_VERSION,
        identity,
        size: info.size,
        mtime: info.mtimeMs,
        offset,
        anchor: digest(anchorBytes),
        state,
        records,
        malformed,
      };
      const after = await handle.stat();
      if (after.size === info.size && after.mtimeMs === info.mtimeMs) {
        try {
          await mkdir(dirname(cachePath), { recursive: true });
          await writeFile(`${cachePath}.tmp`, JSON.stringify(value), {
            mode: 0o600,
          });
          await rename(`${cachePath}.tmp`, cachePath);
        } catch {
          /* A read-only cache directory does not lose usage. */
        }
      }
      return {
        records,
        malformed: malformed + (format.malformed?.(state) ?? 0),
      };
    } finally {
      await handle.close();
    }
  }
}
