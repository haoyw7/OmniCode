import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostStore } from "./store";
import { importDesktopSessions } from "./desktop-import";
import { readAttachmentChunk } from "./attachments";
import { readdirSync } from "node:fs";
import { HostEngine } from "./engine";
import { vi } from "vitest";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-shared-import-"));
  directories.push(directory);
  const path = join(directory, "desktop.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, harness TEXT, model TEXT,
    model_settings TEXT, runtime_mode TEXT, title TEXT, blocks_json TEXT,
    created_at INTEGER, updated_at INTEGER, provider_session_id TEXT, provider_account_id TEXT,
    archived INTEGER, pinned INTEGER, branch TEXT, execution_cwd TEXT)`);
  const image = join(directory, "picture.png");
  writeFileSync(image, Buffer.from("image bytes"));
  db.prepare(
    "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "legacy",
    directory,
    "codex",
    "codex:test",
    '{"reasoningEffort":"high"}',
    "supervised",
    "Original title",
    JSON.stringify([
      { id: "user", role: "user", text: "Before mobile" },
      {
        id: "image",
        role: "image",
        text: "",
        image: {
          path: image,
          name: "picture.png",
          mimeType: "image/png",
          size: 11,
        },
      },
    ]),
    100,
    200,
    "native-provider",
    "account",
    1,
    1,
    "main",
    directory,
  );
  db.close();
  return { directory, path, store: new HostStore(join(directory, "host.db")) };
}

it.each(["execution_cwd", "worktree_cwd"])("imports an execution directory from the %s database generation", (column) => {
  const { path, store } = fixture();
  const db = new DatabaseSync(path);
  if (column === "worktree_cwd") db.exec("ALTER TABLE sessions RENAME COLUMN execution_cwd TO worktree_cwd");
  db.close();
  try {
    expect(importDesktopSessions(store, path)).toBe(1);
    const session = store.session("legacy").session;
    expect(session.executionCwd).toBe(session.cwd);
    expect(session).not.toHaveProperty("worktreeCwd");
  } finally { store.close(); }
});

it("preserves IDs/provider identity/metadata and makes legacy images readable on mobile", () => {
  const { path, store } = fixture();
  try {
    const before = readFileSync(path);
    expect(importDesktopSessions(store, path)).toBe(1);
    const value = store.session("legacy");
    expect(value).toMatchObject({
      revision: 1,
      status: "idle",
      createdAt: 100,
      updatedAt: 200,
      archived: true,
      pinned: true,
      session: {
        id: "legacy",
        title: "Original title",
        providerSessionId: "native-provider",
        providerAccountId: "account",
        modelSettings: { reasoningEffort: "high" },
      },
    });
    const file = value.session.blocks[1].attachments![0];
    expect(
      readAttachmentChunk(store, {
        sessionId: "legacy",
        id: file.id,
        offset: 0,
      }).data,
    ).toBe(Buffer.from("image bytes").toString("base64"));
    expect(readFileSync(path)).toEqual(before);
    expect(importDesktopSessions(store, path)).toBe(0);
    store.updateSession("legacy", { title: "Changed from phone" });
    expect(importDesktopSessions(store, path)).toBe(0);
    expect(store.session("legacy").session.title).toBe("Changed from phone");
  } finally {
    store.close();
  }
});

it("retains context categories when importing a newer desktop database", () => {
  const { path, store } = fixture();
  const db = new DatabaseSync(path);
  const breakdown = { used: 500, window: 1000, updatedAt: 1234, estimated: true,
    categories: [{ name: "Messages", tokens: 500, kind: "used" }] };
  db.exec("ALTER TABLE sessions ADD COLUMN context_used INTEGER; ALTER TABLE sessions ADD COLUMN context_window INTEGER; ALTER TABLE sessions ADD COLUMN context_breakdown_json TEXT");
  db.prepare("UPDATE sessions SET context_used=500, context_window=1000, context_breakdown_json=?").run(JSON.stringify(breakdown));
  db.close();
  try {
    expect(importDesktopSessions(store, path)).toBe(1);
    expect(store.session("legacy").session.context?.breakdown).toEqual(breakdown);
  } finally { store.close(); }
});

it("does not resurrect deleted imported history on the next startup", () => {
  const { path, store } = fixture();
  try {
    importDesktopSessions(store, path);
    store.deleteSession("legacy");
    expect(importDesktopSessions(store, path)).toBe(0);
    expect(store.sessions()).toEqual([]);
  } finally {
    store.close();
  }
});
it("imports native history as Host-managed once and never bypasses CLI ownership", async () => {
  const { path, store } = fixture();
  const native = {
    provider: "codex",
    providerSessionId: "native-provider",
    path: "/native/session.jsonl",
    revision: "first",
    blockIds: ["user", "image"],
    createdAt: 100,
    updatedAt: 200,
  };
  const source = new DatabaseSync(path);
  source.exec("ALTER TABLE sessions ADD COLUMN native_session_json TEXT");
  source
    .prepare("UPDATE sessions SET native_session_json=?")
    .run(JSON.stringify(native));
  try {
    importDesktopSessions(store, path);
    // Imported links are Host-managed at once; older blockIds become nativeIds.
    expect(store.session("legacy").session.nativeSession).toMatchObject({
      mode: "managed", storage: "jsonl", nativeIds: ["user", "image"],
    });
    importDesktopSessions(store, path);
    expect(readdirSync(store.attachmentDir)).toHaveLength(1);
    const provider = {
      send: vi.fn(),
      bind: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      approve: vi.fn(),
      answer: vi.fn(),
    };
    // Native sources resolve inside the fixture, never in the developer's home.
    const engine = new HostEngine(store, { codex: provider }, undefined, {
      native: { environment: { home: join(store.attachmentDir, "..", "home"), env: {} } },
    });
    try {
      await engine.ready;
      expect(provider.bind).not.toHaveBeenCalled();
      engine.command({
        type: "send",
        sessionId: "legacy",
        commandId: "phone",
        text: "Unsafe continuation",
      });
      // The source is outside every configured provider root: the startup sync
      // fails, and the send waits in the queue instead of invoking the provider.
      await vi.waitFor(() => expect(store.session("legacy").nativeStatus).toMatchObject({
        state: "error",
        message: expect.stringMatching(/^Not a native session in a configured source directory/),
      }));
      expect(store.session("legacy").session.queuedMessages?.map((message) => message.text)).toEqual(["Unsafe continuation"]);
      expect(provider.send).not.toHaveBeenCalled();
    } finally {
      // Workflow assets initialize independently of engine.ready. Finish their
      // writes before the outer fixture closes its store and removes the directory.
      try { await engine.workflows.ready; }
      finally { await engine.close(); }
    }
  } finally {
    source.close();
    store.close();
  }
});

it("rolls back a failed import and allows a repaired source to retry", () => {
  const { path, store, directory } = fixture();
  rmSync(join(directory, "picture.png"));
  try {
    expect(() => importDesktopSessions(store, path)).toThrow("missing image");
    expect(store.sessions()).toEqual([]);
    writeFileSync(join(directory, "picture.png"), "repaired");
    expect(importDesktopSessions(store, path)).toBe(1);
  } finally {
    store.close();
  }
});
