import { statSync, watch, type FSWatcher } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import type { HostSession } from "../../src/contracts/protocol";
import { DEFAULT_RUNTIME_MODE, type Block, type Session, type NativeBinding, type NativeSessionFile, type NativeSessionProvider, type NativeSourceListing, type NativeSourceSummary, type NativeSyncStatus, type NativeTranscript } from "../../src/contracts/session";
import { resolveModel } from "../../src/integrations/harness/core/modelCatalog";
import { NATIVE_SESSION_PROVIDERS } from "../../src/integrations/harness/core/nativeSessions";

import { parseNativeSession } from "./parser";
import {
  accountScoped,
  mergeNativeHistory,
  NATIVE_PENDING_TITLE,
  promptTitle,
  withNativeTitle,
} from "../../src/integrations/harness/core/nativeReconcile";
import type { HostStore } from "../store";
import type { NativeLease, NativeSessionGuard } from "../native-access";
import { NativeReader } from "./read";
import { copyNativeConversation, type CopiedNativeConversation } from "./account-copy";
import {
  OPENCODE_SESSIONS,
  findNativeSource,
  jsonlRevision,
  listNativeSessions,
  nativeSourceId,
  openCodeRow,
  openOpenCode,
  sourceFile,
  sourceFor,
  type SourceEnvironment,
} from "./sources";

/** What the manager needs from the engine; keeps turn bookkeeping in one place. */
export type NativeManagerHost = {
  store: HostStore;
  guard: NativeSessionGuard;
  desktopDirectory(): string | undefined;
  /** Apply a change to the latest value (including unflushed stream output) and save it. */
  mutate(id: string, change: (value: HostSession) => HostSession, event: unknown): HostSession;
  /** Save a new session row. */
  create(value: HostSession): HostSession;
  openProject(cwd: string): Promise<{ id: string }>;
  canSteer(provider: string): boolean;
  /** A turn is running or settling; history is not replaced underneath it. */
  busy(id: string): boolean;
  dispatch(id: string): void;
  stopProvider(id: string): Promise<void>;
};

export type NativeManagerOptions = {
  pollMs?: number;
  stableMs?: number;
  stableTimeoutMs?: number;
  retryDelays?: number[];
  /** Sessions opened by a client within this window stay watched. */
  watchWindowMs?: number;
  environment?: Omit<SourceEnvironment, "desktopDirectory">;
};

type Resolved = { file: NativeSessionFile & { dataDir: string } };

const AUTO_SYNC_KEY = "nativeAutoSync";
const LISTING_TTL = 10_000;
/** Managed IDs come from SQLite at most this often; Host-side changes refresh them at once. */
const MANAGED_TTL = 30_000;
const PARSED_LIMIT = 32;

export class NativeSyncError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
  }
}

const isNativeProvider = (value: string): value is NativeSessionProvider =>
  (NATIVE_SESSION_PROVIDERS as readonly string[]).includes(value);

/** Managed: the Host owns this conversation's native lifecycle. */
export const nativeManaged = (value: HostSession | undefined) =>
  value?.session.nativeSession?.mode === "managed";

/** Sends wait (queued) until a managed native session has caught up. */
export const nativeHolding = (value: HostSession) =>
  nativeManaged(value) && !!value.nativeStatus && value.nativeStatus.state !== "ready";

/**
 * Host owner of native Claude Code, Codex, Pi, omp and OpenCode histories:
 * source resolution, reads, watching, turn preparation/settlement, lazy
 * identity for OmniCode-started conversations, and automatic recovery.
 */
export class NativeSessionManager {
  private readonly reader = new NativeReader();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly retries = new Map<string, { timer: ReturnType<typeof setTimeout>; attempt: number }>();
  private readonly touched = new Map<string, number>();
  private readonly watchers = new Map<string, { path: string; watcher: FSWatcher }>();
  private readonly debounce = new Map<string, ReturnType<typeof setTimeout>>();
  /** Last resolved source per session, revalidated by revision before reuse. */
  private readonly resolved = new Map<string, NativeSessionFile & { dataDir: string }>();
  /** Parsed transcript per source path at one revision. */
  private readonly parsed = new Map<string, { revision: string; transcript: NativeTranscript }>();
  /** Lazily bound sessions whose source lookup already ran in this process. */
  private readonly lookedUp = new Set<string>();
  /** A provider switch invalidates reads that started for the old native source. */
  private readonly generations = new Map<string, number>();
  private managed?: { at: number; ids: string[] };
  private autoSyncValue?: boolean;
  private lastSyncedAt?: number;
  private listing?: { at: number; value: NativeSourceListing; files: Map<string, NativeSessionFile & { dataDir: string }> };
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private readonly options: Required<Omit<NativeManagerOptions, "environment">> & Pick<NativeManagerOptions, "environment">;

  constructor(private readonly host: NativeManagerHost, options: NativeManagerOptions = {}) {
    this.options = {
      pollMs: 5_000,
      stableMs: 250,
      stableTimeoutMs: 10_000,
      retryDelays: [1_000, 5_000, 30_000, 300_000],
      watchWindowMs: 30 * 60_000,
      ...options,
    };
  }

  private context(): SourceEnvironment {
    return { ...this.options.environment, desktopDirectory: this.host.desktopDirectory() };
  }

  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.poll(), this.options.pollMs);
    this.timer.unref?.();
    // Recover sessions that were syncing or settling a Host turn when the Host stopped.
    const statuses = this.summaryStatuses();
    for (const id of this.managedIds(true)) {
      const stored = statuses.get(id);
      if (statuses.has(id) && stored?.state === "ready" && !stored.hostTurn) continue;
      const value = this.host.store.peekSession(id);
      if (value && (value.nativeStatus?.state !== "ready" || value.nativeStatus.hostTurn))
        void this.refresh(id).catch(() => undefined);
    }
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    for (const retry of this.retries.values()) clearTimeout(retry.timer);
    for (const timer of this.debounce.values()) clearTimeout(timer);
    for (const entry of this.watchers.values()) entry.watcher.close();
    this.retries.clear();
    this.debounce.clear();
    this.watchers.clear();
  }

  autoSync(): boolean {
    if (this.autoSyncValue === undefined) {
      const row = this.host.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(AUTO_SYNC_KEY);
      this.autoSyncValue = row?.value !== "false";
    }
    return this.autoSyncValue;
  }

  setAutoSync(enabled: boolean): void {
    this.host.store.db
      .prepare("INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(AUTO_SYNC_KEY, String(enabled));
    this.autoSyncValue = enabled;
  }

  /** Refresh every managed conversation now ("Sync now"), one at a time. */
  async syncAll(): Promise<number> {
    const ids = this.managedIds(true);
    for (const id of ids) {
      this.touch(id);
      await this.refresh(id, { force: true }).catch(() => undefined);
    }
    return ids.length;
  }

  /** A client opened this session: keep its source watched for a while. */
  touch(id: string): void {
    this.touched.set(id, Date.now());
    this.track(id);
  }

  /** Stop tracking an outgoing provider after its link has been removed from storage. */
  detach(id: string): void {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.clearRetry(id);
    clearTimeout(this.debounce.get(id));
    this.debounce.delete(id);
    this.watchers.get(id)?.watcher.close();
    this.watchers.delete(id);
    this.resolved.delete(id);
    this.lookedUp.delete(id);
    this.touched.delete(id);
    this.managed = undefined;
  }

  /** Copy a conversation's native records into another account Home before it resumes there. */
  copyToAccount(provider: "claude" | "codex", providerSessionId: string, fromAccountId: string | undefined, toHome: string): CopiedNativeConversation | null {
    return copyNativeConversation({ provider, providerSessionId, fromAccountId, toHome, context: this.context() });
  }

  /** A managed session the cached ID list has not seen yet (saved by another writer). */
  private track(id: string): void {
    if (this.managed && !this.managed.ids.includes(id) && this.host.store.sessionSummary(id)?.nativeSession?.mode === "managed")
      this.managed = { ...this.managed, ids: [...this.managed.ids, id] };
  }

  private serial<T>(id: string, run: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    const tail = next.catch(() => undefined);
    this.chains.set(id, tail);
    void tail.then(() => {
      if (this.chains.get(id) === tail) this.chains.delete(id);
    });
    return next;
  }

  // ---------------------------------------------------------------- listing

  private scanning?: Promise<void>;

  async list(refresh = false): Promise<NativeSourceListing> {
    if (!refresh && this.listing && Date.now() - this.listing.at < LISTING_TTL) return this.withBindings(this.listing.value);
    // Concurrent requests share one scan of the provider directories.
    this.scanning ??= this.scan().finally(() => { this.scanning = undefined; });
    await this.scanning;
    return this.withBindings(this.listing!.value);
  }

  private async scan(): Promise<void> {
    const scanned = await listNativeSessions(this.context());
    const files = new Map<string, NativeSessionFile & { dataDir: string }>();
    const sources: NativeSourceSummary[] = scanned.sessions.map((file) => {
      const sourceId = nativeSourceId(file);
      files.set(sourceId, file);
      const { dataDir: _dataDir, ...summary } = file;
      return { ...summary, sourceId };
    });
    const value = { sources, warnings: scanned.warnings, scannedAt: Date.now(), autoSync: this.autoSync(), managedCount: 0 };
    this.listing = { at: Date.now(), value, files };
  }

  /** Every Host conversation, including assistant, Inbox and orchestration ones, claims its provider ID. */
  private bound(): Map<string, string> {
    const bound = new Map<string, string>();
    for (const summary of this.host.store.summaries())
      if (summary.providerSessionId) bound.set(`${summary.harness}:${summary.providerSessionId}`, summary.id);
    return bound;
  }

  private withBindings(value: NativeSourceListing): NativeSourceListing {
    const bound = this.bound();
    return {
      ...value,
      autoSync: this.autoSync(),
      managedCount: this.managedIds().length,
      ...(this.lastSyncedAt ? { lastSyncedAt: this.lastSyncedAt } : {}),
      sources: value.sources.map((source) => {
        const { boundSessionId: _old, ...rest } = source;
        const id = bound.get(`${source.provider}:${source.providerSessionId}`);
        return id ? { ...rest, boundSessionId: id } : rest;
      }),
    };
  }

  async importSource(sourceId: string): Promise<HostSession> {
    if (!/^[0-9a-f]{32}$/.test(sourceId)) throw new Error("Unknown native source");
    let file = this.listing?.files.get(sourceId);
    if (!file) {
      await this.list(true);
      file = this.listing?.files.get(sourceId);
    }
    if (!file) throw new Error("Native source is no longer available; refresh the list");
    const existing = this.bound().get(`${file.provider}:${file.providerSessionId}`);
    if (existing) return this.host.store.session(existing);
    const imported = file;
    return this.serial(`import:${imported.provider}:${imported.providerSessionId}`, async () => {
      const again = this.bound().get(`${imported.provider}:${imported.providerSessionId}`);
      if (again) return this.host.store.session(again);
      const current = sourceFile(imported.path, imported.providerSessionId, this.context(), imported.provider);
      const read = await this.reader.read(sourceFor(current.path, this.context(), current.provider), current);
      const parsedFile = { ...current, revision: read.revision };
      const transcript = parseNativeSession(read.content, parsedFile);
      if (!transcript.blocks.some((block) => block.role === "user"))
        throw new Error("Native session has no user messages yet");
      const project = await this.host.openProject(current.cwd);
      const now = Date.now();
      const base: Session = {
        id: randomUUID(),
        harness: current.provider,
        cwd: current.cwd,
        model: resolveModel(current.provider, transcript.model).id,
        modelSettings: transcript.modelSettings,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        title: promptTitle(transcript, current.provider),
        titleState: NATIVE_PENDING_TITLE,
        blocks: [],
        providerSessionId: current.providerSessionId,
        ...(accountScoped(current.provider) ? { providerAccountId: current.accountId ?? "default" } : {}),
      };
      const merged = mergeNativeHistory(base, parsedFile, transcript, { hostTurn: false, dataDir: current.dataDir });
      if (merged.kind !== "merged") throw new Error("Native session history could not be read");
      const session = withNativeTitle(merged.session, transcript.title ?? current.title);
      this.managed = undefined;
      return this.host.create({
        projectId: project.id,
        revision: 0,
        status: "idle",
        supportsQueue: true,
        canSteer: this.host.canSteer(current.provider),
        createdAt: transcript.createdAt,
        updatedAt: current.modifiedAt,
        nativeStatus: { state: "ready", revision: read.revision, checkedAt: now },
        session,
      });
    });
  }

  // ------------------------------------------------------------ resolution

  private resolve(id: string, session: Session): Resolved {
    const link = session.nativeSession!;
    if (link.provider !== session.harness || link.providerSessionId !== session.providerSessionId)
      throw new NativeSyncError("bindingMismatch", "Native session binding does not match this conversation");
    // An unchanged revision at the same path is the same source: skip header reads and discovery.
    const cached = this.resolved.get(id);
    if (cached && cached.path === link.path && cached.providerSessionId === link.providerSessionId &&
      this.currentRevision(cached) === cached.revision)
      return { file: cached };
    const file = this.locate(session);
    this.resolved.set(id, file);
    return { file };
  }

  private locate(session: Session): NativeSessionFile & { dataDir: string } {
    const link = session.nativeSession!;
    try {
      return sourceFile(link.path, link.providerSessionId, this.context(), link.provider);
    } catch (error) {
      // A moved data directory is re-resolved by identity; never guessed.
      let found;
      try {
        found = findNativeSource(link.provider, link.providerSessionId, link.accountId ?? session.providerAccountId, this.context());
      } catch (ambiguous) {
        throw new NativeSyncError("sourceAmbiguous", (ambiguous as Error).message);
      }
      if (!found) throw new NativeSyncError("sourceMissing", (error as Error).message);
      return found;
    }
  }

  private currentRevision(file: Pick<NativeSessionFile, "path" | "providerSessionId" | "storage">): string | undefined {
    try {
      if (file.storage === "sqlite") {
        const db = openOpenCode(file.path);
        try {
          const row = db.prepare(`${OPENCODE_SESSIONS} AND s.id = ?`).get(file.providerSessionId);
          return row ? openCodeRow({ provider: "opencode", root: file.path, dataDir: "", storage: { kind: "sqlite" } }, file.path, row as Record<string, unknown>)?.revision : undefined;
        } finally {
          db.close();
        }
      }
      return jsonlRevision(statSync(file.path, { bigint: true }));
    } catch {
      return undefined;
    }
  }

  private async read(file: NativeSessionFile & { dataDir: string }): Promise<{ file: NativeSessionFile & { dataDir: string }; transcript: NativeTranscript }> {
    const source = sourceFor(file.path, this.context(), file.provider);
    let read;
    try {
      read = await this.reader.read(source, file);
    } catch (error) {
      throw new NativeSyncError("readFailed", (error as Error).message);
    }
    const current = { ...file, revision: read.revision };
    const key = `${file.path}#${file.providerSessionId}`;
    const hit = this.parsed.get(key);
    if (hit?.revision === read.revision) return { file: current, transcript: hit.transcript };
    try {
      const transcript = parseNativeSession(read.content, current);
      this.parsed.delete(key);
      this.parsed.set(key, { revision: read.revision, transcript });
      if (this.parsed.size > PARSED_LIMIT) this.parsed.delete(this.parsed.keys().next().value!);
      return { file: current, transcript };
    } catch (error) {
      this.reader.forget(file.path);
      this.parsed.delete(key);
      throw new NativeSyncError("parseFailed", (error as Error).message);
    }
  }

  // ------------------------------------------------------------------ sync

  /** Bring an idle (or preparing) managed session up to its source. */
  refresh(id: string, options: { force?: boolean } = {}): Promise<NativeSyncStatus | undefined> {
    const generation = this.generations.get(id);
    return this.serial(id, () => generation === this.generations.get(id)
      ? this.syncNow(id, { force: options.force })
      : Promise.resolve(this.host.store.sessionIfExists(id)?.nativeStatus));
  }

  private status(value: HostSession, next: Omit<NativeSyncStatus, "checkedAt">): HostSession {
    return { ...value, nativeStatus: { ...next, checkedAt: Date.now() } };
  }

  private sameStatus(a: NativeSyncStatus | undefined, b: Omit<NativeSyncStatus, "checkedAt">): boolean {
    return !!a && a.state === b.state && a.reason === b.reason && a.message === b.message &&
      a.revision === b.revision && !!a.pendingChange === !!b.pendingChange && !!a.hostTurn === !!b.hostTurn &&
      a.retryAt === b.retryAt;
  }

  private setStatus(id: string, next: Omit<NativeSyncStatus, "checkedAt">, event: unknown): void {
    const value = this.host.store.sessionIfExists(id);
    if (!value || this.sameStatus(value.nativeStatus, next)) return;
    this.host.mutate(id, (current) => this.status(current, next), event);
  }

  private async syncNow(
    id: string,
    options: { force?: boolean; hostTurn?: boolean; turnBlockId?: string; startTurn?: boolean } = {},
  ): Promise<NativeSyncStatus | undefined> {
    const value = this.host.store.sessionIfExists(id);
    if (!value?.session.nativeSession) return undefined;
    if (!nativeManaged(value)) return value.nativeStatus;
    const generation = this.generations.get(id);
    const currentSource = () => {
      const current = this.host.store.sessionIfExists(id)?.session;
      return generation === this.generations.get(id) &&
        current?.harness === value.session.harness &&
        current.nativeSession?.providerSessionId === value.session.nativeSession!.providerSessionId;
    };
    if (this.host.busy(id) && options.turnBlockId === undefined && !options.hostTurn) {
      // Never replace history under a running turn; settlement reads it.
      this.setStatus(id, { ...(value.nativeStatus ?? { state: "ready" }), pendingChange: true }, { type: "native.pending" });
      return this.host.store.session(id).nativeStatus;
    }
    const hostTurn = !!options.hostTurn || !!value.nativeStatus?.hostTurn;
    try {
      const { file } = this.resolve(id, value.session);
      if (
        !options.force && !hostTurn && options.turnBlockId === undefined &&
        value.session.nativeSession.revision === file.revision && value.session.nativeSession.path === file.path &&
        value.nativeStatus?.state === "ready" && !value.nativeStatus.pendingChange
      )
        return value.nativeStatus;
      const unchanged = value.session.nativeSession.revision === file.revision && value.session.nativeSession.path === file.path;
      // Turn preparation and settlement run under a visible turn, and an unchanged
      // source is only re-checked; only idle syncs of new records announce themselves.
      if (!hostTurn && options.turnBlockId === undefined && !unchanged && (!value.nativeStatus || value.nativeStatus.state === "ready"))
        this.setStatus(id, { ...(value.nativeStatus ?? {}), state: "syncing", revision: value.nativeStatus?.revision ?? value.session.nativeSession.revision }, { type: "native.syncing" });
      const { file: read, transcript } = await this.read(file);
      if (!currentSource()) return this.host.store.sessionIfExists(id)?.nativeStatus;
      this.resolved.set(id, read);
      let diverged: string[] | undefined;
      let deferred: string | undefined;
      const saved = this.host.mutate(id, (current) => {
        const blocks = current.session.blocks;
        let split = blocks.length;
        if (options.turnBlockId !== undefined) {
          const index = blocks.findIndex((block) => block.id === options.turnBlockId);
          if (index >= 0) split = index;
        }
        const base = { ...current.session, blocks: blocks.slice(0, split).filter((block) => !block.draft) };
        const turn = blocks.slice(split).filter((block) => !block.draft);
        const drafts = blocks.filter((block) => block.draft);
        let result;
        try {
          result = mergeNativeHistory(base, read, transcript, { hostTurn, dataDir: read.dataDir });
        } catch (error) {
          deferred = (error as Error).message;
          return this.status(current, { state: "error", reason: "deferred", message: deferred, revision: current.nativeStatus?.revision });
        }
        if (result.kind === "diverged") {
          diverged = result.missing;
          return this.status(current, {
            state: "error",
            reason: "diverged",
            message: "The native conversation was rewound or switched branches outside OmniCode. History is kept; sending is paused.",
            revision: current.nativeStatus?.revision,
          });
        }
        const titled = withNativeTitle(result.session, transcript.title ?? read.title);
        const next = { state: "ready" as const, revision: read.revision, ...(options.startTurn ? { hostTurn: true } : {}) };
        // Nothing new in the source: keep the stored value and skip the write.
        if (
          !result.changed && titled.title === current.session.title && titled.titleState === current.session.titleState &&
          this.sameStatus(current.nativeStatus, next)
        )
          return current;
        const session: Session = { ...titled, blocks: [...titled.blocks.filter((block) => !block.draft), ...turn, ...drafts] };
        // Opening, ownership checks and title/link updates are not conversation
        // activity. External messages use their source time, not the sync time.
        const knownIds = new Set(current.session.blocks.map((block) => block.id));
        const addedHistory = !hostTurn && titled.blocks.some((block) => !block.draft && !knownIds.has(block.id));
        const updatedAt = addedHistory ? Math.max(current.updatedAt, read.modifiedAt) : current.updatedAt;
        return this.status({ ...current, session, updatedAt }, next);
      }, { type: "native.synced", revision: read.revision, hostTurn });
      this.clearRetry(id);
      this.track(id);
      this.lastSyncedAt = Date.now();
      if (diverged || deferred) {
        // Divergence waits for 031's resolution; only a new source revision retries it.
        return saved.nativeStatus;
      }
      this.after(id);
      return saved.nativeStatus;
    } catch (error) {
      if (!currentSource()) return this.host.store.sessionIfExists(id)?.nativeStatus;
      const reason = error instanceof NativeSyncError ? error.reason : "persistFailed";
      this.fail(id, reason, (error as Error).message);
      if (options.turnBlockId !== undefined) throw error;
      return this.host.store.sessionIfExists(id)?.nativeStatus;
    }
  }

  private fail(id: string, reason: string, message: string): void {
    const attempt = (this.retries.get(id)?.attempt ?? -1) + 1;
    const delays = this.options.retryDelays;
    const delay = delays[Math.min(attempt, delays.length - 1)];
    const retryAt = Date.now() + delay;
    try {
      const value = this.host.store.sessionIfExists(id);
      if (value)
        this.setStatus(id, { state: "error", reason, message, revision: value.nativeStatus?.revision, hostTurn: value.nativeStatus?.hostTurn, retryAt }, { type: "native.failed", reason });
    } catch (error) {
      console.error("Could not record native sync failure:", error instanceof Error ? error.message : error);
    }
    if (this.closed) return;
    clearTimeout(this.retries.get(id)?.timer);
    const timer = setTimeout(() => {
      void this.serial(id, () => this.syncNow(id)).catch(() => undefined);
    }, delay);
    timer.unref?.();
    this.retries.set(id, { timer, attempt });
  }

  private clearRetry(id: string): void {
    const retry = this.retries.get(id);
    if (retry) clearTimeout(retry.timer);
    this.retries.delete(id);
  }

  /** Writable again: dispatch what waited in the queue. */
  private after(id: string): void {
    const value = this.host.store.sessionIfExists(id);
    if (!value || value.status === "running" || this.host.busy(id)) return;
    if (value.nativeStatus?.state === "ready" && value.session.queuedMessages?.length) this.host.dispatch(id);
  }

  // ------------------------------------------------------------- turns

  /**
   * Before a Host turn writes: take the writer lease, recheck ownership under
   * it, and catch history up to the source. The turn's own blocks stay last.
   */
  prepare(id: string, turnBlockId: string): Promise<NativeLease> {
    return this.serial(id, async () => {
      const value = this.host.store.session(id);
      const link = value.session.nativeSession!;
      const lease = await this.host.guard.acquire(id, link, value.session.cwd);
      try {
        const status = await this.syncNow(id, { turnBlockId, startTurn: true });
        if (status?.state !== "ready")
          throw new Error(status?.message ?? "Native history could not be synchronized before this turn");
        return lease;
      } catch (error) {
        await lease.release();
        throw error;
      }
    });
  }

  /** Wait until the stopped provider's last write has landed. */
  private async stable(file: Pick<NativeSessionFile, "path" | "providerSessionId" | "storage">): Promise<void> {
    const deadline = Date.now() + this.options.stableTimeoutMs;
    let previous = this.currentRevision(file);
    while (Date.now() < deadline) {
      await sleep(this.options.stableMs);
      const next = this.currentRevision(file);
      if (next === previous) return;
      previous = next;
    }
  }

  /**
   * Shared settlement for success, failure, cancellation and compaction. The
   * provider has stopped; the lease is released only after history is saved,
   * even when synchronization fails (it then retries on its own).
   */
  settle(id: string, lease: NativeLease | undefined): Promise<void> {
    return this.serial(id, async () => {
      try {
        const value = this.host.store.sessionIfExists(id);
        const link = value?.session.nativeSession;
        if (value && link && nativeManaged(value)) {
          await this.stable(link);
          await this.syncNow(id, { hostTurn: true });
        }
      } finally {
        await lease?.release();
      }
    });
  }

  // --------------------------------------------------------- lazy identity

  /**
   * After a turn of a OmniCode-started conversation: remember where its native
   * source lives and its revision, without taking a lease or watching it.
   */
  recordLazy(id: string): void {
    const value = this.host.store.sessionIfExists(id);
    if (!value || value.session.nativeSession || !value.session.providerSessionId || !isNativeProvider(value.session.harness)) return;
    const binding: NativeBinding = value.nativeBinding?.providerSessionId === value.session.providerSessionId
      ? { ...value.nativeBinding }
      : {
          provider: value.session.harness,
          providerSessionId: value.session.providerSessionId,
          ...(value.session.providerAccountId ? { accountId: value.session.providerAccountId } : {}),
        };
    if (!binding.path && !this.lookedUp.has(id)) {
      // A source not found after the first turn is not rescanned after every turn.
      this.lookedUp.add(id);
      try {
        const found = findNativeSource(binding.provider, binding.providerSessionId, binding.accountId, this.context());
        if (found) Object.assign(binding, { path: found.path, storage: found.storage, dataDir: found.dataDir });
      } catch {
        /* Ambiguous sources stay unresolved; identity is still recorded. */
      }
    }
    if (binding.path) binding.hostRevision = this.currentRevision({ path: binding.path, providerSessionId: binding.providerSessionId, storage: binding.storage });
    if (JSON.stringify(binding) === JSON.stringify(value.nativeBinding)) return;
    this.host.mutate(id, (current) => ({ ...current, nativeBinding: binding }), { type: "native.bound" });
  }

  /**
   * Before a send on a lazily bound conversation: if another writer changed its
   * source since the last Host turn, stop the warm process, take over the
   * conversation as a managed native session and merge the external records.
   * Returns true when the session is now managed.
   */
  promoteIfChanged(id: string): Promise<boolean> {
    const generation = this.generations.get(id);
    return this.serial(id, async () => {
      if (generation !== this.generations.get(id)) return false;
      const value = this.host.store.session(id);
      const binding = value.nativeBinding;
      if (value.session.nativeSession || !binding?.path || !binding.hostRevision) return false;
      if (value.session.assistantOwnerId || value.session.orchestrationLeadId || value.session.workflowParentId || value.session.inboxAsk) return false;
      const ref = { path: binding.path, providerSessionId: binding.providerSessionId, storage: binding.storage };
      const revision = this.currentRevision(ref);
      if (!revision || revision === binding.hostRevision) return false;
      let file;
      try {
        file = sourceFile(binding.path, binding.providerSessionId, this.context(), binding.provider);
      } catch {
        return false;
      }
      const { file: read, transcript } = await this.read(file);
      const hostIds = new Set((await this.hostTranscript(read, binding.hostRevision)).blocks.map((block) => block.id));
      if (generation !== this.generations.get(id)) return false;
      const external = transcript.blocks.filter((block) => !hostIds.has(block.id));
      if (!external.length) {
        // Metadata rows (titles, summaries) only: keep warm reuse.
        this.host.mutate(id, (current) => ({ ...current, nativeBinding: { ...binding, hostRevision: revision } }), { type: "native.bound" });
        return false;
      }
      if (this.host.store.project(value.projectId).machine?.kind === "wsl")
        throw new Error("This WSL conversation changed in another application. Switch agents to continue with a history handoff; native ownership across Windows and WSL is not supported yet.");
      await this.host.stopProvider(id);
      if (generation !== this.generations.get(id)) return false;
      this.host.mutate(id, (current) => {
        const blocks = current.session.blocks;
        const turnIndex = blocks.findLastIndex((block) => block.role === "user" && !block.draft);
        const history = blocks.slice(0, turnIndex < 0 ? blocks.length : turnIndex).filter((block) => !block.draft);
        const link: Session["nativeSession"] = {
          provider: binding.provider,
          providerSessionId: binding.providerSessionId,
          createdAt: transcript.createdAt,
          updatedAt: read.modifiedAt,
          path: read.path,
          revision: binding.hostRevision!,
          blockIds: history.map((block) => block.id),
          nativeIds: [...hostIds],
          mode: "managed",
          ...(read.storage ? { storage: read.storage } : {}),
          ...(read.accountId ? { accountId: read.accountId } : {}),
          dataDir: read.dataDir,
        };
        const { nativeBinding: _binding, ...rest } = current;
        return this.status({ ...rest, session: { ...current.session, nativeSession: link } }, { state: "syncing", revision: binding.hostRevision });
      }, { type: "native.promoted" });
      this.managed = undefined;
      return true;
    });
  }

  /** Records written by Host turns: the source as it was at `hostRevision`. */
  private async hostTranscript(file: NativeSessionFile, hostRevision: string): Promise<NativeTranscript> {
    if (file.storage === "sqlite") {
      const cutoff = Number(hostRevision.split(":")[1] ?? 0);
      const read = await this.reader.read(sourceFor(file.path, this.context(), file.provider), file);
      const data = JSON.parse(read.content) as { session: unknown; messages: { timeCreated: number }[] };
      return parseNativeSession(JSON.stringify({ ...data, messages: data.messages.filter((message) => message.timeCreated <= cutoff) }), file);
    }
    const size = Number(hostRevision.split(":")[0]);
    if (!Number.isSafeInteger(size) || size <= 0) return { createdAt: 0, blocks: [], modelSettings: {} };
    return parseNativeSession(await this.reader.prefix(file, size), file);
  }

  // ------------------------------------------------------------- watching

  private watched(value: HostSession): boolean {
    if (!nativeManaged(value)) return false;
    const touched = this.touched.get(value.session.id) ?? 0;
    return (
      this.host.busy(value.session.id) ||
      !!value.session.queuedMessages?.length ||
      value.nativeStatus?.state !== "ready" ||
      !!value.nativeStatus.pendingChange ||
      Date.now() - touched < this.options.watchWindowMs
    );
  }

  /** Managed sessions from the cheap summary index, without parsing every transcript. */
  /** Each managed session's stored native status, read from the summary
   * index so scans can pass over settled conversations without parsing them. */
  private summaryStatuses(): Map<string, NativeSyncStatus | undefined> {
    return new Map(
      this.host.store.db
        .prepare("SELECT id, json_extract(summary, '$.nativeStatus') AS status FROM sessions WHERE json_extract(summary, '$.nativeSession.mode') = 'managed'")
        .all()
        .map((row) => [
          String(row.id),
          row.status == null ? undefined : (JSON.parse(String(row.status)) as NativeSyncStatus),
        ]),
    );
  }

  /** False only when `watched` cannot hold for the stored transcript. */
  private mayBeWatched(id: string, statuses: Map<string, NativeSyncStatus | undefined>): boolean {
    if (!statuses.has(id)) return true;
    const status = statuses.get(id);
    return (
      this.host.busy(id) ||
      Date.now() - (this.touched.get(id) ?? 0) < this.options.watchWindowMs ||
      status?.state !== "ready" ||
      !!status.pendingChange ||
      this.host.store.hasQueuedMessages(id)
    );
  }

  private managedIds(fresh = false): string[] {
    if (!fresh && this.managed && Date.now() - this.managed.at < MANAGED_TTL) return this.managed.ids;
    // Served from the covering summary index; transcripts stay unparsed.
    const ids = this.host.store.db
      .prepare("SELECT id FROM sessions WHERE json_extract(summary, '$.nativeSession.mode') = 'managed'")
      .all()
      .map((row) => String(row.id))
      .filter((id) => !this.host.store.isRetired(id));
    this.managed = { at: Date.now(), ids };
    return ids;
  }

  /** Stat fallback for lost watch events, and watcher bookkeeping. */
  poll(): void {
    if (this.closed) return;
    const auto = this.autoSync();
    const keep = new Set<string>();
    // Every few seconds: decide from summaries first. Parsing every managed
    // transcript here took about a second per pass on large histories and
    // pushed the conversations clients were reading out of the cache.
    const statuses = this.summaryStatuses();
    for (const id of this.managedIds()) {
      if (!this.mayBeWatched(id, statuses)) continue;
      const value = this.host.store.peekSession(id);
      if (!value || !this.watched(value)) continue;
      const link = value.session.nativeSession!;
      keep.add(id);
      if (auto) this.watch(id, link.path);
      const busy = this.host.busy(id);
      if (busy) continue;
      if (value.nativeStatus?.pendingChange) {
        void this.refresh(id).catch(() => undefined);
        continue;
      }
      if (!auto || this.retries.has(id)) continue;
      const revision = this.currentRevision(link);
      if (revision && revision !== link.revision) void this.refresh(id).catch(() => undefined);
    }
    for (const id of this.resolved.keys()) if (!keep.has(id)) this.resolved.delete(id);
    for (const [id, entry] of this.watchers)
      if (!keep.has(id) || !auto) {
        entry.watcher.close();
        this.watchers.delete(id);
      }
  }

  private watch(id: string, path: string): void {
    const existing = this.watchers.get(id);
    if (existing?.path === path) return;
    existing?.watcher.close();
    try {
      const watcher = watch(path, { persistent: false }, () => this.changed(id));
      watcher.on("error", () => {
        watcher.close();
        if (this.watchers.get(id)?.watcher === watcher) this.watchers.delete(id);
      });
      this.watchers.set(id, { path, watcher });
    } catch {
      /* The stat fallback still covers this source. */
    }
  }

  private changed(id: string): void {
    clearTimeout(this.debounce.get(id));
    const timer = setTimeout(() => {
      this.debounce.delete(id);
      if (this.closed || !this.autoSync()) return;
      void this.refresh(id).catch(() => undefined);
    }, 200);
    timer.unref?.();
    this.debounce.set(id, timer);
  }
}

export type { Block };
