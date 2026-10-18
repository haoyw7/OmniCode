import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HostStore } from "../store";
import type { BotThreadRecord } from "./thread/store";
import { defaultBotPersona, fullBotPolicy, type BotPatch } from "../../src/features/bots/model/botView";
import type { BotModelOverride, BotRun, BotRunCursor, BotRuns, BotScope, BotThread, BotThreadKind, BotView } from "../../src/features/bots/model/bots";
import { memoryLines } from "./thread/memory";

const RUNTIME_FIELDS = new Set<keyof BotThreadRecord>([
  "chatRevision", "lifecycle", "brainGeneration", "brainSessionId", "brainBaseline",
  "brainMemory", "sourceCursor", "activity", "nextRetryAt", "error",
]);
const DERIVED_FIELDS = new Set(["backlog", "memory", "playbooks"]);
function split(value: Partial<BotThreadRecord>) {
  const config: Record<string, unknown> = {}, runtime: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (DERIVED_FIELDS.has(key)) continue;
    (RUNTIME_FIELDS.has(key as keyof BotThreadRecord) ? runtime : config)[key] = entry;
  }
  return { config, runtime };
}
const parse = (value: unknown): Record<string, unknown> => JSON.parse(String(value));
export type BotThreadPatch = { title?: string; archivedAt?: number; modelOverride?: BotModelOverride | null };
export type MigrationPhase = "backup" | "prepared" | "copied" | "complete";

function syncFile(path: string): void {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function finishFile(temporary: string, destination: string): void {
  syncFile(temporary);
  renameSync(temporary, destination);
  // Windows does not expose directory handles through openSync.
  if (process.platform !== "win32") syncFile(dirname(destination));
}

/** Shared Bot configuration and explicit, relational Thread ownership. */
export class BotStore {
  constructor(readonly host: HostStore, options: { onMigrationPhase?: (phase: MigrationPhase) => void } = {}) {
    host.db.exec(`
      CREATE TABLE IF NOT EXISTS bot_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, default_thread_id TEXT NOT NULL, archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, config TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_threads (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), kind TEXT NOT NULL, title TEXT NOT NULL, archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL, model_override TEXT, runtime TEXT NOT NULL, UNIQUE(bot_id,id));
      CREATE TABLE IF NOT EXISTS bot_messages (bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, revision INTEGER NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(bot_id,thread_id,revision), FOREIGN KEY(bot_id,thread_id) REFERENCES bot_threads(bot_id,id));
      CREATE INDEX IF NOT EXISTS bot_messages_id ON bot_messages(bot_id,thread_id,id,revision);
      CREATE INDEX IF NOT EXISTS bot_messages_history ON bot_messages(bot_id,thread_id,json_extract(payload,'$.createdAt'),id,revision);
      CREATE TABLE IF NOT EXISTS bot_wakeups (bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, id TEXT NOT NULL, dedupe TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(bot_id,thread_id,id), UNIQUE(bot_id,thread_id,dedupe), FOREIGN KEY(bot_id,thread_id) REFERENCES bot_threads(bot_id,id));
      CREATE TABLE IF NOT EXISTS bot_receipts (bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, id TEXT NOT NULL, signature TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(bot_id,thread_id,id), FOREIGN KEY(bot_id,thread_id) REFERENCES bot_threads(bot_id,id));
      CREATE TABLE IF NOT EXISTS bot_actions (bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(bot_id,thread_id,request_id), FOREIGN KEY(bot_id,thread_id) REFERENCES bot_threads(bot_id,id));
      CREATE TABLE IF NOT EXISTS bot_sources (bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, seq INTEGER NOT NULL, event_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(bot_id,thread_id,seq), UNIQUE(bot_id,thread_id,event_key), FOREIGN KEY(bot_id,thread_id) REFERENCES bot_threads(bot_id,id));
      CREATE TABLE IF NOT EXISTS bot_chains (bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, root TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(bot_id,thread_id,root), FOREIGN KEY(bot_id,thread_id) REFERENCES bot_threads(bot_id,id));
      CREATE TABLE IF NOT EXISTS bot_memory (bot_id TEXT NOT NULL REFERENCES bots(id), name TEXT NOT NULL, revision INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(bot_id,name));
      CREATE TABLE IF NOT EXISTS bot_commands (scope TEXT NOT NULL, id TEXT NOT NULL, signature TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS bot_memory_state (bot_id TEXT PRIMARY KEY REFERENCES bots(id), initialized INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_memory_files (bot_id TEXT NOT NULL REFERENCES bots(id), path TEXT NOT NULL, revision INTEGER NOT NULL, hash TEXT NOT NULL, present INTEGER NOT NULL, bytes INTEGER NOT NULL, updated_at INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(bot_id,path));
      CREATE TABLE IF NOT EXISTS bot_memory_commits (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id));
      CREATE TABLE IF NOT EXISTS bot_memory_changes (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), path TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS bot_memory_changes_bot ON bot_memory_changes(bot_id,at);
      CREATE TABLE IF NOT EXISTS bot_runs (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, wakeup_id TEXT NOT NULL, attempt INTEGER NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(bot_id,thread_id,wakeup_id,attempt), FOREIGN KEY(bot_id,thread_id) REFERENCES bot_threads(bot_id,id));
      CREATE INDEX IF NOT EXISTS bot_runs_history ON bot_runs(bot_id,thread_id,created_at,id);
    `);
    this.migrate(options.onMigrationPhase);
  }

  private metadata(key: string): string | undefined {
    const row = this.host.db.prepare("SELECT value FROM bot_metadata WHERE key=?").get(key);
    return row && String(row.value);
  }
  private setMetadata(key: string, value: string): void {
    this.host.db.prepare("INSERT INTO bot_metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  private migrate(notify?: (phase: MigrationPhase) => void): void {
    if (this.metadata("migration") === "complete") return;
    const hasTable = (name: string) => !!this.host.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    const legacy = hasTable("assistants") ? this.host.db.prepare("SELECT payload FROM assistants WHERE singleton=1").get() : undefined;
    const record = legacy ? JSON.parse(String(legacy.payload)) as BotThreadRecord : undefined;
    if (!this.metadata("defaultScope")) {
      this.setMetadata("defaultScope", JSON.stringify({ botId: record?.id ?? randomUUID(), threadId: randomUUID() }));
      this.setMetadata("revision", "0");
    }
    const scope = this.defaultScope();
    // SQLite creates a consistent snapshot including committed WAL records.
    // A rename prevents an interrupted backup from masquerading as a complete one.
    if (this.metadata("migration") === undefined) {
      if (hasTable("assistants") && this.host.databasePath !== ":memory:") {
        const backup = `${this.host.databasePath}.pre-bots-v1.sqlite`;
        if (!existsSync(backup)) {
          const temporary = `${backup}.pending`;
          rmSync(temporary, { force: true });
          this.host.db.prepare("VACUUM INTO ?").run(temporary);
          chmodSync(temporary, 0o600);
          finishFile(temporary, backup);
        }
        this.setMetadata("backupPath", backup);
      }
      this.setMetadata("migration", "backup");
      notify?.("backup");
    }
    if (this.metadata("migration") === "backup") {
      if (record && this.host.databasePath !== ":memory:") {
        const directory = join(dirname(this.host.databasePath), "bots");
        mkdirSync(join(directory, encodeURIComponent(scope.botId), "workspace"), { recursive: true, mode: 0o700 });
        const manifest = join(directory, "migration-v1.json");
        writeFileSync(`${manifest}.pending`, JSON.stringify({ version: 1, scope, backup: this.metadata("backupPath") }), { mode: 0o600 });
        finishFile(`${manifest}.pending`, manifest);
      }
      this.setMetadata("migration", "prepared");
      notify?.("prepared");
    }
    if (this.metadata("migration") === "prepared") {
      this.host.transaction(() => {
        if (record) {
          this.insertBot(scope, { ...record, paused: record.paused ?? record.lifecycle === "paused" });
          const args = [scope.botId, scope.threadId];
          if (hasTable("assistant_messages")) this.host.db.prepare("INSERT INTO bot_messages SELECT ?,?,revision,id,payload FROM assistant_messages").run(...args);
          if (hasTable("assistant_wakeups")) this.host.db.prepare("INSERT INTO bot_wakeups SELECT ?,?,id,dedupe,payload FROM assistant_wakeups").run(...args);
          if (hasTable("assistant_receipts")) this.host.db.prepare("INSERT INTO bot_receipts SELECT ?,?,id,signature,payload FROM assistant_receipts").run(...args);
          if (hasTable("assistant_actions")) this.host.db.prepare("INSERT INTO bot_actions SELECT ?,?,request_id,payload FROM assistant_actions").run(...args);
          if (hasTable("assistant_sources")) this.host.db.prepare("INSERT INTO bot_sources SELECT ?,?,seq,event_key,payload FROM assistant_sources").run(...args);
          if (hasTable("assistant_chains")) this.host.db.prepare("INSERT INTO bot_chains SELECT ?,?,root,payload FROM assistant_chains").run(...args);
          if (hasTable("assistant_memory")) this.host.db.prepare("INSERT INTO bot_memory SELECT ?,name,revision,text FROM assistant_memory").run(scope.botId);
        }
        // These identifiers are a fixed allowlist, never client input or SQL rewriting.
        for (const table of ["assistants", "assistant_messages", "assistant_wakeups", "assistant_receipts", "assistant_actions", "assistant_sources", "assistant_chains", "assistant_memory"])
          if (hasTable(table)) for (const operation of ["INSERT", "UPDATE", "DELETE"])
            this.host.db.exec(`CREATE TRIGGER IF NOT EXISTS freeze_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'Legacy assistant data is read-only'); END`);
        this.setMetadata("migration", "copied");
      });
      notify?.("copied");
    }
    this.setMetadata("migration", "complete");
    notify?.("complete");
  }

  defaultScope(): BotScope { return JSON.parse(this.metadata("defaultScope")!); }
  revision(): number { return Number(this.metadata("revision") ?? 0); }
  private changed(): void { this.setMetadata("revision", String(this.revision() + 1)); }
  memoryChanged(botId: string): void {
    this.host.db.prepare("UPDATE bots SET updated_at=? WHERE id=?").run(Date.now(), botId);
    this.changed();
  }

  record(scope: BotScope): BotThreadRecord | null {
    const row = this.host.db.prepare("SELECT bots.config,bot_threads.runtime,bot_threads.model_override FROM bots JOIN bot_threads ON bot_threads.bot_id=bots.id WHERE bots.id=? AND bot_threads.id=?").get(scope.botId, scope.threadId);
    if (!row) return null;
    const override = row.model_override ? parse(row.model_override) : undefined;
    const value = { ...parse(row.config), ...parse(row.runtime), ...(override ? { ...override, modelSettings: override.modelSettings ?? {} } : {}) } as BotThreadRecord;
    return { ...value, maxConcurrentRuns: value.maxConcurrentRuns ?? 3, callableBotIds: value.callableBotIds ?? [], persona: value.persona ?? defaultBotPersona(), timezone: value.timezone ?? value.schedules?.[0]?.timezone ?? "UTC", reminders: value.reminders ?? [], habits: value.habits ?? [] };
  }
  private insertBot(scope: BotScope, value: BotThreadRecord): void {
    const now = Date.now(), parts = split(value);
    this.host.db.prepare("INSERT INTO bots VALUES (?,?,NULL,?,?,?)").run(scope.botId, scope.threadId, now, now, JSON.stringify(parts.config));
    this.host.db.prepare("INSERT INTO bot_threads VALUES (?,?,'direct','',NULL,?,?,1,NULL,?)").run(scope.threadId, scope.botId, now, now, JSON.stringify(parts.runtime));
    this.changed();
  }
  initializeDefault(patch: BotPatch): BotThreadRecord {
    const scope = this.defaultScope();
    return this.host.transaction(() => {
      if (this.record(scope)) throw new Error("Assistant is already configured");
      this.insertBot(scope, initialAssistantRecord(scope.botId, patch));
      return this.record(scope)!;
    });
  }
  createBot(patch: BotPatch): BotScope {
    return this.host.transaction(() => {
      const defaultScope = this.defaultScope();
      if (!this.record(defaultScope) && this.listBots(true).length === 0) {
        this.initializeDefault(patch);
        return defaultScope;
      }
      const scope = { botId: randomUUID(), threadId: randomUUID() };
      this.insertBot(scope, initialAssistantRecord(scope.botId, patch));
      return scope;
    });
  }
  createThread(botId: string, options: { title?: string; kind?: BotThreadKind; modelOverride?: BotModelOverride } = {}): BotScope {
    return this.host.transaction(() => {
      if (!this.getBot(botId)) throw new Error("Bot does not exist");
      const scope = { botId, threadId: randomUUID() }, now = Date.now();
      this.host.db.prepare("INSERT INTO bot_threads VALUES (?,?,?,?,NULL,?,?,1,?,?)").run(scope.threadId, botId, options.kind ?? "direct", options.title ?? "", now, now, options.modelOverride ? JSON.stringify(options.modelOverride) : null, JSON.stringify({ chatRevision: 0, lifecycle: "idle", brainGeneration: 1, sourceCursor: 0 }));
      this.changed();
      return scope;
    });
  }
  /** Only supplied fields are written: effective Thread model defaults never leak into Bot configuration. */
  updateRecord(scope: BotScope, patch: Partial<BotThreadRecord>, configuration = false): BotThreadRecord {
    return this.host.transaction(() => {
      const row = this.host.db.prepare("SELECT bots.config,bot_threads.runtime FROM bots JOIN bot_threads ON bot_threads.bot_id=bots.id WHERE bots.id=? AND bot_threads.id=?").get(scope.botId, scope.threadId);
      if (!row) throw new Error("Assistant is not configured");
      if (patch.id !== undefined && patch.id !== scope.botId) throw new Error("Bot identity cannot change");
      const parts = split(patch), config = parse(row.config), runtime = parse(row.runtime), now = Date.now();
      if (Object.keys(parts.config).length || configuration)
        this.host.db.prepare("UPDATE bots SET config=?,updated_at=? WHERE id=?").run(JSON.stringify({ ...config, ...parts.config, id: scope.botId, revision: Number(config.revision) + (configuration ? 1 : 0) }), now, scope.botId);
      this.host.db.prepare("UPDATE bot_threads SET runtime=?,updated_at=?,revision=revision+1 WHERE bot_id=? AND id=?").run(JSON.stringify({ ...runtime, ...parts.runtime }), now, scope.botId, scope.threadId);
      this.changed();
      return this.record(scope)!;
    });
  }
  writeRuntime(scope: BotScope, value: BotThreadRecord): void {
    this.updateRecord(scope, split(value).runtime);
  }
  getBot(botId: string): BotView | null {
    const row = this.host.db.prepare("SELECT * FROM bots WHERE id=?").get(botId);
    if (!row) return null;
    const record = this.record({ botId, threadId: String(row.default_thread_id) })!;
    const { brainSessionId: _brain, brainBaseline: _baseline, brainMemory: _memory, sourceCursor: _cursor, createdSessionWatchesMigrated: _migrated, ...view } = record;
    // The Bot view presents defaults, even when its default Thread has an override.
    const defaults = parse(row.config);
    Object.assign(view, { harness: defaults.harness, model: defaults.model, modelSettings: defaults.modelSettings,
      lifecycle: !record.enabled ? "disabled" : record.paused ? "paused" : record.lifecycle });
    const memory = this.host.db.prepare("SELECT revision,text FROM bot_memory WHERE bot_id=? AND name='memory'").get(botId);
    const playbooks = this.host.db.prepare("SELECT COALESCE(SUM(revision),0) AS revision,SUM(CASE WHEN text<>'' THEN 1 ELSE 0 END) AS count FROM bot_memory WHERE bot_id=? AND name LIKE 'playbook:%'").get(botId)!;
    return { ...view, defaultThreadId: String(row.default_thread_id), archivedAt: row.archived_at === null ? undefined : Number(row.archived_at), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), memory: { revision: Number(memory?.revision ?? 0), lines: memoryLines(String(memory?.text ?? "")).filter(line => !line.struck).length }, playbooks: { revision: Number(playbooks.revision), count: Number(playbooks.count ?? 0) } };
  }
  listBots(includeArchived = false): BotView[] {
    return this.host.db.prepare("SELECT id FROM bots WHERE (? OR archived_at IS NULL) ORDER BY created_at,id").all(includeArchived ? 1 : 0).map(row => this.getBot(String(row.id))!);
  }
  getThread(botId: string, threadId: string): BotThread | null {
    const row = this.host.db.prepare("SELECT bot_threads.*,bots.config FROM bot_threads JOIN bots ON bots.id=bot_threads.bot_id WHERE bot_id=? AND bot_threads.id=?").get(botId, threadId);
    if (!row) return null;
    const runtime = parse(row.runtime), config = parse(row.config);
    const lifecycle = !config.enabled ? "disabled" : config.paused ? "paused" : runtime.lifecycle as BotThread["lifecycle"];
    return { id: threadId, botId, kind: String(row.kind) as BotThreadKind, title: String(row.title), archivedAt: row.archived_at === null ? undefined : Number(row.archived_at), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), revision: Number(row.revision), modelOverride: row.model_override ? JSON.parse(String(row.model_override)) : undefined, lifecycle, chatRevision: Number(runtime.chatRevision) };
  }
  listThreads(botId: string, includeArchived = false): BotThread[] {
    return this.host.db.prepare("SELECT id FROM bot_threads WHERE bot_id=? AND (? OR archived_at IS NULL) ORDER BY created_at,id").all(botId, includeArchived ? 1 : 0).map(row => this.getThread(botId, String(row.id))!);
  }
  updateBot(botId: string, patch: Partial<BotThreadRecord> & { archivedAt?: number }, expectedRevision?: number): BotView {
    return this.host.transaction(() => {
      const old = this.getBot(botId);
      if (!old) throw new Error("Bot does not exist");
      if (expectedRevision !== undefined && old.revision !== expectedRevision) throw new Error("Settings changed elsewhere. Reload before saving.");
      const { archivedAt, ...config } = patch;
      this.updateRecord({ botId, threadId: old.defaultThreadId }, config, true);
      if ("archivedAt" in patch) this.host.db.prepare("UPDATE bots SET archived_at=? WHERE id=?").run(archivedAt ?? null, botId);
      return this.getBot(botId)!;
    });
  }
  updateThread(botId: string, threadId: string, patch: BotThreadPatch, expectedRevision?: number): BotThread {
    return this.host.transaction(() => {
      const old = this.getThread(botId, threadId);
      if (!old) throw new Error("Thread does not belong to this Bot");
      if (expectedRevision !== undefined && old.revision !== expectedRevision) throw new Error("Settings changed elsewhere. Reload before saving.");
      this.host.db.prepare("UPDATE bot_threads SET title=?,archived_at=?,model_override=?,updated_at=?,revision=revision+1 WHERE bot_id=? AND id=?").run(patch.title ?? old.title, "archivedAt" in patch ? patch.archivedAt ?? null : old.archivedAt ?? null, "modelOverride" in patch ? patch.modelOverride ? JSON.stringify(patch.modelOverride) : null : old.modelOverride ? JSON.stringify(old.modelOverride) : null, Date.now(), botId, threadId);
      this.changed();
      return this.getThread(botId, threadId)!;
    });
  }
  queuedRun(scope: BotScope, wakeup: { id: string; attempts: number; createdAt: number }): BotRun {
    const attempt = wakeup.attempts + 1;
    const existing = this.host.db.prepare("SELECT payload FROM bot_runs WHERE bot_id=? AND thread_id=? AND wakeup_id=? AND attempt=?")
      .get(scope.botId, scope.threadId, wakeup.id, attempt);
    if (existing) return JSON.parse(String(existing.payload));
    const run: BotRun = { ...scope, id: randomUUID(), wakeupId: wakeup.id, attempt, status: "queued", createdAt: wakeup.createdAt, updatedAt: Date.now() };
    this.host.db.prepare("INSERT INTO bot_runs VALUES (?,?,?,?,?,?,?,?)")
      .run(run.id, scope.botId, scope.threadId, wakeup.id, attempt, run.createdAt, run.status, JSON.stringify(run));
    this.changed();
    return run;
  }
  run(scope: BotScope, runId: string): BotRun | undefined {
    const row = this.host.db.prepare("SELECT payload FROM bot_runs WHERE id=? AND bot_id=? AND thread_id=?").get(runId, scope.botId, scope.threadId);
    return row ? JSON.parse(String(row.payload)) : undefined;
  }
  updateRun(scope: BotScope, runId: string, patch: Partial<Omit<BotRun, "id" | "botId" | "threadId" | "wakeupId" | "attempt" | "createdAt">>): BotRun {
    const old = this.run(scope, runId);
    if (!old) throw new Error("Run does not belong to this Bot and thread");
    const value = { ...old, ...patch, updatedAt: Date.now() };
    this.host.db.prepare("UPDATE bot_runs SET status=?,payload=? WHERE id=? AND bot_id=? AND thread_id=?")
      .run(value.status, JSON.stringify(value), runId, scope.botId, scope.threadId);
    this.changed();
    return value;
  }
  queuedRuns(scope: BotScope): BotRun[] {
    return this.host.db.prepare("SELECT payload FROM bot_runs WHERE bot_id=? AND thread_id=? AND status='queued'")
      .all(scope.botId, scope.threadId).map(row => JSON.parse(String(row.payload)));
  }
  interruptRuns(scope: BotScope): void {
    this.host.transaction(() => {
      const rows = this.host.db.prepare("SELECT id FROM bot_runs WHERE bot_id=? AND thread_id=? AND status IN ('running','waiting_approval')").all(scope.botId, scope.threadId);
      for (const row of rows) this.updateRun(scope, String(row.id), { status: "interrupted", endedAt: Date.now(), error: "Host restarted before the run finished. Inspect its recorded actions before continuing." });
    });
  }
  runs(scope: BotScope, limit = 30, before?: BotRunCursor): BotRuns {
    if (!this.getThread(scope.botId, scope.threadId)) throw new Error("Thread does not belong to this Bot");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (before &&
      (!Number.isSafeInteger(before.createdAt) || before.createdAt < 0 || typeof before.id !== "string" || !before.id)))
      throw new Error("Invalid run history cursor or limit");
    const rows = this.host.db.prepare(`SELECT payload FROM bot_runs WHERE bot_id=? AND thread_id=?
      ${before ? "AND (created_at,id)<(?,?)" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all(...(before ? [scope.botId, scope.threadId, before.createdAt, before.id, limit + 1] : [scope.botId, scope.threadId, limit + 1]));
    const runs: BotRun[] = rows.slice(0, limit).map(row => JSON.parse(String(row.payload))), last = runs.at(-1);
    return { revision: this.revision(), runs, hasMore: rows.length > limit, ...(last ? { next: { createdAt: last.createdAt, id: last.id } } : {}) };
  }
  commandReceipt(scope: string, id: string, signature: string): unknown | undefined {
    const row = this.host.db.prepare("SELECT signature,payload FROM bot_commands WHERE scope=? AND id=?").get(scope, id);
    if (!row) return undefined;
    if (row.signature !== signature) throw new Error("Command ID was already used with different input");
    return JSON.parse(String(row.payload));
  }
  recordCommandReceipt(scope: string, id: string, signature: string, result: unknown): void {
    this.host.db.prepare("INSERT INTO bot_commands VALUES (?,?,?,?)").run(scope, id, signature, JSON.stringify(result));
  }
}

function initialAssistantRecord(id: string, patch: BotPatch): BotThreadRecord {
  if (!patch.harness || !patch.model) throw new Error("Choose an agent and model");
    const value: BotThreadRecord = {
      id,
      name: "Assistant",
      persona: defaultBotPersona(),
      timezone: patch.timezone ?? patch.schedules?.[0]?.timezone ?? "UTC",
      reminders: [],
      habits: [],
      revision: 1,
      chatRevision: 0,
      enabled: true,
      lifecycle: "idle",
      harness: patch.harness,
      model: patch.model,
      modelSettings: {},
      maxConcurrentRuns: 3,
      runtimeMode: "full-access",
      targetRuntimeMode: "full-access",
      policy: fullBotPolicy(),
      policyVersion: 1,
      triggers: { user: true, event: true, schedule: true },
      brainGeneration: 1,
      sourceCursor: 0,
      createdSessionWatchesMigrated: true,
      maxAutoTurns: 8,
      chainWindowMinutes: 15,
      schedules: [
        {
          id: "hourly",
          enabled: true,
          intervalMinutes: 60,
          prompt:
            "Check unfinished tasks. Report only meaningful progress or something needing attention.",
          timezone: "UTC",
          nextRunAt: Date.now() + 3600000,
        },
      ],
      watches: [
        {
          id: "activity",
          enabled: true,
          projectIds: [],
          sessionIds: [],
          eventKinds: [
            "completed",
            "failed",
            "approval",
            "question",
            "interrupted",
          ],
          prompt:
            "Follow up on this activity according to the user's goals. Stay quiet when nothing actionable changed.",
        },
      ],
      ...patch,
      workingDirectory: patch.workingDirectory ?? undefined,
    };
  return value;
}
