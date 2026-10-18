import {
  isRemoteProjectPath,
  sameProjectPath,
} from "../../features/projects/model/recents";
import { rememberLoadedSession } from "../../features/sessions/data/sessionCache";
import {
  mergeProjectHistorySummary,
  replaceProjectHistory,
} from "../../features/sessions/data/sessionHistory";
import {
  persistFingerprint,
  shouldPersistSession,
  type SessionSummary,
} from "../../features/sessions/data/sessionStore";
import type { Session } from "../../features/sessions/model/session";
import { pathKey } from "../../shared/lib/paths";
import { createProjectHistoryLoader } from "./projectHistoryLoader";
import { lastUserBlockId } from "./sessionTransforms";

type Storage = {
  get: (id: string) => Promise<Session | null>;
  save: (session: Session) => Promise<SessionSummary | null>;
  list: (cwd: string) => Promise<SessionSummary[]>;
  linked: () => Promise<SessionSummary[]>;
  flush: () => Promise<void>;
  rebase: (from: string, to: string) => Promise<unknown>;
};

type Options = {
  storage: Storage;
  live: () => readonly Session[];
  isSwitching: (id: string) => boolean;
  history?: SessionSummary[];
  historyCwd?: string | null;
};

export type WorkspaceSessionSnapshot = {
  history: SessionSummary[];
  storedLinkedSessions: SessionSummary[];
  loadedProjects: ReadonlySet<string>;
  failedProjectPaths: ReadonlySet<string>;
};

const SAVE_DELAY_MS = 650;
const SAVE_MAX_WAIT_MS = 5_000;

/** Owns desktop session reads, retained transcripts, summary state and save scheduling. */
export class WorkspaceSessionData {
  private state: WorkspaceSessionSnapshot;
  private listeners = new Set<() => void>();
  private cache = new Map<string, Session>();
  private loads = new Map<string, Promise<Session | null>>();
  private readVersions = new Map<string, number>();
  private opening = new Map<string, symbol>();
  private removing = new Set<string>();
  private prefetching: Promise<Session | null> | null = null;
  private persisted = new Map<string, string>();
  private boundProviders = new Map<string, string>();
  private userBlocks = new Map<string, string>();
  private observed = new Map<string, Session>();
  private pending = new Map<string, Session>();
  private writeVersions = new Map<string, number>();
  private writes = new Map<
    string,
    { fingerprint: string; promise: Promise<SessionSummary | null> }
  >();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirtySince: number | null = null;
  private restored = false;
  private active = true;
  private lifecycle = 0;
  private linkedVersion = 0;
  private summaryVersion = 0;
  private summaryChanges = new Map<string, number>();
  private historyReads = new Map<string, number>();
  private hiddenProjects = new Set<string>();
  private rebasingProjects = new Set<string>();
  private projectVersions = new Map<string, number>();
  private historyLoader: ReturnType<
    typeof createProjectHistoryLoader<SessionSummary>
  >;

  constructor(private options: Options) {
    const history = options.history ?? [];
    this.state = {
      history,
      storedLinkedSessions: history.filter((session) => session.linkedWorkItem),
      loadedProjects: new Set(
        options.historyCwd ? [pathKey(options.historyCwd)] : [],
      ),
      failedProjectPaths: new Set(),
    };
    this.historyLoader = createProjectHistoryLoader({
      list: options.storage.list,
      start: (cwd) => {
        this.historyReads.set(pathKey(cwd), this.summaryVersion);
        const failedProjectPaths = new Set(this.state.failedProjectPaths);
        if (failedProjectPaths.delete(pathKey(cwd)))
          this.publish({ failedProjectPaths });
      },
      success: (cwd, rows, startedAt) => {
        if (!this.active || this.hiddenProjects.has(pathKey(cwd))) return;
        const version = this.historyReads.get(pathKey(cwd)) ?? 0;
        const fetchedIds = new Set(rows.map((row) => row.id));
        const changed = this.state.history.filter(
          (entry) =>
            (sameProjectPath(entry.cwd, cwd) || fetchedIds.has(entry.id)) &&
            (entry.updatedAt >= startedAt ||
              (this.summaryChanges.get(entry.id) ?? 0) > version),
        );
        // A row deleted while this read was running must not reappear.
        const currentIds = new Set(this.state.history.map((entry) => entry.id));
        const validRows = rows.filter(
          (row) =>
            !this.removing.has(row.id) &&
            !(
              (this.summaryChanges.get(row.id) ?? 0) > version &&
              !currentIds.has(row.id)
            ),
        );
        let history = replaceProjectHistory(this.state.history, cwd, validRows);
        for (const entry of changed) {
          const fetched = rows.find((row) => row.id === entry.id);
          if (
            !fetched ||
            fetched.updatedAt < entry.updatedAt ||
            (this.summaryChanges.get(entry.id) ?? 0) > version
          )
            history = mergeProjectHistorySummary(history, entry);
        }
        this.publish({
          history,
          loadedProjects: new Set(this.state.loadedProjects).add(pathKey(cwd)),
        });
      },
      failure: (cwd) => {
        if (this.active && !this.hiddenProjects.has(pathKey(cwd)))
          this.publish({
            failedProjectPaths: new Set(this.state.failedProjectPaths).add(
              pathKey(cwd),
            ),
          });
      },
    });
  }

  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<WorkspaceSessionSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private changed(id: string) {
    this.summaryChanges.set(id, ++this.summaryVersion);
  }
  private blocked(id: string) {
    return this.removing.has(id) || this.options.isSwitching(id);
  }

  start = () => {
    this.active = true;
  };
  stop = () => {
    this.active = false;
    this.lifecycle++;
    this.linkedVersion++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dirtySince = null;
    this.pending.clear();
    this.observed.clear();
    this.invalidateAllLoads();
    this.opening.clear();
    for (const cwd of this.historyReads.keys())
      this.historyLoader.invalidate(cwd);
    this.writes.clear();
  };

  restore = (sessions: readonly Session[] | undefined) => {
    if (this.restored || !sessions?.length) return;
    this.restored = true;
    for (const session of sessions) {
      this.observed.set(session.id, session);
      this.acknowledge(session);
      const userId = lastUserBlockId(session);
      if (userId) this.userBlocks.set(session.id, userId);
      if (session.providerSessionId)
        this.boundProviders.set(session.id, session.providerSessionId);
    }
  };

  refreshHistory = (cwd: string, force = false) => {
    if (isRemoteProjectPath(cwd)) return Promise.resolve();
    this.hiddenProjects.delete(pathKey(cwd));
    return this.historyLoader.load(cwd, force);
  };

  refreshLinked = () => {
    const version = ++this.linkedVersion;
    const changes = this.summaryVersion;
    void this.options.storage
      .linked()
      .then((rows) => {
        if (!this.active || version !== this.linkedVersion) return;
        const current = new Map(
          this.state.storedLinkedSessions.map((row) => [row.id, row]),
        );
        const result = new Map(
          rows
            .filter((row) => !this.removing.has(row.id))
            .map((row) => [row.id, row]),
        );
        for (const [id, changedAt] of this.summaryChanges) {
          if (changedAt <= changes) continue;
          const row = current.get(id);
          if (row) result.set(id, row);
          else result.delete(id);
        }
        this.publish({ storedLinkedSessions: [...result.values()] });
      })
      .catch(() => undefined);
    return () => {
      if (this.linkedVersion === version) this.linkedVersion++;
    };
  };

  mergeSummary = (summary: SessionSummary) => {
    this.changed(summary.id);
    if (this.hiddenProjects.has(pathKey(summary.cwd))) return;
    this.publish({
      history: mergeProjectHistorySummary(this.state.history, summary),
    });
  };

  /** Transform both summary indexes together; a removed link leaves the linked index. */
  updateSummaries = (
    change: (summary: SessionSummary) => SessionSummary | null,
  ) => {
    const map = (rows: SessionSummary[], linked = false) => {
      let changed = false;
      const next = rows.flatMap((row) => {
        const updated = change(row);
        const keep = updated && (!linked || updated.linkedWorkItem);
        if (!keep || updated !== row) {
          changed = true;
          this.changed(row.id);
        }
        return keep ? [updated] : [];
      });
      return changed ? next : rows;
    };
    const history = map(this.state.history);
    const storedLinkedSessions = map(this.state.storedLinkedSessions, true);
    if (
      history !== this.state.history ||
      storedLinkedSessions !== this.state.storedLinkedSessions
    )
      this.publish({ history, storedLinkedSessions });
  };

  updateSummary = (
    id: string,
    change: (summary: SessionSummary) => SessionSummary,
    fallback?: SessionSummary,
  ) => {
    const current = this.state.history.find((row) => row.id === id) ?? fallback;
    if (!current) return;
    const updated = change(current);
    this.changed(id);
    this.publish({
      history: mergeProjectHistorySummary(this.state.history, updated),
      storedLinkedSessions: this.state.storedLinkedSessions.flatMap((row) =>
        row.id !== id ? [row] : updated.linkedWorkItem ? [updated] : [],
      ),
    });
  };

  load = (id: string): Promise<Session | null> => {
    if (!this.active || this.removing.has(id)) return Promise.resolve(null);
    const cached = this.cache.get(id);
    if (cached) {
      this.cache.delete(id);
      const version = this.readVersions.get(id) ?? 0;
      const lifecycle = this.lifecycle;
      return Promise.resolve().then(() =>
        this.active &&
        lifecycle === this.lifecycle &&
        version === (this.readVersions.get(id) ?? 0) &&
        !this.removing.has(id)
          ? cached
          : null,
      );
    }
    const pending = this.loads.get(id);
    if (pending) return pending;
    const version = this.readVersions.get(id) ?? 0;
    const lifecycle = this.lifecycle;
    const loading = this.options.storage
      .get(id)
      .then((loaded) =>
        this.active &&
        lifecycle === this.lifecycle &&
        !this.removing.has(id) &&
        version === (this.readVersions.get(id) ?? 0)
          ? loaded
          : null,
      )
      .catch(() => null);
    this.loads.set(id, loading);
    void loading.then(() => {
      if (this.loads.get(id) === loading) this.loads.delete(id);
    });
    return loading;
  };

  prefetch = (id: string) => {
    if (
      this.removing.has(id) ||
      this.cache.has(id) ||
      this.loads.has(id) ||
      this.prefetching ||
      this.options.live().some((s) => s.id === id)
    )
      return;
    const version = this.readVersions.get(id) ?? 0;
    const loading = this.load(id);
    this.prefetching = loading;
    void loading.then((session) => {
      if (
        session &&
        version === (this.readVersions.get(id) ?? 0) &&
        !this.removing.has(id) &&
        !this.options.live().some((s) => s.id === id)
      )
        this.retain(session);
      if (this.prefetching === loading) this.prefetching = null;
    });
  };

  invalidate = (id: string) => {
    this.opening.delete(id);
    this.cache.delete(id);
    if (this.prefetching === this.loads.get(id)) this.prefetching = null;
    this.loads.delete(id);
    this.readVersions.set(id, (this.readVersions.get(id) ?? 0) + 1);
  };
  invalidateAllLoads = () => {
    for (const id of new Set([...this.cache.keys(), ...this.loads.keys()]))
      this.invalidate(id);
    this.prefetching = null;
  };
  evict = (id: string) => {
    this.cache.delete(id);
  };
  retain = (session: Session) => {
    rememberLoadedSession(this.cache, session);
  };
  beginOpening = (id: string) => {
    const request = Symbol(id);
    this.opening.set(id, request);
    return () => {
      if (this.opening.get(id) === request) this.opening.delete(id);
    };
  };
  isOpening = (id: string) => this.opening.has(id);
  activate = (id: string) => {
    this.opening.delete(id);
    this.cache.delete(id);
  };
  isRemoving = (id: string) => this.removing.has(id);
  beginRemoval = (id: string) => {
    this.removing.add(id);
    this.invalidate(id);
    this.cancelSave(id);
  };
  endRemoval = (id: string) => {
    this.removing.delete(id);
    this.observed.delete(id);
    const session = this.options.live().find((s) => s.id === id);
    if (session && shouldPersistSession(session)) {
      this.pending.set(id, session);
      this.schedule();
    }
  };

  cancelSave = (id: string) => {
    this.pending.delete(id);
    this.writeVersions.set(id, (this.writeVersions.get(id) ?? 0) + 1);
    this.writes.delete(id);
  };
  resetPersistence = (id: string) => {
    this.cancelSave(id);
    this.persisted.delete(id);
    this.userBlocks.delete(id);
    this.boundProviders.delete(id);
    this.observed.delete(id);
  };
  forget = (id: string) => {
    this.invalidate(id);
    this.resetPersistence(id);
    this.changed(id);
    this.updateSummaries((row) => (row.id === id ? null : row));
  };
  acknowledge = (session: Session, summary?: SessionSummary) => {
    this.persisted.set(session.id, persistFingerprint(session));
    if (summary) this.mergeSummary(summary);
  };
  acceptExternal = (session: Session, summary: SessionSummary) => {
    if (!this.active || this.removing.has(session.id)) return false;
    this.invalidate(session.id);
    this.cancelSave(session.id);
    this.acknowledge(session, summary);
    return true;
  };

  persist = (session: Session | undefined): Promise<SessionSummary | null> => {
    if (
      !this.active ||
      !session ||
      !shouldPersistSession(session) ||
      this.blocked(session.id)
    )
      return Promise.resolve(null);
    const id = session.id;
    if (this.rebasingProjects.has(pathKey(session.cwd))) {
      this.pending.set(id, session);
      return Promise.resolve(null);
    }
    const fingerprint = persistFingerprint(session);
    if (this.persisted.get(id) === fingerprint) return Promise.resolve(null);
    const previous = this.writes.get(id);
    if (previous?.fingerprint === fingerprint) return previous.promise;
    const version = this.writeVersions.get(id) ?? 0;
    const lifecycle = this.lifecycle;
    const summaryVersion = this.summaryChanges.get(id) ?? 0;
    const projectVersion = this.projectVersions.get(pathKey(session.cwd)) ?? 0;
    const promise = this.options.storage
      .save(session)
      .then((summary) => {
        if (
          !summary ||
          !this.active ||
          lifecycle !== this.lifecycle ||
          this.blocked(id) ||
          version !== (this.writeVersions.get(id) ?? 0) ||
          projectVersion !==
            (this.projectVersions.get(pathKey(session.cwd)) ?? 0) ||
          summaryVersion !== (this.summaryChanges.get(id) ?? 0) ||
          this.writes.get(id)?.promise !== promise
        )
          return null;
        this.acknowledge(session, summary);
        return summary;
      })
      .catch(() => null)
      .finally(() => {
        if (this.writes.get(id)?.promise === promise) this.writes.delete(id);
      });
    this.writes.set(id, { fingerprint, promise });
    return promise;
  };

  observe = (sessions: readonly Session[], visibleIds: ReadonlySet<string>) => {
    const liveIds = new Set(sessions.map((session) => session.id));
    for (const session of sessions) {
      if (this.blocked(session.id) || this.observed.get(session.id) === session)
        continue;
      this.observed.set(session.id, session);
      const newlyBound =
        !!session.providerSessionId &&
        this.boundProviders.get(session.id) !== session.providerSessionId;
      const userId = lastUserBlockId(session);
      const newUserTurn =
        !!userId && this.userBlocks.get(session.id) !== userId;
      if (newlyBound)
        this.boundProviders.set(session.id, session.providerSessionId!);
      if (newUserTurn) this.userBlocks.set(session.id, userId);
      if (newlyBound || newUserTurn) void this.persist(session);
      if (
        shouldPersistSession(session) &&
        (!session.busy ||
          !visibleIds.has(session.id) ||
          newlyBound ||
          newUserTurn ||
          !this.persisted.has(session.id))
      )
        this.pending.set(session.id, session);
    }
    for (const id of this.observed.keys())
      if (!liveIds.has(id)) {
        this.observed.delete(id);
        this.pending.delete(id);
      }
    this.schedule();
  };
  private schedule() {
    if (!this.active || !this.pending.size) return;
    const now = Date.now();
    this.dirtySince ??= now;
    const delay = Math.max(
      0,
      Math.min(SAVE_DELAY_MS, this.dirtySince + SAVE_MAX_WAIT_MS - now),
    );
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.dirtySince = null;
      const sessions = [...this.pending.values()];
      this.pending.clear();
      for (const session of sessions) void this.persist(session);
    }, delay);
  }

  /** Apply ownership changes to retained data without exposing mutable queues. */
  updateRetained = (change: (session: Session) => Session) => {
    for (const [id, cached] of this.cache)
      if (change(cached) !== cached) this.invalidate(id);
    for (const id of this.loads.keys()) this.invalidate(id);
    for (const [id, pending] of this.pending)
      this.pending.set(id, change(pending));
  };

  removeProject = (cwd: string) => {
    const key = pathKey(cwd);
    this.hiddenProjects.add(key);
    this.projectVersions.set(key, (this.projectVersions.get(key) ?? 0) + 1);
    this.historyLoader.invalidate(cwd);
    const loadedProjects = new Set(this.state.loadedProjects);
    const failedProjectPaths = new Set(this.state.failedProjectPaths);
    loadedProjects.delete(key);
    failedProjectPaths.delete(key);
    this.publish({
      history: this.state.history.filter(
        (row) => !sameProjectPath(row.cwd, cwd),
      ),
      loadedProjects,
      failedProjectPaths,
    });
  };

  rebaseProject = async (from: string, to: string) => {
    const keys = [pathKey(from), pathKey(to)];
    const invalidate = () => {
      for (const cwd of [from, to]) {
        this.historyLoader.invalidate(cwd);
        const key = pathKey(cwd);
        this.projectVersions.set(key, (this.projectVersions.get(key) ?? 0) + 1);
      }
      // Unknown reads may also belong to the moved project. Known reads from
      // other projects remain independent of this location change.
      for (const id of this.loads.keys()) {
        const session =
          this.state.history.find((row) => row.id === id) ??
          this.options.live().find((row) => row.id === id);
        if (!session || keys.includes(pathKey(session.cwd)))
          this.invalidate(id);
      }
    };
    for (const key of keys) this.rebasingProjects.add(key);
    invalidate();
    try {
      // The storage queue owns ordering with explicit writes from archive and
      // worktree operations; finish those before changing persisted locations.
      await this.options.storage.flush();
      await this.options.storage.rebase(from, to);
      invalidate();
      for (const [id, session] of this.cache)
        if (sameProjectPath(session.cwd, from))
          this.cache.set(id, { ...session, cwd: to });
      for (const [id, session] of this.pending)
        if (sameProjectPath(session.cwd, from))
          this.pending.set(id, { ...session, cwd: to });
      this.updateSummaries((row) =>
        sameProjectPath(row.cwd, from) ? { ...row, cwd: to } : row,
      );
      const loadedProjects = new Set(this.state.loadedProjects);
      const failedProjectPaths = new Set(this.state.failedProjectPaths);
      loadedProjects.delete(pathKey(from));
      loadedProjects.delete(pathKey(to));
      if (this.state.loadedProjects.has(pathKey(from)))
        loadedProjects.add(pathKey(to));
      failedProjectPaths.delete(pathKey(from));
      failedProjectPaths.delete(pathKey(to));
      this.publish({ loadedProjects, failedProjectPaths });
    } finally {
      for (const key of keys) this.rebasingProjects.delete(key);
      this.schedule();
    }
  };
}
