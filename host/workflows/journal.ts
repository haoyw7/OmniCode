// SQLite-backed workflow journal (the engine's JournalStorePort), stored in the
// Host database so runs survive Host restarts and can be resumed or amended.
// Semantics mirror the engine's InMemoryJournalStore.

import type { DatabaseSync } from "node:sqlite";
import type {
  ActorRecord,
  Caps,
  JournalStorePort,
  ListEventsOptions,
  NodeRecord,
  RunEvent,
  RunRecord,
  RunSettlementRecord,
  RunStatus,
  StoredEvent,
} from "../../src/integrations/workflow/dynamic-workflow/index.js";

export function migrateWorkflowJournal(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_runs (run_id TEXT PRIMARY KEY, parent_session_id TEXT, created_at INTEGER NOT NULL, record TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS workflow_runs_parent ON workflow_runs(parent_session_id, created_at);
    CREATE TABLE IF NOT EXISTS workflow_actors (run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE, site_id TEXT NOT NULL, ordinal INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY(run_id, site_id, ordinal));
    CREATE TABLE IF NOT EXISTS workflow_nodes (run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE, site_id TEXT NOT NULL, ordinal INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY(run_id, site_id, ordinal));
    CREATE TABLE IF NOT EXISTS workflow_events (run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE, sequence INTEGER NOT NULL, time_created INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(run_id, sequence));`);
}

export class SqliteJournalStore implements JournalStorePort {
  constructor(private readonly db: DatabaseSync) {
    migrateWorkflowJournal(db);
  }

  createRun(record: RunRecord): void {
    if (this.getRun(record.runId)) throw new Error(`journal: run ${record.runId} already exists`);
    this.db.prepare("INSERT INTO workflow_runs(run_id, parent_session_id, created_at, record) VALUES (?, ?, ?, ?)")
      .run(record.runId, record.parentSessionId ?? null, Date.now(), JSON.stringify(record));
  }

  getRun(runId: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT record FROM workflow_runs WHERE run_id=?").get(runId);
    return row ? JSON.parse(String(row.record)) as RunRecord : undefined;
  }

  private updateRun(runId: string, change: (record: RunRecord) => void): void {
    const record = this.getRun(runId);
    if (!record) throw new Error(`journal: unknown run ${runId}`);
    change(record);
    this.db.prepare("UPDATE workflow_runs SET record=? WHERE run_id=?").run(JSON.stringify(record), runId);
  }

  updateRunStatus(runId: string, status: RunStatus, settlement?: RunSettlementRecord): void {
    this.updateRun(runId, (record) => {
      record.status = status;
      if (status === "pending" || status === "running") {
        delete record.failure; delete record.result; delete record.stopReason; delete record.supersededBy;
        return;
      }
      if (settlement?.stopReason === undefined) delete record.stopReason; else record.stopReason = settlement.stopReason;
      if (settlement?.supersededBy === undefined) delete record.supersededBy; else record.supersededBy = settlement.supersededBy;
      if (settlement?.failure === undefined) delete record.failure; else record.failure = settlement.failure;
      if (settlement?.result !== undefined) record.result = settlement.result;
    });
  }

  updateRunUsage(runId: string, spentTokens: number): void {
    this.updateRun(runId, (record) => { record.spentTokens = spentTokens; });
  }

  updateRunCaps(runId: string, caps: Caps): void {
    this.updateRun(runId, (record) => { record.caps = { ...caps }; });
  }

  putActor(record: ActorRecord): void {
    this.requireRun(record.runId);
    this.db.prepare("INSERT OR REPLACE INTO workflow_actors(run_id, site_id, ordinal, record) VALUES (?, ?, ?, ?)")
      .run(record.runId, record.siteId, record.ordinal, JSON.stringify(record));
  }

  getActor(runId: string, siteId: string, ordinal: number): ActorRecord | undefined {
    const row = this.db.prepare("SELECT record FROM workflow_actors WHERE run_id=? AND site_id=? AND ordinal=?").get(runId, siteId, ordinal);
    return row ? JSON.parse(String(row.record)) as ActorRecord : undefined;
  }

  listActors(runId: string): ActorRecord[] {
    return this.db.prepare("SELECT record FROM workflow_actors WHERE run_id=? ORDER BY rowid").all(runId)
      .map((row) => JSON.parse(String(row.record)) as ActorRecord);
  }

  putNode(record: NodeRecord): void {
    this.requireRun(record.runId);
    this.db.prepare("INSERT OR REPLACE INTO workflow_nodes(run_id, site_id, ordinal, record) VALUES (?, ?, ?, ?)")
      .run(record.runId, record.siteId, record.ordinal, JSON.stringify(record));
  }

  getNode(runId: string, siteId: string, ordinal: number): NodeRecord | undefined {
    const row = this.db.prepare("SELECT record FROM workflow_nodes WHERE run_id=? AND site_id=? AND ordinal=?").get(runId, siteId, ordinal);
    return row ? JSON.parse(String(row.record)) as NodeRecord : undefined;
  }

  listNodes(runId: string): NodeRecord[] {
    return this.db.prepare("SELECT record FROM workflow_nodes WHERE run_id=? ORDER BY rowid").all(runId)
      .map((row) => JSON.parse(String(row.record)) as NodeRecord);
  }

  appendEvent(runId: string, event: RunEvent): StoredEvent {
    this.requireRun(runId);
    const last = this.db.prepare("SELECT MAX(sequence) AS sequence FROM workflow_events WHERE run_id=?").get(runId);
    const sequence = last?.sequence === null || last?.sequence === undefined ? 0 : Number(last.sequence) + 1;
    const timeCreated = Date.now();
    this.db.prepare("INSERT INTO workflow_events(run_id, sequence, time_created, event) VALUES (?, ?, ?, ?)")
      .run(runId, sequence, timeCreated, JSON.stringify(event));
    return { sequence, event: structuredClone(event), timeCreated };
  }

  listEvents(runId: string, opts?: ListEventsOptions): StoredEvent[] {
    const after = opts?.afterSequence ?? -1;
    const limit = opts?.limit === undefined ? -1 : Math.max(0, opts.limit);
    return this.db.prepare("SELECT sequence, time_created, event FROM workflow_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?")
      .all(runId, after, limit)
      .map((row) => ({ sequence: Number(row.sequence), timeCreated: Number(row.time_created), event: JSON.parse(String(row.event)) as RunEvent }));
  }

  /** Runs launched from a parent session, newest first. */
  listRunsForParent(parentSessionId: string, limit = 50): RunRecord[] {
    return this.db.prepare("SELECT record FROM workflow_runs WHERE parent_session_id=? ORDER BY created_at DESC LIMIT ?")
      .all(parentSessionId, limit)
      .map((row) => JSON.parse(String(row.record)) as RunRecord);
  }

  /** Startup recovery also checks terminal journals against their parent snapshots. */
  listRunsForRecovery(): RunRecord[] {
    return this.db.prepare("SELECT record FROM workflow_runs").all()
      .map((row) => JSON.parse(String(row.record)) as RunRecord);
  }

  createdAt(runId: string): number | undefined {
    const row = this.db.prepare("SELECT created_at FROM workflow_runs WHERE run_id=?").get(runId);
    return row ? Number(row.created_at) : undefined;
  }

  private requireRun(runId: string): void {
    if (!this.db.prepare("SELECT 1 FROM workflow_runs WHERE run_id=?").get(runId)) throw new Error(`journal: unknown run ${runId}`);
  }
}
