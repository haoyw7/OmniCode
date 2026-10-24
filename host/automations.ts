import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Automation, AutomationRun, AutomationRunStatus, AutomationTrigger, AutomationUpsert, DueAutomationRun } from "../src/contracts/automations";
import { HARNESSES, RUNTIME_MODES } from "../src/contracts/session";
import { automationTriggers, nextTriggersRunAt, overdueTriggerOccurrences } from "../src/domain/automationSchedule";
import { REMOTE_PATH_PREFIX } from "../src/contracts/remotePaths";

const terminal = (status: AutomationRunStatus) => !["pending", "running"].includes(status);
const id = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid automation id");
  return value;
};

/**
 * Definitions imported from an older desktop may name another machine's
 * project. They stay listed until the client moves them to that Host, and this
 * Host never runs them against a local path.
 */
export const belongsToAnotherHost = (automation: Pick<Automation, "cwd">) => automation.cwd.startsWith(REMOTE_PATH_PREFIX);
export const ANOTHER_HOST_ERROR = "This automation belongs to another connected Host. Open Automations while that Host is connected to move it there.";

export type AutomationEventClaim = { eventKey: string; eventKind: string; event: string; scheduledFor: number; prompt: string };

/** JSON projections and a durable claim ledger retain the desktop data model. */
export class HostAutomationStore {
  private db: DatabaseSync;
  constructor(directory: string, private readonly desktopDirectory: () => string | undefined) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, "automations.db"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, definition_json TEXT NOT NULL, enabled INTEGER NOT NULL, next_run_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, run_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS automation_runs_history_idx ON automation_runs(automation_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS automation_event_claims (automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, event_key TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(automation_id,event_key));
      CREATE TABLE IF NOT EXISTS automation_imports (source TEXT PRIMARY KEY, imported_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_inbox_sources (automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, provider TEXT NOT NULL, seeded_at INTEGER NOT NULL, PRIMARY KEY(automation_id,provider));
      CREATE TABLE IF NOT EXISTS automation_inbox_seen (automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, event_key TEXT NOT NULL, PRIMARY KEY(automation_id,event_key));`);
  }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private importDesktop() {
    const directory = this.desktopDirectory();
    if (!directory) return;
    const sourcePath = join(realpathSync(directory), "omnicode.db");
    if (!existsSync(sourcePath)) return;
    const key = createHash("sha256").update(sourcePath).digest("hex");
    if (this.db.prepare("SELECT 1 FROM automation_imports WHERE source=?").get(key)) return;
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    const has = (table: string) => !!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    try {
      if (!has("automations")) return;
      this.transaction(() => {
        const imported = new Set<string>();
        for (const row of source.prepare("SELECT * FROM automations").all()) {
          const automation = JSON.parse(String(row.definition_json)) as Automation & { worktreeCwd?: string };
          id(automation.id);
          if (this.get(automation.id)) continue;
          if (automation.executionCwd === undefined && automation.worktreeCwd) automation.executionCwd = automation.worktreeCwd;
          delete automation.worktreeCwd;
          automation.triggers = automationTriggers(automation);
          this.write(automation);
          imported.add(automation.id);
        }
        if (has("automation_runs")) for (const row of source.prepare("SELECT * FROM automation_runs").all()) {
          if (!imported.has(String(row.automation_id))) continue;
          const run = JSON.parse(String(row.run_json)) as AutomationRun;
          id(run.id);
          this.writeRun(run);
          if (run.eventKey) this.db.prepare("INSERT OR IGNORE INTO automation_event_claims VALUES (?,?,?)").run(run.automationId, run.eventKey, run.createdAt);
        }
        if (has("automation_event_claims")) for (const row of source.prepare("SELECT * FROM automation_event_claims").all()) {
          if (imported.has(String(row.automation_id))) this.db.prepare("INSERT OR IGNORE INTO automation_event_claims VALUES (?,?,?)").run(String(row.automation_id), String(row.event_key), Number(row.created_at));
        }
        this.db.prepare("INSERT INTO automation_imports VALUES (?,?)").run(key, Date.now());
      });
    } finally { source.close(); }
  }

  list(): Automation[] {
    this.importDesktop();
    return this.db.prepare("SELECT definition_json FROM automations ORDER BY updated_at DESC,id").all().map(row => JSON.parse(String(row.definition_json)));
  }
  get(automationId: string): Automation | undefined {
    const row = this.db.prepare("SELECT definition_json FROM automations WHERE id=?").get(id(automationId));
    return row ? JSON.parse(String(row.definition_json)) : undefined;
  }
  private write(value: Automation) {
    this.db.prepare(`INSERT INTO automations VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET definition_json=excluded.definition_json,enabled=excluded.enabled,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at`)
      .run(value.id, JSON.stringify(value), Number(value.enabled), value.nextRunAt, value.updatedAt);
  }
  private writeRun(run: AutomationRun) {
    this.db.prepare("INSERT INTO automation_runs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET run_json=excluded.run_json").run(run.id, run.automationId, run.createdAt, JSON.stringify(run));
  }
  private summary(automation: Automation, run: AutomationRun) {
    if (run.createdAt >= (automation.lastRunAt ?? 0)) {
      automation.lastRunAt = run.createdAt;
      automation.lastRunStatus = run.status;
      automation.lastRunError = run.error;
      if (run.sessionId) automation.lastSessionId = run.sessionId;
    }
    this.write(automation);
    this.writeRun(run);
    this.db.prepare("SELECT id,run_json FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC,id DESC").all(automation.id)
      .slice(100).forEach(row => { if (terminal((JSON.parse(String(row.run_json)) as AutomationRun).status)) this.db.prepare("DELETE FROM automation_runs WHERE id=?").run(String(row.id)); });
  }

  upsert(input: unknown, now = Date.now()): Automation {
    this.importDesktop();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid automation");
    const value = input as AutomationUpsert;
    id(value.id);
    if (typeof value.name !== "string" || !value.name.trim() || Buffer.byteLength(value.name) > 200) throw new Error("Automation name is required and must be under 200 characters.");
    if (typeof value.prompt !== "string" || !value.prompt.trim() || Buffer.byteLength(value.prompt) > 1_000_000) throw new Error("Automation prompt is required.");
    if (typeof value.cwd !== "string" || !value.cwd.trim()) throw new Error("Choose a project for this automation.");
    if (belongsToAnotherHost(value)) throw new Error("Save this automation on the Host that owns its project.");
    if (!HARNESSES.includes(value.harness) || typeof value.model !== "string" || !RUNTIME_MODES.includes(value.runtimeMode)) throw new Error("Invalid automation provider or run mode.");
    if (!["current", "existing", "worktree"].includes(value.workspaceMode)) throw new Error("Invalid automation workspace mode.");
    if (value.workspaceMode === "existing" && (!value.executionCwd?.trim() || value.executionCwd.length > 1000)) throw new Error("Choose an existing worktree for this automation.");
    if (typeof value.enabled !== "boolean" || !Number.isInteger(value.missedRunGraceMinutes) || value.missedRunGraceMinutes < 0 || value.missedRunGraceMinutes > 43200) throw new Error("Invalid missed-run grace period.");
    if ((value.sessionFolderId?.length ?? 0) > 80 || (value.modelSettings && Object.values(value.modelSettings).some(entry => typeof entry !== "string"))) throw new Error("Invalid automation settings");
    const triggers = automationTriggers(value);
    if (triggers.length > 20) throw new Error("Too many automation triggers.");
    for (const trigger of triggers) validateTrigger(trigger);
    return this.transaction(() => {
      const previous = this.get(value.id);
      const saved: Automation = { ...value, name: value.name.trim(), triggers, nextRunAt: nextTriggersRunAt(triggers, now),
        executionCwd: value.workspaceMode === "existing" ? value.executionCwd!.trim() : "", sessionFolderId: value.sessionFolderId?.trim() ?? "",
        createdAt: previous?.createdAt ?? now, updatedAt: now,
        lastRunAt: previous?.lastRunAt, lastRunStatus: previous?.lastRunStatus, lastRunError: previous?.lastRunError, lastSessionId: previous?.lastSessionId };
      this.write(saved); return saved;
    });
  }
  delete(automationId: string) {
    this.importDesktop();
    this.db.prepare("DELETE FROM automations WHERE id=?").run(id(automationId));
  }
  runs(automationId: string, includePrompt = false): AutomationRun[] {
    this.importDesktop();
    return this.db.prepare("SELECT run_json FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC,id DESC LIMIT 100").all(id(automationId))
      .map(row => { const run = JSON.parse(String(row.run_json)) as AutomationRun; if (!includePrompt) delete run.prompt; return run; });
  }
  active(): DueAutomationRun[] {
    this.importDesktop();
    return this.db.prepare("SELECT run_json FROM automation_runs ORDER BY created_at,id").all().flatMap(row => {
      const run = JSON.parse(String(row.run_json)) as AutomationRun;
      const automation = !terminal(run.status) ? this.get(run.automationId) : undefined;
      return automation ? [{ automation, run }] : [];
    });
  }
  manual(automationId: string, now = Date.now()): AutomationRun {
    this.importDesktop();
    return this.transaction(() => {
      const automation = this.get(automationId);
      if (!automation) throw new Error("Automation not found.");
      if (belongsToAnotherHost(automation)) throw new Error(ANOTHER_HOST_ERROR);
      const run = this.newRun(automation, "manual", now, now);
      this.summary(automation, run); return run;
    });
  }
  private newRun(automation: Automation, trigger: AutomationRun["trigger"], scheduledFor: number, now: number): AutomationRun {
    return { id: randomUUID(), automationId: automation.id, trigger, scheduledFor, createdAt: now, status: "pending", prompt: automation.prompt };
  }
  claimDue(now = Date.now()): void {
    for (const value of this.list()) {
      if (!value.enabled || belongsToAnotherHost(value) || !automationTriggers(value).some(trigger => trigger.kind === "time")) continue;
      for (const occurrence of overdueTriggerOccurrences(automationTriggers(value), value.nextRunAt, now)) this.transaction(() => {
        const automation = this.get(value.id);
        if (!automation?.enabled || automation.nextRunAt !== occurrence.scheduledFor) return;
        automation.nextRunAt = occurrence.nextRunAt;
        const run = this.newRun(automation, "scheduled", occurrence.scheduledFor, now);
        if (now - occurrence.scheduledFor > automation.missedRunGraceMinutes * 60_000) {
          run.status = "skipped"; run.completedAt = now; run.error = "Missed the scheduled run beyond its grace period.";
        }
        this.summary(automation, run);
      });
    }
  }
  claimEvent(automationId: string, claim: AutomationEventClaim, now = Date.now()): DueAutomationRun | null {
    this.importDesktop();
    if (!claim || typeof claim.eventKey !== "string" || !/^[A-Za-z0-9:_./-]{1,400}$/.test(claim.eventKey) || !["github", "linear", "jira", "gitlab", "azuredevops"].includes(claim.eventKind)
      || typeof claim.event !== "string" || !claim.event || claim.event.length > 200 || typeof claim.prompt !== "string" || !claim.prompt.trim() || Buffer.byteLength(claim.prompt) > 1_010_000) throw new Error("Invalid automation event");
    return this.transaction(() => {
      const automation = this.get(automationId);
      if (!automation) throw new Error("Automation not found.");
      if (!automation.enabled || belongsToAnotherHost(automation) || !automationTriggers(automation).some(trigger => trigger.kind === claim.eventKind && trigger.event === claim.event)) return null;
      if (!this.db.prepare("INSERT OR IGNORE INTO automation_event_claims VALUES (?,?,?)").run(automationId, claim.eventKey, now).changes) return null;
      const run: AutomationRun = { ...this.newRun(automation, "event", claim.scheduledFor > 0 ? claim.scheduledFor : now, now),
        eventKey: claim.eventKey, eventKind: claim.eventKind as AutomationRun["eventKind"], event: claim.event, prompt: claim.prompt };
      this.summary(automation, run); return { automation, run };
    });
  }
  /**
   * Host-collected Inbox items this automation has already observed. The first
   * poll of a provider only seeds the ledger, so existing work never triggers.
   */
  inboxObserved(automationId: string, provider: string, keys: readonly string[]): { seeded: boolean; seen: Set<string> } {
    const seeded = !!this.db.prepare("SELECT 1 FROM automation_inbox_sources WHERE automation_id=? AND provider=?").get(id(automationId), provider);
    const lookup = this.db.prepare("SELECT 1 FROM automation_inbox_seen WHERE automation_id=? AND event_key=?");
    return { seeded, seen: new Set(keys.filter(key => lookup.get(automationId, key))) };
  }
  markInboxObserved(automationId: string, provider: string, keys: readonly string[], now = Date.now()) {
    this.transaction(() => {
      if (!this.get(automationId)) return;
      this.db.prepare("INSERT OR IGNORE INTO automation_inbox_sources VALUES (?,?,?)").run(automationId, provider, now);
      const insert = this.db.prepare("INSERT OR IGNORE INTO automation_inbox_seen VALUES (?,?)");
      for (const key of keys) insert.run(automationId, key);
    });
  }
  update(runId: string, status: AutomationRunStatus, options: { sessionId?: string; error?: string } = {}, now = Date.now()): AutomationRun {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT run_json FROM automation_runs WHERE id=?").get(id(runId));
      if (!row) throw new Error("Automation run not found.");
      const run = JSON.parse(String(row.run_json)) as AutomationRun;
      const automation = this.get(run.automationId);
      if (!automation) throw new Error("Automation not found.");
      run.status = status;
      if (status === "running") run.startedAt ??= now;
      if (terminal(status)) run.completedAt = now;
      if (options.sessionId) run.sessionId = options.sessionId;
      run.error = options.error?.trim() || undefined;
      this.summary(automation, run); return run;
    });
  }
  close() { this.db.close(); }
}

function validateTrigger(trigger: AutomationTrigger) {
  if (!trigger || !["time", "github", "linear", "jira", "gitlab", "azuredevops"].includes(trigger.kind) || typeof trigger.event !== "string" || trigger.event.length > 200) throw new Error("Invalid automation trigger.");
  if (!["hourly", "daily", "weekdays", "weekly"].includes(trigger.scheduleKind) || !Number.isInteger(trigger.minute) || trigger.minute < 0 || trigger.minute > 59 || !Number.isInteger(trigger.dayOfWeek) || trigger.dayOfWeek < 0 || trigger.dayOfWeek > 6 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(trigger.time)) throw new Error("Invalid automation time.");
  if (!Array.isArray(trigger.repos) || trigger.repos.length > 50 || trigger.repos.some(repo => typeof repo !== "string" || repo.length > 400) || typeof trigger.repo !== "string" || trigger.repo.length > 400 || typeof trigger.branch !== "string" || trigger.branch.length > 400 || typeof trigger.actor !== "string" || trigger.actor.length > 200) throw new Error("Invalid automation trigger event.");
}

export interface HostAutomationExecutor {
  launch(automation: Automation, run: AutomationRun): Promise<string>;
  outcome(sessionId: string): { status: "running" | "succeeded" | "failed" | "cancelled"; error?: string };
}

/** One scheduler belongs to Host, independently of open or background clients. */
export class HostAutomations {
  private timer?: ReturnType<typeof setInterval>;
  private flight?: Promise<void>;
  private closing = false;
  constructor(readonly store: HostAutomationStore, private readonly executor: HostAutomationExecutor) {}
  start() {
    if (this.timer || this.closing) return;
    void this.tick().catch(() => undefined);
    this.timer = setInterval(() => void this.tick().catch(() => undefined), 1000);
    this.timer.unref?.();
  }
  tick(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (this.flight) return this.flight;
    const pending = (async () => {
      this.store.claimDue();
      for (const { automation, run } of this.store.active()) {
        if (this.closing) break;
        try {
          if (run.status === "pending") {
            if (belongsToAnotherHost(automation)) throw new Error(ANOTHER_HOST_ERROR);
            if (run.trigger === "event" && !run.prompt?.trim()) throw new Error("The Inbox event prompt was not available after restart.");
            const sessionId = await this.executor.launch(automation, run);
            this.store.update(run.id, "running", { sessionId });
          } else if (run.sessionId) {
            const outcome = this.executor.outcome(run.sessionId);
            if (outcome.status !== "running") this.store.update(run.id, outcome.status, { error: outcome.error });
          } else this.store.update(run.id, "cancelled", { error: "Interrupted when OmniCode last stopped." });
        } catch (error) { this.store.update(run.id, "failed", { error: error instanceof Error ? error.message : String(error) }); }
      }
    })();
    this.flight = pending.finally(() => { this.flight = undefined; });
    return this.flight;
  }
  async close() { this.closing = true; clearInterval(this.timer); await this.flight?.catch(() => undefined); this.store.close(); }
}
