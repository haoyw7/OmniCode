import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { ReminderClaim, ReminderClear, ReminderSet, SessionReminder } from "../src/contracts/reminders";
import type { HarnessId } from "../src/contracts/session";

const MAX_DUE_AT = 8_640_000_000_000_000;
const sessionId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw new Error("Invalid session id");
  return value;
};
const sessionIds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Invalid reminder sessions");
  return [...new Set(value.map(sessionId))];
};

export type ReminderSession = { title: string; harness: HarnessId; cwd: string; saved: boolean };

/**
 * Host owns reminder storage and the durable delivery claim. Desktop windows
 * only decide notification policy and show the OS banner for what they claim.
 */
export class HostReminders {
  private db: DatabaseSync;
  constructor(
    directory: string,
    private readonly session: (id: string) => ReminderSession | undefined,
    private readonly desktopDirectory: () => string | undefined,
  ) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, "reminders.db"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS reminders (session_id TEXT PRIMARY KEY, due_at INTEGER NOT NULL CHECK (due_at > 0), fired_at INTEGER, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS reminders_pending_idx ON reminders(due_at) WHERE fired_at IS NULL;
      CREATE TABLE IF NOT EXISTS reminder_imports (source TEXT PRIMARY KEY, imported_at INTEGER NOT NULL);`);
  }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /** Reads the old desktop table once; the source database is never written. */
  private importDesktop() {
    const directory = this.desktopDirectory();
    if (!directory) return;
    const sourcePath = join(realpathSync(directory), "omnicode.db");
    if (!existsSync(sourcePath)) return;
    const key = createHash("sha256").update(sourcePath).digest("hex");
    if (this.db.prepare("SELECT 1 FROM reminder_imports WHERE source=?").get(key)) return;
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      const rows = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_reminders'").get()
        ? source.prepare("SELECT session_id, due_at, fired_at FROM session_reminders").all() : [];
      this.transaction(() => {
        for (const row of rows) {
          const id = String(row.session_id);
          // Conversations that never reached Host have nothing to reopen.
          if (!this.session(id)?.saved) continue;
          this.db.prepare("INSERT OR IGNORE INTO reminders VALUES (?,?,?,?)")
            .run(id, Number(row.due_at), row.fired_at == null ? null : Number(row.fired_at), Date.now());
        }
        this.db.prepare("INSERT INTO reminder_imports VALUES (?,?)").run(key, Date.now());
      });
    } finally { source.close(); }
  }

  list(): SessionReminder[] {
    this.importDesktop();
    return this.rows();
  }

  private rows(): SessionReminder[] {
    const result: SessionReminder[] = [];
    for (const row of this.db.prepare("SELECT session_id, due_at, fired_at FROM reminders ORDER BY due_at, session_id").all()) {
      const id = String(row.session_id);
      const session = this.session(id);
      // Deleted conversations take their reminder with them.
      if (!session) { this.db.prepare("DELETE FROM reminders WHERE session_id=?").run(id); continue; }
      result.push({ sessionId: id, dueAt: Number(row.due_at), firedAt: row.fired_at == null ? null : Number(row.fired_at),
        title: session.title, harness: session.harness, cwd: session.cwd });
    }
    return result;
  }

  set(input: ReminderSet, now = Date.now()): void {
    this.importDesktop();
    const ids = sessionIds(input?.sessionIds);
    const dueAt = input?.dueAt;
    if (typeof dueAt !== "number" || !Number.isInteger(dueAt) || dueAt <= now || dueAt > MAX_DUE_AT) throw new Error("Choose a reminder time in the future.");
    this.transaction(() => {
      for (const id of ids) {
        if (!this.session(id)?.saved) throw new Error("This conversation must be saved before adding a reminder.");
        this.db.prepare(`INSERT INTO reminders VALUES (?,?,NULL,?) ON CONFLICT(session_id)
          DO UPDATE SET due_at=excluded.due_at, fired_at=NULL, updated_at=excluded.updated_at`).run(id, dueAt, now);
      }
    });
  }

  /** `expectedDueAt` keeps an old banner from clearing a newer reminder. */
  clear(input: ReminderClear): void {
    this.importDesktop();
    const ids = sessionIds(input?.sessionIds);
    const expected = input?.expectedDueAt ?? null;
    if (expected !== null && (typeof expected !== "number" || !Number.isInteger(expected))) throw new Error("Invalid reminder time");
    this.transaction(() => {
      for (const id of ids) this.db.prepare("DELETE FROM reminders WHERE session_id=? AND (? IS NULL OR due_at=?)").run(id, expected, expected);
    });
  }

  /** Claims before delivery, so restarts and other windows never repeat a banner. */
  claimDue(input: ReminderClaim, now = Date.now()): SessionReminder[] {
    const eligible = new Set(sessionIds(input?.sessionIds));
    this.importDesktop();
    return this.transaction(() => {
      const due = this.rows().filter(reminder => reminder.firedAt === null && reminder.dueAt <= now && eligible.has(reminder.sessionId));
      for (const reminder of due) {
        this.db.prepare("UPDATE reminders SET fired_at=? WHERE session_id=? AND due_at=? AND fired_at IS NULL").run(now, reminder.sessionId, reminder.dueAt);
        reminder.firedAt = now;
      }
      return due;
    });
  }

  /** The earliest unclaimed time, for clients to wake exactly when one is due. */
  nextDueAt(): number | null {
    const row = this.db.prepare("SELECT MIN(due_at) AS due FROM reminders WHERE fired_at IS NULL").get();
    return row?.due == null ? null : Number(row.due);
  }

  close() { this.db.close(); }
}
