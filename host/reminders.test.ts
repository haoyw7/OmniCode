import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostReminders, type ReminderSession } from "./reminders";

const roots: string[] = [];
const services: HostReminders[] = [];
function directory() { const root = mkdtempSync(join(tmpdir(), "omnicode-reminders-")); roots.push(root); return root; }
const sessions = new Map<string, ReminderSession>();
function saved(id: string, cwd = `/${id}`) { sessions.set(id, { title: `Title ${id}`, harness: "codex", cwd, saved: true }); }
function create(root = directory(), desktop?: string) { const service = new HostReminders(root, id => sessions.get(id), () => desktop); services.push(service); return service; }
afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  sessions.clear();
});

it("claims due reminders once, across restarts, and keeps them visible", () => {
  saved("first"); saved("second");
  const root = directory();
  let reminders = create(root);
  reminders.set({ sessionIds: ["first"], dueAt: 200 }, 100);
  reminders.set({ sessionIds: ["second"], dueAt: 400 }, 100);
  expect(reminders.nextDueAt()).toBe(200);
  expect(reminders.claimDue({ sessionIds: ["first", "second"] }, 199)).toEqual([]);
  expect(reminders.claimDue({ sessionIds: ["first", "second"] }, 200).map(item => item.sessionId)).toEqual(["first"]);
  expect(reminders.claimDue({ sessionIds: ["first", "second"] }, 300)).toEqual([]);
  reminders.close(); services.splice(0);
  // A Host restart after its scheduled time catches the missed reminder only.
  reminders = create(root);
  expect(reminders.nextDueAt()).toBe(400);
  expect(reminders.claimDue({ sessionIds: ["first", "second"] }, 900).map(item => item.cwd)).toEqual(["/second"]);
  expect(reminders.list().map(item => [item.sessionId, item.firedAt])).toEqual([["first", 200], ["second", 900]]);
});

it("waits for the client to resolve delivery policy before claiming", () => {
  saved("muted"); saved("timed");
  const reminders = create();
  reminders.set({ sessionIds: ["muted", "timed"], dueAt: 200 }, 100);
  expect(reminders.claimDue({ sessionIds: [] }, 300)).toEqual([]);
  expect(reminders.claimDue({ sessionIds: ["muted"] }, 300).map(item => item.sessionId)).toEqual(["muted"]);
  expect(reminders.list().find(item => item.sessionId === "timed")!.firedAt).toBeNull();
});

it("rescheduling rearms and an old banner cannot clear the newer time", () => {
  saved("session");
  const reminders = create();
  reminders.set({ sessionIds: ["session"], dueAt: 200 }, 100);
  expect(reminders.claimDue({ sessionIds: ["session"] }, 200)).toHaveLength(1);
  reminders.set({ sessionIds: ["session"], dueAt: 500 }, 200);
  reminders.clear({ sessionIds: ["session"], expectedDueAt: 200 });
  expect(reminders.list()).toMatchObject([{ dueAt: 500, firedAt: null }]);
  reminders.clear({ sessionIds: ["session"], expectedDueAt: 500 });
  expect(reminders.list()).toEqual([]);
});

it("rejects unsaved or past batches without partial writes and drops deleted conversations", () => {
  saved("session"); saved("gone");
  sessions.set("draft", { title: "", harness: "codex", cwd: "/draft", saved: false });
  const reminders = create();
  expect(() => reminders.set({ sessionIds: ["session", "draft"], dueAt: 200 }, 100)).toThrow("must be saved");
  expect(() => reminders.set({ sessionIds: ["session"], dueAt: 100 }, 100)).toThrow("in the future");
  expect(() => reminders.set({ sessionIds: ["../x"], dueAt: 200 }, 100)).toThrow("Invalid session id");
  expect(reminders.list()).toEqual([]);
  reminders.set({ sessionIds: ["session", "gone"], dueAt: 200 }, 100);
  sessions.delete("gone");
  expect(reminders.list().map(item => item.sessionId)).toEqual(["session"]);
});

it("imports desktop reminders once without writing the legacy database", () => {
  saved("kept"); saved("fired");
  const desktop = directory();
  const db = new DatabaseSync(join(desktop, "omnicode.db"));
  db.exec("CREATE TABLE session_reminders (session_id TEXT PRIMARY KEY, due_at INTEGER NOT NULL, fired_at INTEGER)");
  db.prepare("INSERT INTO session_reminders VALUES (?,?,?)").run("kept", 500, null);
  db.prepare("INSERT INTO session_reminders VALUES (?,?,?)").run("fired", 300, 300);
  db.prepare("INSERT INTO session_reminders VALUES (?,?,?)").run("never-imported", 300, null);
  try {
    const reminders = create(directory(), desktop);
    expect(reminders.list().map(item => [item.sessionId, item.firedAt])).toEqual([["fired", 300], ["kept", null]]);
    reminders.clear({ sessionIds: ["kept"] });
    // A cleared reminder does not come back from the retained source table.
    expect(reminders.list().map(item => item.sessionId)).toEqual(["fired"]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_reminders").get()!.count).toBe(3);
  } finally { db.close(); }
});
