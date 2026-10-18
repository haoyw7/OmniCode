import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Note, NoteUpsert } from "../src/features/notes/notesText";
import type { NoteImageAsset } from "../src/features/notes/noteImagesText";

export const NOTE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
const trim = (s: string) =>
  s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
const chars = (s: string, count: number) => [...s].slice(0, count).join("");

function validateId(value: unknown, label = "note"): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error(`Invalid ${label} id`);
}

/** Match Rust Path::components: internal dots/repeated separators are normalized,
 * but roots, parent components and a leading current-directory component fail. */
export function validateNoteAssetPath(asset: unknown): string {
  if (
    typeof asset !== "string" ||
    !asset.startsWith("/") ||
    asset.startsWith("//")
  )
    throw new Error("Invalid note image path");
  const segments = asset.slice(1).split("/");
  if (segments[0] === "." || segments.includes(".."))
    throw new Error("Invalid note image path");
  const parts = segments.filter((part) => part && part !== ".");
  if (parts.length !== 3 || parts[0] !== "note-assets")
    throw new Error("Invalid note image path");
  validateId(parts[1]);
  if (!/^[A-Za-z0-9_.-]+$/.test(parts[2]))
    throw new Error("Invalid note image path");
  return join(...parts);
}

function normalizeTags(inputs: string[]): string[] {
  const tags: string[] = [];
  for (const input of inputs) {
    const tag = chars(
      trim(input)
        .replace(/^#+/, "")
        .split(/\p{White_Space}+/u)
        .filter(Boolean)
        .join("-")
        .toLowerCase(),
      48,
    ).replace(/-+$/, "");
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === 20) break;
  }
  return tags;
}
const slugWords = (title: string) =>
  title
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function readNote(row: Record<string, unknown>): Note {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row.tags_json));
    if (Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string"))
      tags = parsed;
  } catch {
    /* Rust treats invalid stored tags as empty. */
  }
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    body: String(row.body),
    tags,
    ...(row.source_session_id != null
      ? { sourceSessionId: String(row.source_session_id) }
      : {}),
    ...(row.source_cwd != null ? { sourceCwd: String(row.source_cwd) } : {}),
    slugPending: !!row.slug_pending,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Only owns the notes schema. Pairing changes select a new store on the next RPC;
 * a broken paired directory is an error, never a silent headless fallback. */
export class HostNotes {
  private connection?: { db: DatabaseSync; directory: string; path: string };
  constructor(
    private readonly hostDirectory: string,
    private readonly desktopDirectory: () => string | undefined,
  ) {}

  private storage() {
    const desktop = this.desktopDirectory();
    const directory = resolve(desktop || this.hostDirectory);
    const path = join(directory, desktop ? "monocode.db" : "notes.db");
    if (this.connection?.path === path) return this.connection;
    this.close();
    if (!desktop) mkdirSync(directory, { recursive: true });
    const db = new DatabaseSync(path);
    try {
      db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]',
          source_session_id TEXT, source_cwd TEXT, slug_pending INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS notes_updated_idx ON notes (updated_at DESC, id);`);
      const columns = db.prepare("PRAGMA table_info(notes)").all();
      if (!columns.some((column) => column.name === "tags_json"))
        db.exec(
          "ALTER TABLE notes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'",
        );
      if (!columns.some((column) => column.name === "slug_pending"))
        db.exec(
          "ALTER TABLE notes ADD COLUMN slug_pending INTEGER NOT NULL DEFAULT 0",
        );
    } catch (error) {
      db.close();
      throw error;
    }
    return (this.connection = { db, directory, path });
  }

  list(): Note[] {
    return this.storage()
      .db.prepare("SELECT * FROM notes ORDER BY updated_at DESC, id ASC")
      .all()
      .map(readNote);
  }
  get(id: unknown): Note | null {
    validateId(id);
    const row = this.storage()
      .db.prepare("SELECT * FROM notes WHERE id = ?")
      .get(id);
    return row ? readNote(row) : null;
  }
  upsert(input: unknown): Note {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid note");
    const value = input as Record<string, unknown>;
    validateId(value.id);
    if (
      typeof value.title !== "string" ||
      typeof value.body !== "string" ||
      (value.tags !== undefined &&
        (!Array.isArray(value.tags) ||
          !value.tags.every((tag) => typeof tag === "string"))) ||
      [value.sourceCwd, value.sourceSessionId].some(
        (field) => field != null && typeof field !== "string",
      ) ||
      (value.finalizeSlug !== undefined &&
        typeof value.finalizeSlug !== "boolean")
    )
      throw new Error("Invalid note");
    const note = value as NoteUpsert;
    if (note.sourceSessionId) validateId(note.sourceSessionId, "session");
    if (Buffer.byteLength(note.body) > 1_000_000)
      throw new Error("Note is too large");
    const title = trim(chars(trim(note.title), 200)) || "Untitled";
    const body = note.body.replace(/\r\n?/g, "\n");
    const tags = normalizeTags(note.tags ?? []);
    const sourceCwd =
      note.sourceCwd == null ? undefined : trim(note.sourceCwd) || undefined;
    const sourceSessionId =
      note.sourceSessionId == null
        ? undefined
        : trim(note.sourceSessionId) || undefined;
    const { db } = this.storage();
    // Reserve the writer before reading the old note and allocating its slug,
    // including when the desktop is writing through its own SQLite connection.
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM notes WHERE id = ?").get(note.id);
      const existing = row ? readNote(row) : null;
      const now = Date.now();
      const slugPending = existing
        ? existing.slugPending &&
          !(
            note.finalizeSlug &&
            !/^untitled(?:-[0-9]+)?$/.test(slugWords(title))
          )
        : !trim(note.title);
      const slug =
        !existing || (existing.slugPending && !slugPending)
          ? this.uniqueSlug(db, title)
          : existing.slug;
      const saved: Note = {
        id: note.id,
        title,
        body,
        tags,
        slug,
        slugPending,
        ...((existing?.sourceSessionId ??
          (!existing ? sourceSessionId : undefined)) !== undefined
          ? { sourceSessionId: existing?.sourceSessionId ?? sourceSessionId }
          : {}),
        ...((sourceCwd ?? existing?.sourceCwd) !== undefined
          ? { sourceCwd: sourceCwd ?? existing?.sourceCwd }
          : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt:
          existing &&
          title === existing.title &&
          body === existing.body &&
          JSON.stringify(tags) === JSON.stringify(existing.tags)
            ? existing.updatedAt
            : now,
      };
      db.prepare(
        `INSERT INTO notes (id, slug, title, body, tags_json, source_session_id, source_cwd, slug_pending, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, title=excluded.title, body=excluded.body,
          tags_json=excluded.tags_json, source_cwd=excluded.source_cwd, slug_pending=excluded.slug_pending, updated_at=excluded.updated_at`,
      ).run(
        saved.id,
        saved.slug,
        saved.title,
        saved.body,
        JSON.stringify(tags),
        saved.sourceSessionId ?? null,
        saved.sourceCwd ?? null,
        Number(saved.slugPending),
        saved.createdAt,
        saved.updatedAt,
      );
      db.exec("COMMIT");
      return saved;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  private uniqueSlug(db: DatabaseSync, title: string) {
    const base = slugWords(title).slice(0, 48).replace(/-+$/, "") || "note";
    for (let index = 0; index < 1000; index++) {
      const slug = index ? `${base}-${index + 1}` : base;
      if (!db.prepare("SELECT 1 FROM notes WHERE slug = ?").get(slug))
        return slug;
    }
    return `${base}-${Date.now()}`;
  }
  delete(id: unknown): void {
    validateId(id);
    const { db, directory } = this.storage();
    db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    // As on desktop, the deletion remains authoritative if cleanup fails.
    try {
      const assets = this.contained(directory, join(directory, "note-assets"));
      rmSync(join(assets, id), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  private contained(directory: string, path: string) {
    const root = realpathSync(directory);
    const actual = realpathSync(path);
    const rel = relative(root, actual);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Invalid note image path");
    return actual;
  }
  image(asset: unknown): { mime: string; data: string } {
    const path = validateNoteAssetPath(asset);
    const { directory } = this.storage();
    // A valid lexical path must not escape through an asset-directory symlink.
    const assets = this.contained(directory, join(directory, "note-assets"));
    const actual = this.contained(assets, join(directory, path));
    const fd = openSync(actual, "r");
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) throw new Error("Note image was not found");
      if (info.size > NOTE_IMAGE_MAX_BYTES)
        throw new Error("Image is too large (maximum 20 MB).");
      return {
        mime:
          MIME[extname(actual).slice(1).toLowerCase()] ??
          "application/octet-stream",
        data: readFileSync(fd).toString("base64"),
      };
    } finally {
      closeSync(fd);
    }
  }
  saveImage(noteId: unknown, name: unknown, data: unknown): NoteImageAsset {
    validateId(noteId);
    if (typeof name !== "string" || !name || name.includes("\0"))
      throw new Error("Invalid image name");
    const displayName = name.split(/[\\/]/).at(-1)!;
    const extension = extname(displayName).slice(1).toLowerCase();
    if (!MIME[extension])
      throw new Error("Image must be a PNG, JPG, GIF, WebP, or SVG file.");
    if (
      typeof data !== "string" ||
      data.length > Math.ceil(NOTE_IMAGE_MAX_BYTES / 3) * 4
    )
      throw new Error("Image is too large (maximum 20 MB).");
    if (data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
      throw new Error("Invalid image data");
    const bytes = Buffer.from(data, "base64");
    if (bytes.toString("base64") !== data)
      throw new Error("Invalid image data");
    if (bytes.length > NOTE_IMAGE_MAX_BYTES)
      throw new Error("Image is too large (maximum 20 MB).");
    const stem =
      chars(
        [...displayName.slice(0, -(extension.length + 1))]
          .map((c) => (/^[A-Za-z0-9_-]$/.test(c) ? c : "-"))
          .join(""),
        80,
      ).replace(/^-+|-+$/g, "") || "image";
    const { directory } = this.storage();
    const assets = join(directory, "note-assets");
    mkdirSync(assets, { recursive: true });
    this.contained(directory, assets);
    const dir = join(assets, noteId);
    mkdirSync(dir, { recursive: true });
    this.contained(directory, dir);
    const stamp =
      BigInt(Date.now()) * 1_000_000n + (process.hrtime.bigint() % 1_000_000n);
    const storedName = `${stamp}-${stem}.${extension}`;
    writeFileSync(join(dir, storedName), bytes, { flag: "wx" });
    return {
      name: displayName,
      markdownPath: `/note-assets/${noteId}/${storedName}`,
    };
  }
  close(): void {
    this.connection?.db.close();
    this.connection = undefined;
  }
}
