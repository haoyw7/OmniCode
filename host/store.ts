import { manualSessionTitle } from "../src/features/sessions/model/titlePolicy";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { parseProjectMachine, projectMachineKey, type ProjectMachine } from "../src/integrations/harness/core/machine";
import type {
  CommandReceipt,
  HostDeviceInfo,
  HostProject,
  HostSession,
  HostSessionSummary,
  RemoteProvider,
  SessionSync,
} from "../src/features/connections/model/protocol";
import type { Block, LinkedWorkItem } from "../src/features/sessions/model/session";
import {
  pendingSessionInputKey as pendingInputKey,
  sessionNotificationPreview,
  sessionMessageActivityAt,
  sessionRecencyAt,
} from "../src/features/sessions/model/sessionActivity";
import { sessionNeedsInput } from "../src/features/sessions/model/session";

const CACHED_SESSIONS = 32;

export type HostDevice = Omit<HostDeviceInfo, "installationId"> & {
  id: string;
  name: string;
  admin: boolean;
  createdAt?: number;
  /** A newly issued pairing code has been exchanged for a device credential. */
  pairedAt?: number;
  lastSeen?: number;
  /** Made a request within the last {@link DEVICE_ONLINE_MS}. */
  online?: boolean;
  /** Host-scoped digest; the phone's private installation UUID is never listed. */
  identityId?: string;
  /** Credential records belonging to this phone, including alternate network pairings. */
  connectionIds?: string[];
};

/** Paired apps poll every few seconds while open. */
export const DEVICE_ONLINE_MS = 30_000;

// Crockford-style alphabet without 0/O/1/I; 32 symbols keep each byte unbiased.
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A phone-friendly single-use pairing code such as `XD5J-2J3U`. */
export function pairingCode(): string {
  const symbols = [...randomBytes(8)].map((byte) => PAIRING_ALPHABET[byte % 32]).join("");
  return `${symbols.slice(0, 4)}-${symbols.slice(4)}`;
}

export class PairingCodeError extends Error {
  constructor(readonly code: "PAIRING_CODE_USED" | "PAIRING_CODE_INVALID") {
    super(code === "PAIRING_CODE_USED"
      ? "Pairing code has already been used. Generate a new code on the computer."
      : "Pairing code is invalid or revoked. Generate a new code on the computer.");
  }
}

export class HostStore {
  private transactionDepth = 0;
  private transactionParticipants: { beforeCommit?: () => void; afterCommit?: () => void; rollback?: () => void }[] = [];
  onSessionSave?: (previous: HostSession | undefined, next: HostSession, event: unknown) => void;
  readonly db: DatabaseSync;
  readonly environmentId: string;
  readonly attachmentDir: string;
  readonly databasePath: string;
  // This process is the only session writer, so recently used snapshots are
  // served from memory instead of re-parsing whole transcripts. Callers must
  // treat returned values as immutable.
  private cache = new Map<string, HostSession>();
  private assistantSessions = new Map<string, boolean>();
  // Sessions holding queued messages. The summary does not carry the queue, so
  // this set lets background scans skip transcripts without parsing them.
  private queuedSessions?: Set<string>;
  private revisionWaiters = new Map<string, Set<(error?: Error) => void>>();

  constructor(path: string) {
    this.databasePath = path;
    this.attachmentDir = join(dirname(path), "attachments");
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, signature TEXT NOT NULL, receipt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (session_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id, revision));
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS orchestration_runs (lead_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orchestration_commands (id TEXT PRIMARY KEY, signature TEXT NOT NULL, session_id TEXT NOT NULL, command TEXT NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS retired_sessions (id TEXT PRIMARY KEY);`);
    const deviceColumns = this.db.prepare("PRAGMA table_info(devices)").all();
    // `admin` marks the local desktop credential, the only one allowed to
    // manage other devices. Paired phones and SSH desktops stay ordinary.
    if (!deviceColumns.some(column => column.name === "admin")) this.db.exec("ALTER TABLE devices ADD COLUMN admin INTEGER NOT NULL DEFAULT 0");
    if (!deviceColumns.some(column => column.name === "created_at")) this.db.exec("ALTER TABLE devices ADD COLUMN created_at INTEGER");
    if (!deviceColumns.some(column => column.name === "last_seen")) this.db.exec("ALTER TABLE devices ADD COLUMN last_seen INTEGER");
    if (!deviceColumns.some(column => column.name === "model")) this.db.exec("ALTER TABLE devices ADD COLUMN model TEXT");
    if (!deviceColumns.some(column => column.name === "manufacturer")) this.db.exec("ALTER TABLE devices ADD COLUMN manufacturer TEXT");
    if (!deviceColumns.some(column => column.name === "device_type")) this.db.exec("ALTER TABLE devices ADD COLUMN device_type TEXT");
    if (!deviceColumns.some(column => column.name === "hostname")) this.db.exec("ALTER TABLE devices ADD COLUMN hostname TEXT");
    if (!deviceColumns.some(column => column.name === "pairing_hash")) this.db.exec("ALTER TABLE devices ADD COLUMN pairing_hash TEXT");
    if (!deviceColumns.some(column => column.name === "paired_at")) this.db.exec("ALTER TABLE devices ADD COLUMN paired_at INTEGER");
    if (!deviceColumns.some(column => column.name === "installation_hash")) this.db.exec("ALTER TABLE devices ADD COLUMN installation_hash TEXT");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS devices_pairing_hash ON devices(pairing_hash)");
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all();
    if (!this.db.prepare("PRAGMA table_info(projects)").all().some(column => column.name === "kind")) this.db.exec("ALTER TABLE projects ADD COLUMN kind TEXT");
    if (!this.db.prepare("PRAGMA table_info(projects)").all().some(column => column.name === "machine")) {
      // Keep raw Linux cwd values; uniqueness belongs to (execution machine, cwd).
      // Foreign keys keep referring to projects while only its table is rebuilt.
      this.db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
      try {
        this.db.exec(`CREATE TABLE projects_machine_upgrade (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, name TEXT NOT NULL, kind TEXT, machine TEXT NOT NULL DEFAULT 'local', UNIQUE(machine,cwd));
          INSERT INTO projects_machine_upgrade(id,cwd,name,kind) SELECT id,cwd,name,kind FROM projects;
          DROP TABLE projects;
          ALTER TABLE projects_machine_upgrade RENAME TO projects;
          COMMIT`);
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      finally { this.db.exec("PRAGMA foreign_keys=ON"); }
    }
    if (!columns.some((column) => column.name === "summary"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN summary TEXT");
    // Upgrade persisted Host snapshots once, rather than keeping a runtime alias.
    if (!this.db.prepare("SELECT 1 FROM metadata WHERE key='execution-cwd-v1'").get()) {
      this.transaction(() => {
        this.db.exec(`UPDATE sessions SET snapshot = json_remove(json_set(snapshot,
          '$.session.executionCwd', COALESCE(json_extract(snapshot, '$.session.executionCwd'), json_extract(snapshot, '$.session.worktreeCwd'))),
          '$.session.worktreeCwd'), summary = NULL
          WHERE json_type(snapshot, '$.session.worktreeCwd') IS NOT NULL`);
        this.db.prepare("INSERT INTO metadata(key, value) VALUES ('execution-cwd-v1', '1')").run();
      });
    }
    // `summary` follows the large `snapshot` column, so reading it from the
    // table walks every snapshot overflow page. Covering indexes keep summary
    // listings and per-session privacy checks off the snapshots entirely.
    this.db.exec(`CREATE INDEX IF NOT EXISTS sessions_project_summary ON sessions(project_id, id, summary);
      CREATE INDEX IF NOT EXISTS sessions_id_summary ON sessions(id, summary);`);
    this.db
      .prepare("INSERT OR IGNORE INTO metadata VALUES ('environmentId', ?)")
      .run(randomUUID());
    this.environmentId = String(
      this.db
        .prepare("SELECT value FROM metadata WHERE key='environmentId'")
        .get()!.value,
    );
  }

  transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth++;
    this.transactionParticipants = [];
    let committed = false;
    try {
      const value = fn();
      for (const participant of this.transactionParticipants) participant.beforeCommit?.();
      this.db.exec("COMMIT");
      committed = true;
      for (const participant of this.transactionParticipants) participant.afterCommit?.();
      return value;
    } catch (error) {
      if (committed) throw error;
      this.cache.clear();
      this.queuedSessions = undefined;
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        console.error("Could not roll back host transaction:", rollbackError);
      }
      for (const participant of [...this.transactionParticipants].reverse()) {
        try { participant.rollback?.(); }
        catch (rollbackError) { console.error("Could not restore a Host transaction participant:", rollbackError); }
      }
      throw error;
    } finally {
      this.transactionDepth--;
      this.transactionParticipants = [];
    }
  }

  /** Durable file participants attach to the outermost SQLite transaction. */
  participateInTransaction(participant: { beforeCommit?: () => void; afterCommit?: () => void; rollback?: () => void }): void {
    if (!this.transactionDepth) throw new Error("No active Host transaction");
    this.transactionParticipants.push(participant);
  }

  project(id: string): HostProject {
    const row = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    if (!row) throw new Error("Project is not registered on this machine");
    return { id: String(row.id), cwd: String(row.cwd), name: String(row.name), ...(row.kind === "assistant" ? { kind: "assistant" as const } : {}),
      ...(String(row.machine).startsWith("wsl:") ? { machine: { kind: "wsl" as const, distribution: String(row.machine).slice(4) } } : {}) };
  }

  projects(): HostProject[] {
    return this.db
      .prepare("SELECT * FROM projects WHERE kind IS NULL ORDER BY name")
      .all().map(row => this.project(String(row.id)));
  }

  addProject(cwd: string, name: string, kind?: "assistant", machine?: ProjectMachine): HostProject {
    const machineKey = projectMachineKey(parseProjectMachine(machine));
    this.db
      .prepare("INSERT OR IGNORE INTO projects(id,cwd,name,kind,machine) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), cwd, name, kind ?? null, machineKey);
    const row = this.db
      .prepare("SELECT * FROM projects WHERE cwd=? AND machine=?")
      .get(cwd, machineKey)!;
    return this.project(String(row.id));
  }

  private remember(value: HostSession): HostSession {
    this.cache.delete(value.session.id);
    this.cache.set(value.session.id, value);
    if (this.cache.size > CACHED_SESSIONS)
      this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  private find(id: string): HostSession | undefined {
    const cached = this.cache.get(id);
    if (cached) return this.remember(cached);
    const row = this.db
      .prepare("SELECT snapshot FROM sessions WHERE id=?")
      .get(id);
    return row
      ? this.remember(JSON.parse(String(row.snapshot)) as HostSession)
      : undefined;
  }

  session(id: string): HostSession {
    const value = this.sessionIfExists(id);
    if (!value) throw new Error("Session not found on this machine");
    return value;
  }

  sessionIfExists(id: string): HostSession | undefined {
    return this.isRetired(id) ? undefined : this.find(id);
  }

  /** Read metadata from the covering index without loading or caching a transcript. */
  sessionSummary(id: string): HostSessionSummary | undefined {
    if (this.isRetired(id)) return undefined;
    const row = this.db.prepare("SELECT summary FROM sessions INDEXED BY sessions_id_summary WHERE id=?").get(id);
    if (!row) return undefined;
    if (row.summary) {
      const value = JSON.parse(String(row.summary)) as HostSessionSummary;
      if (value.id === id && Number.isSafeInteger(value.revision)) return value;
    }
    // Old databases may not have a populated summary yet.
    const value = this.sessionIfExists(id);
    return value ? summary(value) : undefined;
  }

  /** Checkout guards need running identities and directories, never message history. */
  runningSessionDirectories(): { id: string; cwd: string }[] {
    const rows = this.db.prepare(`SELECT id, summary FROM sessions INDEXED BY sessions_id_summary
      WHERE json_extract(summary, '$.status') = 'running' OR summary IS NULL`).all();
    return rows.flatMap(row => {
      const id = String(row.id);
      if (this.isRetired(id)) return [];
      const metadata = row.summary ? JSON.parse(String(row.summary)) as HostSessionSummary : undefined;
      if (metadata?.cwd) return [{ id, cwd: metadata.executionCwd || metadata.cwd }];
      // Legacy rows can lack summaries or directories; preserve their guards.
      const value = this.peekSession(id);
      return value?.status === "running" ? [{ id, cwd: value.session.executionCwd || value.session.cwd }] : [];
    });
  }

  /** Reads a session for a background scan without displacing the recently
   * used sessions that clients are reading from the cache. */
  peekSession(id: string): HostSession | undefined {
    if (this.isRetired(id)) return undefined;
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = this.db
      .prepare("SELECT snapshot FROM sessions WHERE id=?")
      .get(id);
    return row ? (JSON.parse(String(row.snapshot)) as HostSession) : undefined;
  }

  /** Whether a stored session has queued messages, without parsing it. */
  hasQueuedMessages(id: string): boolean {
    return this.queueIds().has(id);
  }

  queuedSessionIds(): string[] {
    return [...this.queueIds()];
  }

  private queueIds(): Set<string> {
    // Seeded once by a text search: JSON escapes quotes inside strings, so the
    // unescaped key only matches a non-empty queue. Saves keep it current.
    this.queuedSessions ??= new Set(
      this.db
        .prepare(`SELECT id FROM sessions WHERE instr(snapshot, '"queuedMessages":[{') > 0`)
        .all()
        .map((row) => String(row.id)),
    );
    return this.queuedSessions;
  }

  /** The public RPC privacy guard also checks retained retired rows. */
  isAssistantSession(id: string): boolean {
    // Ownership is fixed when the Host creates an assistant session, so each
    // stored session is parsed at most once instead of on every request.
    const known = this.assistantSessions.get(id);
    if (known !== undefined) return known;
    const value = this.find(id);
    // A missing id may still be created later; only remember stored rows.
    if (!value) return false;
    const owned = !!value.session.assistantOwnerId;
    this.assistantSessions.set(id, owned);
    return owned;
  }

  summaries(projectId?: string): HostSessionSummary[] {
    const rows = projectId
      ? this.db.prepare("SELECT id, summary FROM sessions WHERE project_id=?").all(projectId)
      : this.db.prepare("SELECT id, summary FROM sessions").all();
    return rows
      .map((row) => {
        const cached = row.summary
          ? (JSON.parse(String(row.summary)) as HostSessionSummary)
          : undefined;
        if (
          cached?.model &&
          cached.needsInput !== undefined &&
          cached.providerSessionId !== undefined &&
          cached.lastUserMessageAt !== undefined &&
          cached.activityAt !== undefined &&
          cached.lastReplyRevision !== undefined &&
          cached.pendingInputKey !== undefined &&
          cached.notificationPreview !== undefined &&
          !cached.nativeSession?.nativeIds &&
          !cached.nativeSession?.blockIds.length
        )
          return cached;
        const fresh = summary(this.session(String(row.id)));
        this.db.prepare("UPDATE sessions SET summary=? WHERE id=?").run(
          JSON.stringify(fresh),
          String(row.id),
        );
        return fresh;
      })
      .sort((a, b) => sessionRecencyAt(b) - sessionRecencyAt(a));
  }

  waitForRevision(id: string, revision: number, waitMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || this.sessionSummary(id)?.revision !== revision) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiters = this.revisionWaiters.get(id) ?? new Set<(error?: Error) => void>();
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        waiters.delete(finish);
        if (!waiters.size) this.revisionWaiters.delete(id);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish();
      const timer = setTimeout(finish, Math.min(1_000, Math.max(0, waitMs)));
      this.revisionWaiters.set(id, waiters);
      waiters.add(finish);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  private notifyRevision(id: string): void {
    for (const finish of this.revisionWaiters.get(id) ?? []) finish();
  }

  sync(id: string, revision?: number): SessionSync {
    // Polling more conversations than the transcript LRU can hold must not
    // continually evict and reparse them just to return "unchanged".
    if (revision !== undefined && this.sessionSummary(id)?.revision === revision)
      return { kind: "unchanged", revision };
    const value = this.session(id);
    const { blockRevisions, ...snapshot } = value;
    if (revision === value.revision) return { kind: "unchanged", revision };
    if (revision === undefined || revision > value.revision || !blockRevisions)
      return { kind: "snapshot", value: snapshot };
    const {
      session: { blocks, ...session },
      ...rest
    } = snapshot;
    return {
      kind: "delta",
      base: revision,
      value: { ...rest, session },
      blockIds: blocks.map((block) => block.id),
      blocks: blocks.filter(
        (block) => (blockRevisions[block.id] ?? value.revision) > revision,
      ),
    };
  }

  /** Recovery may write or delete rows between reads. Snapshot only the IDs,
   * then release each transcript before reading the next, without filling the LRU. */
  *scanSessions(): Generator<HostSession> {
    const ids = this.db.prepare("SELECT id FROM sessions ORDER BY id").all();
    for (const row of ids) {
      const value = this.peekSession(String(row.id));
      if (value) yield value;
    }
  }

  sessions(projectId?: string): HostSession[] {
    const rows = projectId
      ? this.db
          .prepare("SELECT snapshot FROM sessions WHERE project_id=?")
          .all(projectId)
      : this.db.prepare("SELECT snapshot FROM sessions").all();
    return rows
      .map((row) => JSON.parse(String(row.snapshot)) as HostSession)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Returns the saved value, stamped with per-block change revisions. */
  save(input: HostSession, event: unknown): HostSession {
    return this.transaction(() => this.saveInTransaction(input, event));
  }

  private saveInTransaction(input: HostSession, event: unknown): HostSession {
    if (this.isRetired(input.session.id)) throw new Error("This legacy orchestration conversation was deleted");
    const previous = this.find(input.session.id);
    const revisions = blockRevisions(previous, input);
    const before = new Map(previous?.session.blocks.map((block) => [block.id, block]));
    const receivedReply = input.session.blocks.some((block) =>
      isReplyBlock(block) && revisions[block.id] === input.revision &&
      replyContentChanged(before.get(block.id), block),
    ) || (!!pendingInputKey(input.session, input.runId) && pendingInputKey(previous?.session, previous?.runId) !== pendingInputKey(input.session, input.runId))
      || input.lastCompletedRunId !== previous?.lastCompletedRunId;
    const value = {
      ...input,
      // Older snapshots have no creation time. Preserve their last recorded
      // timestamp when they are first written by this version of the host.
      createdAt:
        input.createdAt ?? previous?.createdAt ?? previous?.updatedAt ?? input.updatedAt,
      lastReplyRevision: receivedReply
        ? input.revision
        : (input.lastReplyRevision ?? previous?.lastReplyRevision ?? replyRevision(previous)),
      blockRevisions: revisions,
    };
    this.db
      .prepare(
        "INSERT INTO sessions (id, project_id, snapshot, summary) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot, summary=excluded.summary",
      )
      .run(
        value.session.id,
        value.projectId,
        JSON.stringify(value),
        JSON.stringify(summary(value)),
      );
    this.db
      .prepare("INSERT INTO events VALUES (?, ?, ?)")
      .run(value.session.id, value.revision, JSON.stringify(event));
    this.db
      .prepare("DELETE FROM events WHERE session_id=? AND revision<?")
      .run(value.session.id, value.revision - 2_000);
    if (value.session.queuedMessages?.length) this.queuedSessions?.add(value.session.id);
    else this.queuedSessions?.delete(value.session.id);
    this.onSessionSave?.(previous, value, event);
    this.participateInTransaction({ afterCommit: () => this.notifyRevision(value.session.id) });
    return this.remember(value);
  }

  updateSession(
    id: string,
    patch: { title?: string; archived?: boolean; pinned?: boolean; linkedWorkItem?: LinkedWorkItem | null },
  ): HostSessionSummary {
    return this.transaction(() => {
      const current = this.session(id);
      if (patch.title !== undefined && (!patch.title.trim() || patch.title.length > 200))
        throw new Error("Invalid session title");
      const next = this.save(
        {
          ...current,
          revision: current.revision + 1,
          archived: patch.archived ?? current.archived,
          pinned: patch.pinned ?? current.pinned,
          session: {
            ...current.session,
            ...(patch.title === undefined ? {} : { title: patch.title.trim(), titleState: manualSessionTitle(current.session, patch.title.trim()).titleState }),
            ...(patch.linkedWorkItem === undefined
              ? {}
              : { linkedWorkItem: patch.linkedWorkItem ?? undefined }),
          },
        },
        { type: "session.metadata", patch },
      );
      return summary(next);
    });
  }

  deleteSession(id: string): void {
    this.transaction(() => {
      const current = this.session(id);
      if (current.status === "running")
        throw new Error("Stop this session before deleting it");
      this.db.prepare("DELETE FROM events WHERE session_id=?").run(id);
      this.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
      this.cache.delete(id);
      this.assistantSessions.delete(id);
      this.queuedSessions?.delete(id);
      this.participateInTransaction({ afterCommit: () => this.notifyRevision(id) });
    });
  }

  isRetired(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM retired_sessions WHERE id=?").get(id);
  }

  invalidateSession(id: string): void {
    this.cache.delete(id);
    this.assistantSessions.delete(id);
    this.queuedSessions?.delete(id);
  }

  orchestration(leadId: string): { id: string; run: import("../src/features/orchestration/model/orchestrationState").OrchestrationRun } | undefined {
    const row = this.db.prepare("SELECT id, state FROM orchestration_runs WHERE lead_id=?").get(leadId);
    return row ? { id: String(row.id), run: JSON.parse(String(row.state)) } : undefined;
  }

  orchestrationLeads(): string[] {
    return this.db.prepare("SELECT lead_id FROM orchestration_runs").all().map((row) => String(row.lead_id));
  }

  saveOrchestration(id: string, run: import("../src/features/orchestration/model/orchestrationState").OrchestrationRun): void {
    if (this.isRetired(run.leadId)) throw new Error("This legacy orchestration conversation was deleted");
    this.db.prepare("INSERT INTO orchestration_runs VALUES (?, ?, ?) ON CONFLICT(lead_id) DO UPDATE SET id=excluded.id, state=excluded.state")
      .run(run.leadId, id, JSON.stringify(run));
  }

  receipt(id: string, signature: string): CommandReceipt | undefined {
    const row = this.db.prepare("SELECT * FROM receipts WHERE id=?").get(id);
    if (!row) return undefined;
    if (row.signature !== signature)
      throw new Error("Command ID was already used with a different payload");
    return JSON.parse(String(row.receipt)) as CommandReceipt;
  }

  recordReceipt(signature: string, receipt: CommandReceipt): void {
    this.db
      .prepare("INSERT INTO receipts VALUES (?, ?, ?)")
      .run(receipt.commandId, signature, JSON.stringify(receipt));
  }

  events(
    id: string,
    after: number,
  ): { snapshot?: HostSession; events?: unknown[]; revision: number } {
    const snapshot = this.session(id);
    const rows = this.db
      .prepare(
        "SELECT revision, payload FROM events WHERE session_id=? AND revision>? ORDER BY revision",
      )
      .all(id, after);
    if (
      after > snapshot.revision ||
      (after < snapshot.revision && Number(rows[0]?.revision) !== after + 1)
    ) {
      return { snapshot, revision: snapshot.revision };
    }
    return {
      events: rows.map((row) => ({
        revision: row.revision,
        event: JSON.parse(String(row.payload)),
      })),
      revision: snapshot.revision,
    };
  }

  issueDevice(
    name: string,
    token = randomBytes(32).toString("base64url"),
  ): { id: string; token: string } {
    if (!/^[A-Za-z0-9_-]+$/.test(token))
      throw new Error("Invalid device token");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO devices (id, name, hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, name, this.hash(token), Date.now());
    return { id, token };
  }

  /** The displayed code can only exchange credentials; it never authorizes RPC. */
  issuePairingDevice(name: string): { id: string; token: string } {
    return this.transaction(() => {
      let code: string;
      do { code = pairingCode(); }
      while (this.hasPairingCode(code) || this.authenticated(code));
      const device = this.issueDevice(name);
      this.db.prepare("UPDATE devices SET pairing_hash=? WHERE id=?")
        .run(this.hash(code), device.id);
      return { id: device.id, token: code };
    });
  }

  hasPairingCode(code: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM devices WHERE pairing_hash=?").get(this.hash(code));
  }

  /** Serialize redemption with the credential change so only one phone wins. */
  redeemPairingCode(code: string): { id: string; token: string } {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT id, paired_at FROM devices WHERE pairing_hash=?").get(this.hash(code));
      if (!row) {
        // Existing phones keep their previously issued permanent credentials.
        const legacy = this.db.prepare("SELECT id FROM devices WHERE hash=?").get(this.hash(code));
        if (legacy) return { id: String(legacy.id), token: code };
        throw new PairingCodeError("PAIRING_CODE_INVALID");
      }
      if (row.paired_at != null) throw new PairingCodeError("PAIRING_CODE_USED");
      const token = randomBytes(32).toString("base64url");
      this.db.prepare("UPDATE devices SET hash=?, paired_at=? WHERE id=?")
        .run(this.hash(token), Date.now(), row.id);
      return { id: String(row.id), token };
    });
  }

  markAdminDevice(id: string): void {
    this.db.prepare("UPDATE devices SET admin=1 WHERE id=?").run(id);
  }

  adminToken(token: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM devices WHERE hash=? AND admin=1")
      .get(this.hash(token));
  }

  /** Attribution comes only from the credential used for this request. */
  remoteControlDevice(token: string): HostSession["remoteControlDevice"] {
    const row = this.db.prepare("SELECT id, name, model, manufacturer, hostname FROM devices WHERE hash=? AND admin=0")
      .get(this.hash(token));
    if (!row) return undefined;
    return {
      id: String(row.id),
      name: String(row.name),
      ...(row.model ? { model: String(row.model) } : {}),
      ...(row.manufacturer ? { manufacturer: String(row.manufacturer) } : {}),
      ...(row.hostname ? { hostname: String(row.hostname) } : {}),
    };
  }

  devices(now = Date.now()): HostDevice[] {
    return this.db
      .prepare("SELECT id, name, admin, created_at, paired_at, last_seen, hash, model, manufacturer, device_type, hostname, installation_hash FROM devices ORDER BY created_at, name, id")
      .all()
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        admin: Number(row.admin) === 1,
        ...(row.installation_hash && Number(row.admin) !== 1 ? { identityId: String(row.installation_hash) } : {}),
        ...(row.model ? { model: String(row.model) } : {}),
        ...(row.manufacturer ? { manufacturer: String(row.manufacturer) } : {}),
        ...(row.device_type === "desktop" || row.device_type === "mobile" ? { deviceType: row.device_type } : {}),
        ...(row.hostname ? { hostname: String(row.hostname) } : {}),
        createdAt: row.created_at == null ? undefined : Number(row.created_at),
        ...(row.paired_at == null ? {} : { pairedAt: Number(row.paired_at) }),
        lastSeen: row.last_seen == null ? undefined : Number(row.last_seen),
        online: now - (this.activeAt.get(String(row.hash)) ?? 0) < DEVICE_ONLINE_MS,
      }));
  }

  /** One phone can have several authorized routes. Keep their tokens independent. */
  deviceGroups(now = Date.now()): HostDevice[] {
    const groups = new Map<string, HostDevice>();
    for (const device of this.devices(now)) {
      const key = device.identityId ?? device.id;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, { ...device, ...(device.identityId ? { connectionIds: [device.id] } : {}) });
        continue;
      }
      group.connectionIds!.push(device.id);
      group.online ||= device.online;
      if (device.lastSeen !== undefined) group.lastSeen = Math.max(group.lastSeen ?? 0, device.lastSeen);
      if (device.pairedAt !== undefined) group.pairedAt = Math.min(group.pairedAt ?? Infinity, device.pairedAt);
      group.model ??= device.model;
      group.manufacturer ??= device.manufacturer;
    }
    return [...groups.values()];
  }

  /** A client can describe only the device owning its authenticated credential. */
  updateDeviceInfo(token: string, value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const info = value as Record<string, unknown>;
    if (info.deviceType !== "desktop" && typeof info.installationId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(info.installationId)) {
      // Bind once, only to this authenticated, non-admin credential. The UUID
      // groups records; it cannot authorize RPC or recover another token.
      const identity = this.hash(`${this.environmentId}:${info.installationId.toLowerCase()}`);
      this.db.prepare("UPDATE devices SET installation_hash=?, device_type='mobile' WHERE hash=? AND admin=0 AND installation_hash IS NULL AND (device_type IS NULL OR device_type='mobile')")
        .run(identity, this.hash(token));
    }
    const field = (value: unknown) => typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) : "";
    const model = field(info.model);
    const deviceType = info.deviceType === "desktop" ? "desktop" : model ? "mobile" : undefined;
    if (!deviceType) return;
    const hostname = deviceType === "desktop" ? field(info.hostname) || null : null;
    const manufacturer = field(info.manufacturer) || null;
    const hardwareModel = deviceType === "mobile" ? model : null;
    const hardwareManufacturer = deviceType === "mobile" ? manufacturer : null;
    this.db.prepare("UPDATE devices SET model=?, manufacturer=?, device_type=?, hostname=? WHERE hash=? AND (model IS NOT ? OR manufacturer IS NOT ? OR device_type IS NOT ? OR hostname IS NOT ?)")
      .run(hardwareModel, hardwareManufacturer, deviceType, hostname, this.hash(token), hardwareModel, hardwareManufacturer, deviceType, hostname);
  }

  private seenAt = new Map<string, number>();
  /** Latest request per credential hash, kept in memory for presence. */
  private activeAt = new Map<string, number>();
  /** Records presence on every request; persists activity at most once a minute. */
  touchDevice(token: string, now = Date.now()): void {
    const hash = this.hash(token);
    this.activeAt.set(hash, now);
    if (now - (this.seenAt.get(hash) ?? 0) < 60_000) return;
    this.seenAt.set(hash, now);
    this.db.prepare("UPDATE devices SET last_seen=? WHERE hash=?").run(now, hash);
  }

  deviceCredentials(id: string): { id: string; hash: string }[] {
    const device = this.db.prepare("SELECT id, hash, admin, installation_hash FROM devices WHERE id=?").get(id);
    if (!device) return [];
    const rows = device.installation_hash && Number(device.admin) !== 1
      ? this.db.prepare("SELECT id, hash FROM devices WHERE installation_hash=? AND admin=0").all(device.installation_hash)
      : [device];
    return rows.map(row => ({ id: String(row.id), hash: String(row.hash) }));
  }

  revokeDevice(id: string): boolean {
    return this.transaction(() => {
      const credentials = this.deviceCredentials(id);
      for (const credential of credentials) {
        this.db.prepare("DELETE FROM devices WHERE id=?").run(credential.id);
        this.activeAt.delete(credential.hash);
        this.seenAt.delete(credential.hash);
      }
      return credentials.length > 0;
    });
  }

  /** Lets a desktop revoke only the credential it is using. */
  revokeToken(token: string): boolean {
    return (
      Number(
        this.db
          .prepare("DELETE FROM devices WHERE hash=?")
          .run(this.hash(token)).changes,
      ) > 0
    );
  }

  authenticated(token: string): boolean {
    return !!this.db
      .prepare("SELECT id FROM devices WHERE hash=?")
      .get(this.hash(token));
  }

  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
  close(): void {
    for (const waiters of this.revisionWaiters.values())
      for (const finish of waiters) finish(new Error("Host store closed"));
    this.db.close();
  }
}

/** Lists carry the link's identity only; per-block ID arrays grow with history. */
function listedNativeLink(link: HostSession["session"]["nativeSession"]) {
  if (!link) return undefined;
  const { nativeIds: _nativeIds, ...rest } = link;
  return { ...rest, blockIds: [] };
}

export function summary(value: HostSession): HostSessionSummary {
  const lastUserMessage = value.session.blocks.findLast(
    (block) => block.role === "user" && !block.draft && !block.internal,
  );
  const sentAt = lastUserMessage?.sentAt ?? lastUserMessage?.startedAt;
  return {
    ...(value.remoteControl ? { remoteControl: true } : {}),
    ...(value.remoteControlDevice ? { remoteControlDevice: value.remoteControlDevice } : {}),
    projectId: value.projectId,
    interactionCapabilities: value.interactionCapabilities,
    supportsQueue: value.supportsQueue,
    canSteer: value.canSteer,
    revision: value.revision,
    runId: value.runId,
    status: value.status,
    updatedAt: value.updatedAt,
    activityAt: sessionMessageActivityAt(value.session, value.status === "running") ?? null,
    lastReplyRevision: replyRevision(value),
    lastCompletedRunId: value.lastCompletedRunId ?? null,
    pendingInputKey: pendingInputKey(value.session, value.runId),
    notificationPreview: sessionNotificationPreview(value.session),
    id: value.session.id,
    cwd: value.session.cwd,
    executionCwd: value.session.executionCwd || value.session.cwd,
    title: value.session.title,
    titleState: value.session.titleState,
    harness: value.session.harness as RemoteProvider,
    model: value.session.model,
    runtimeMode: value.session.runtimeMode,
    providerSessionId: value.session.providerSessionId ?? null,
    createdAt: value.createdAt ?? value.updatedAt,
    lastUserMessageAt:
      sentAt !== undefined && Number.isFinite(sentAt) && sentAt > 0
        ? sentAt
        : null,
    archived: value.archived,
    pinned: value.pinned,
    linkedWorkItem: value.session.linkedWorkItem,
    needsInput: sessionNeedsInput(value.session),
    draft: value.session.blocks.some((block) => block.role === "user" && block.draft),
    nativeSession: listedNativeLink(value.session.nativeSession),
    ...(value.nativeStatus ? { nativeStatus: value.nativeStatus } : {}),
    orchestration: value.orchestration,
    orchestrationLeadId: value.session.orchestrationLeadId,
    ...(value.session.workflowParentId ? { workflowParentId: value.session.workflowParentId } : {}),
    assistantOwnerId: value.session.assistantOwnerId,
  };
}

function isReplyBlock(block: Block): boolean {
  return !block.internal && (
    (block.role === "assistant" && !!block.text.trim()) ||
    block.role === "image" || block.role === "plan" ||
    !!block.notice || !!(block.approval && !block.approval.decided)
  );
}

function replyContentChanged(before: Block | undefined, next: Block): boolean {
  return !before || before.role !== next.role || before.text !== next.text ||
    JSON.stringify([before.image, before.attachments, before.approval?.requestId]) !==
      JSON.stringify([next.image, next.attachments, next.approval?.requestId]);
}

function replyRevision(value?: HostSession): number | null {
  if (!value) return null;
  if (value.lastReplyRevision != null) return value.lastReplyRevision;
  return value.session.blocks.reduce<number | null>((latest, block) => isReplyBlock(block)
    ? Math.max(latest ?? 0, value.blockRevisions?.[block.id] ?? value.revision)
    : latest, null);
}

/** Unchanged blocks keep their previous stamp. Identity is the fast path;
 * values re-read from disk fall back to a structural comparison. */
export function blockRevisions(
  previous: HostSession | undefined,
  next: HostSession,
): Record<string, number> {
  const before = new Map(
    previous?.session.blocks.map((block) => [block.id, block]),
  );
  const revisions: Record<string, number> = {};
  for (const block of next.session.blocks) {
    const old = before.get(block.id);
    const stamp = previous?.blockRevisions?.[block.id];
    revisions[block.id] =
      old &&
      stamp !== undefined &&
      (old === block || JSON.stringify(old) === JSON.stringify(block))
        ? stamp
        : next.revision;
  }
  return revisions;
}
