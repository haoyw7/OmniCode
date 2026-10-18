import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HostNotes,
  NOTE_IMAGE_MAX_BYTES,
  validateNoteAssetPath,
} from "./notes";

const roots: string[] = [];
const stores: HostNotes[] = [];
function directory() {
  const root = mkdtempSync(join(tmpdir(), "monocode-notes-"));
  roots.push(root);
  return root;
}
function storage(
  root = directory(),
  desktop: () => string | undefined = () => undefined,
) {
  const notes = new HostNotes(root, desktop);
  stores.push(notes);
  return notes;
}
const input = (id: string, title = "Title", body = "Body") => ({
  id,
  title,
  body,
  tags: [],
});
afterEach(() => {
  for (const notes of stores.splice(0)) notes.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("Host notes", () => {
  it("creates, normalizes and preserves immutable source metadata on updates", () => {
    const notes = storage();
    vi.spyOn(Date, "now").mockReturnValue(100);
    const created = notes.upsert({
      ...input("n1", "  Hello  ", "a\r\nb\rc"),
      sourceCwd: " /work/one ",
      sourceSessionId: "s1",
    });
    expect(created).toMatchObject({
      id: "n1",
      title: "Hello",
      body: "a\nb\nc",
      slug: "hello",
      slugPending: false,
      sourceCwd: "/work/one",
      sourceSessionId: "s1",
      createdAt: 100,
      updatedAt: 100,
    });
    vi.mocked(Date.now).mockReturnValue(200);
    const updated = notes.upsert({
      ...input("n1", "Renamed"),
      sourceSessionId: "s2",
    });
    expect(updated).toMatchObject({
      title: "Renamed",
      slug: "hello",
      sourceCwd: "/work/one",
      sourceSessionId: "s1",
      createdAt: 100,
      updatedAt: 200,
    });
    expect(notes.get("missing")).toBeNull();
    expect(notes.get("n1")).toEqual(updated);
  });
  it("keeps updated_at for unchanged content, normalization and project-only moves", () => {
    const notes = storage();
    vi.spyOn(Date, "now").mockReturnValue(100);
    notes.upsert({ ...input("n1", " Title ", "a\r\nb"), tags: ["#Ideas"] });
    vi.mocked(Date.now).mockReturnValue(200);
    expect(
      notes.upsert({
        ...input("n1", "Title", "a\nb"),
        tags: ["ideas"],
        sourceCwd: "/work/two",
      }),
    ).toMatchObject({ updatedAt: 100, sourceCwd: "/work/two" });
    expect(
      notes.upsert({
        ...input("n1", "Title", "a\nb"),
        tags: ["ideas"],
        sourceCwd: "  ",
      }).sourceCwd,
    ).toBe("/work/two");
    expect(
      notes.upsert({ ...input("n1", "Title", "a\nb"), tags: ["new"] })
        .updatedAt,
    ).toBe(200);
  });
  it("finalizes a pending slug once with a real title, and keeps explicit placeholder slugs", () => {
    const notes = storage();
    expect(notes.upsert(input("n1", " \n")).slugPending).toBe(true);
    const partial = notes.upsert(input("n1", "Plan"));
    expect(partial).toMatchObject({ slug: "untitled", slugPending: true });
    expect(
      notes.upsert({ ...input("n1", "Untitled 22"), finalizeSlug: true })
        .slugPending,
    ).toBe(true);
    const saved = notes.upsert({ ...input("n1", "Plan"), finalizeSlug: true });
    expect(saved).toMatchObject({ slug: "plan", slugPending: false });
    expect(
      notes.upsert({ ...input("n1", "Other"), finalizeSlug: true }).slug,
    ).toBe("plan");
    expect(notes.upsert(input("n2", "Untitled")).slugPending).toBe(false);
    expect(
      notes.upsert({ ...input("n2", "Real title"), finalizeSlug: true }).slug,
    ).toBe("untitled");
  });
  it("allocates unique ASCII slugs, including finalization collisions", () => {
    const notes = storage();
    expect(notes.upsert(input("a", "Hello, World!")).slug).toBe("hello-world");
    expect(notes.upsert(input("b", "Hello World")).slug).toBe("hello-world-2");
    notes.upsert(input("c", ""));
    expect(
      notes.upsert({ ...input("c", "Hello World"), finalizeSlug: true }).slug,
    ).toBe("hello-world-3");
    expect(notes.upsert(input("d", "Ä笔记")).slug).toBe("note");
    expect(notes.upsert(input("e", "x".repeat(60))).slug).toBe("x".repeat(48));
  });
  it("normalizes and bounds tags and titles by Rust Unicode characters", () => {
    const notes = storage();
    const saved = notes.upsert({
      ...input("n1", "  " + "😀".repeat(201)),
      tags: [
        " Ideas ",
        "#Project Docs",
        "ideas",
        "###",
        "#   Spaced  ",
        "😀".repeat(50),
        ...Array.from({ length: 30 }, (_, i) => `t${i}`),
      ],
    });
    expect(saved.title).toBe("😀".repeat(200));
    expect(saved.tags.slice(0, 5)).toEqual([
      "ideas",
      "project-docs",
      "spaced",
      "😀".repeat(48),
      "t0",
    ]);
    expect(saved.tags).toHaveLength(20);
  });
  it("sorts by updated_at then id and rejects invalid IDs, input and byte limits", () => {
    const notes = storage();
    vi.spyOn(Date, "now").mockReturnValue(100);
    notes.upsert(input("b"));
    notes.upsert(input("a"));
    vi.mocked(Date.now).mockReturnValue(200);
    notes.upsert(input("c"));
    expect(notes.list().map((n) => n.id)).toEqual(["c", "a", "b"]);
    for (const id of ["", "../a", "a/b", "a.b", "中文"]) {
      expect(() => notes.get(id)).toThrow(/Invalid note id/);
      expect(() => notes.delete(id)).toThrow(/Invalid note id/);
      expect(() => notes.upsert(input(id))).toThrow(/Invalid note id/);
    }
    expect(() =>
      notes.upsert({ ...input("a"), sourceSessionId: " s1 " }),
    ).toThrow(/Invalid session id/);
    expect(() => notes.upsert({ ...input("a"), tags: [null] })).toThrow(
      /Invalid note/,
    );
    expect(() =>
      notes.upsert(input("a", "Title", "中".repeat(333_334))),
    ).toThrow(/too large/);
  });
  it("shares the desktop WAL database and migrates only notes columns", () => {
    const desktop = directory();
    const db = new DatabaseSync(join(desktop, "monocode.db"));
    try {
      db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE sessions (id TEXT PRIMARY KEY, payload TEXT);
        INSERT INTO sessions VALUES ('s1', 'untouched');
        CREATE TABLE notes (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '', source_session_id TEXT, source_cwd TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        INSERT INTO notes VALUES ('old', 'untitled', 'Untitled', '', NULL, NULL, 1, 2);`);
      const notes = storage(directory(), () => desktop);
      expect(notes.get("old")).toMatchObject({ tags: [], slugPending: false });
      notes.upsert(input("new"));
      expect(
        db.prepare("SELECT title FROM notes WHERE id='new'").get()?.title,
      ).toBe("Title");
      db.prepare("UPDATE notes SET body='Desktop edit' WHERE id='new'").run();
      expect(notes.get("new")?.body).toBe("Desktop edit");
      expect(
        db.prepare("SELECT payload FROM sessions WHERE id='s1'").get()?.payload,
      ).toBe("untouched");
    } finally {
      db.close();
    }
  });
  it("uses notes.db headlessly and switches to paired storage without silently falling back", () => {
    const root = directory(),
      desktop = directory();
    let paired: string | undefined;
    const notes = storage(root, () => paired);
    notes.upsert(input("headless"));
    expect(existsSync(join(root, "notes.db"))).toBe(true);
    expect(existsSync(join(root, "host.db"))).toBe(false);
    paired = desktop;
    expect(notes.list()).toEqual([]);
    notes.upsert(input("desktop"));
    paired = undefined;
    expect(notes.list().map((n) => n.id)).toEqual(["headless"]);
    paired = join(root, "missing");
    expect(() => notes.list()).toThrow();
  });
  it("saves and reads images beside the selected database, then cleans them on deletion", () => {
    const host = directory(),
      desktop = directory();
    const notes = storage(host, () => desktop);
    notes.upsert(input("n1"));
    const image = notes.saveImage(
      "n1",
      "中文 [draft].PNG",
      Buffer.from("image bytes").toString("base64"),
    );
    expect(image.name).toBe("中文 [draft].PNG");
    expect(image.markdownPath).toMatch(
      /^\/note-assets\/n1\/[A-Za-z0-9_.-]+\.png$/,
    );
    expect(
      readFileSync(
        join(desktop, validateNoteAssetPath(image.markdownPath)),
        "utf8",
      ),
    ).toBe("image bytes");
    expect(notes.image(image.markdownPath)).toEqual({
      mime: "image/png",
      data: Buffer.from("image bytes").toString("base64"),
    });
    expect(existsSync(join(host, "note-assets"))).toBe(false);
    notes.delete("n1");
    expect(notes.get("n1")).toBeNull();
    expect(existsSync(join(desktop, "note-assets", "n1"))).toBe(false);
    notes.delete("n1");
  });
  it("rejects traversal and invalid asset paths", () => {
    const notes = storage();
    for (const asset of [
      "note-assets/n1/a.png",
      "//note-assets/n1/a.png",
      "/other/n1/a.png",
      "/note-assets/n1/../a.png",
      "/note-assets/../a.png",
      "/note-assets/n1/a/b.png",
      "/note-assets/n1/a%2f.png",
      "/note-assets/n.1/a.png",
      "/note-assets/n1/..",
      "/note-assets/n1/a\\b.png",
      "/./note-assets/n1/a.png",
    ]) {
      expect(() => validateNoteAssetPath(asset), asset).toThrow();
      expect(() => notes.image(asset), asset).toThrow();
    }
    expect(validateNoteAssetPath("/note-assets/n1/123.png")).toBe(
      join("note-assets", "n1", "123.png"),
    );
    expect(validateNoteAssetPath("/note-assets//n1/./123.png")).toBe(
      join("note-assets", "n1", "123.png"),
    );
  });
  it("rejects symlink escapes when reading, writing and deleting images", () => {
    const root = directory(),
      outside = directory();
    const notes = storage(root);
    mkdirSync(join(root, "note-assets", "n1"), { recursive: true });
    writeFileSync(join(outside, "secret.png"), "secret");
    symlinkSync(
      join(outside, "secret.png"),
      join(root, "note-assets", "n1", "secret.png"),
    );
    expect(() => notes.image("/note-assets/n1/secret.png")).toThrow(
      /Invalid note image path/,
    );
    rmSync(join(root, "note-assets"), { recursive: true });
    symlinkSync(outside, join(root, "note-assets"), "junction");
    expect(() => notes.saveImage("n1", "a.png", "YQ==")).toThrow(
      /Invalid note image path/,
    );
    notes.delete("n1");
    expect(readFileSync(join(outside, "secret.png"), "utf8")).toBe("secret");
  });
  it("rejects invalid uploads and enforces the 20 MiB image limit", () => {
    const notes = storage();
    expect(() => notes.saveImage("n1", "a.txt", "YQ==")).toThrow(
      /Image must be/,
    );
    expect(() => notes.saveImage("../n1", "a.png", "YQ==")).toThrow(
      /Invalid note id/,
    );
    for (const data of ["!", "YQ", "YQ===", "YR=="])
      expect(() => notes.saveImage("n1", "a.png", data)).toThrow(
        /Invalid image data/,
      );
    const max = notes.saveImage(
      "n1",
      "max.png",
      Buffer.alloc(NOTE_IMAGE_MAX_BYTES).toString("base64"),
    );
    expect(
      Buffer.from(notes.image(max.markdownPath).data, "base64"),
    ).toHaveLength(NOTE_IMAGE_MAX_BYTES);
    expect(() =>
      notes.saveImage(
        "n1",
        "too-big.png",
        Buffer.alloc(NOTE_IMAGE_MAX_BYTES + 1).toString("base64"),
      ),
    ).toThrow(/too large/);
  });
});
