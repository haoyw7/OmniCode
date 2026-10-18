import { closeSync, fsyncSync, mkdirSync, openSync, readSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HostStore } from "./store";

const MAX_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
}

/** Immutable Host assets for cross-device backgrounds, separate from session attachments. */
export class HostPreferenceAssets {
  private readonly directory: string;
  constructor(private readonly store: HostStore) {
    this.directory = join(dirname(store.attachmentDir), "preference-assets");
    store.db.exec("CREATE TABLE IF NOT EXISTS preference_assets (id TEXT PRIMARY KEY, size INTEGER NOT NULL, mime_type TEXT NOT NULL, complete INTEGER NOT NULL DEFAULT 0)");
  }

  private id(value: unknown): string {
    if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid preference asset ID");
    return value.toLowerCase();
  }

  upload(input: Record<string, unknown>): { offset: number } {
    const id = this.id(input.id);
    if (!Number.isSafeInteger(input.size) || Number(input.size) <= 0 || Number(input.size) > MAX_BYTES
      || !Number.isSafeInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) >= Number(input.size)
      || typeof input.mimeType !== "string" || !MIME_TYPES.has(input.mimeType)
      || typeof input.data !== "string" || input.data.length > Math.ceil(CHUNK_BYTES / 3) * 4
      || !input.data.length || input.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw new Error("Invalid preference asset chunk");
    const size = Number(input.size);
    const offset = Number(input.offset);
    const bytes = Buffer.from(input.data, "base64");
    if (!bytes.length || bytes.length > CHUNK_BYTES || offset + bytes.length > size || bytes.toString("base64") !== input.data)
      throw new Error("Invalid preference asset chunk size");
    const previous = this.store.db.prepare("SELECT * FROM preference_assets WHERE id=?").get(id);
    if (previous && (Number(previous.size) !== size || previous.mime_type !== input.mimeType)) throw new Error("Preference asset metadata cannot change");
    if (!previous && offset !== 0) throw new Error("Preference asset chunks are out of order");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, id);
    // Metadata is created before the file. A process crash can safely resume at offset zero.
    this.store.db.prepare("INSERT OR IGNORE INTO preference_assets(id,size,mime_type) VALUES (?,?,?)").run(id, size, input.mimeType);
    let fd: number;
    try { fd = openSync(path, "r+", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || offset !== 0) throw error;
      fd = openSync(path, "wx+", 0o600);
    }
    try {
      const length = statSync(path).size;
      if (length === offset) {
        let written = 0;
        while (written < bytes.length) {
          const count = writeSync(fd, bytes, written, bytes.length - written, offset + written);
          if (!count) throw new Error("Preference asset write was incomplete");
          written += count;
        }
      } else if (length >= offset + bytes.length) {
        const existing = Buffer.alloc(bytes.length);
        const count = readSync(fd, existing, 0, existing.length, offset);
        if (count !== bytes.length || !existing.equals(bytes)) throw new Error("Preference asset retry does not match uploaded bytes");
      } else throw new Error("Preference asset chunks are out of order");
      fsyncSync(fd);
      if (offset + bytes.length === size) {
        if (statSync(path).size !== size) throw new Error("Preference asset size does not match");
        const header = Buffer.alloc(Math.min(16, size));
        readSync(fd, header, 0, header.length, 0);
        if (imageMime(header) !== input.mimeType) throw new Error("Preference asset is not a supported image");
        this.store.db.prepare("UPDATE preference_assets SET complete=1 WHERE id=?").run(id);
      }
      return { offset: offset + bytes.length };
    } catch (error) {
      // Invalid MIME cannot become a readable asset, even if all bytes arrived.
      if (error instanceof Error && error.message === "Preference asset is not a supported image") {
        closeSync(fd);
        fd = -1;
        unlinkSync(path);
        this.store.db.prepare("DELETE FROM preference_assets WHERE id=?").run(id);
      }
      throw error;
    } finally { if (fd !== -1) closeSync(fd); }
  }

  read(input: Record<string, unknown>): { data: string; offset: number; size: number; mimeType: string } {
    const id = this.id(input.id);
    const asset = this.store.db.prepare("SELECT * FROM preference_assets WHERE id=? AND complete=1").get(id);
    if (!asset) throw new Error("Preference asset is missing or incomplete");
    const size = Number(asset.size);
    if (!Number.isSafeInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > size) throw new Error("Invalid preference asset offset");
    const offset = Number(input.offset);
    const path = join(this.directory, id);
    if (statSync(path).size !== size) throw new Error("Preference asset is incomplete");
    const bytes = Buffer.alloc(Math.min(3 * Math.floor(CHUNK_BYTES / 3), size - offset));
    const fd = openSync(path, "r");
    try {
      const count = readSync(fd, bytes, 0, bytes.length, offset);
      if (count !== bytes.length) throw new Error("Preference asset read was incomplete");
      return { data: bytes.toString("base64"), offset: offset + count, size, mimeType: String(asset.mime_type) };
    } finally { closeSync(fd); }
  }
}
