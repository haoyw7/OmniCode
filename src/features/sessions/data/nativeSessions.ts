import { translate } from "../../../shared/i18n/language";
import { isTauri } from "@tauri-apps/api/core";
import {
  nativeProviderLabel,
  nativeSyncBlocked,
  nativeSyncNotice,
  type NativeSessionFile,
  type NativeSessionAccess,
  type NativeSourceListing,
} from "../../../integrations/harness/core/nativeSessions";
import type { Session } from "../model/session";
import type { SessionSummary } from "./sessionStore";
import { sharedSessionBackend } from "./sharedSessionBackend";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import {
  remoteMachineFor,
  remoteRequest,
  remoteSessionFor,
} from "../../connections/model/connections";

/**
 * Native Claude Code, Codex, Pi, omp and OpenCode conversations are listed,
 * imported, synchronized, watched and run by the Host. The desktop only shows
 * the Host's listing and each open conversation's ownership state.
 */
export type NativeSessionState = {
  files: NativeSessionFile[];
  access: Record<string, NativeSessionAccess>;
  warnings: string[];
  busy: boolean;
  error?: string;
  lastSynced?: number;
  /** `${provider}:${providerSessionId}` already bound to MonoCode history. */
  bound: ReadonlySet<string>;
  /** Imported conversations the Host keeps in sync. */
  importedCount?: number;
  /** Host setting: watch managed sources while idle. */
  autoSync: boolean;
};
let state: NativeSessionState = {
  files: [],
  warnings: [],
  busy: false,
  access: {},
  bound: new Set(),
  autoSync: true,
};
const listeners = new Set<() => void>();
const accessListeners = new Map<string, Set<() => void>>();
const accessExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ACCESS_MAX_AGE = 15_000;
export const nativeSessionSnapshot = () => state;
export const subscribeNativeSessions = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish(patch: Partial<NativeSessionState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
const desktop = () => typeof isTauri === "function" && isTauri();
/** The shared Host's native session manager. */
const hostNative = () => sharedSessionBackend()?.native;
const hostOwned = (session: Pick<Session, "cwd">) =>
  !!sharedSessionBackend()?.ownsProject(session.cwd);
const syncBlocked = (session: Session) => nativeSyncBlocked(session.nativeSyncStatus);
const bindingKey = (provider: string, providerSessionId: string) =>
  `${provider}:${providerSessionId}`;

export function nativeSessionAccess(
  session: Session,
): NativeSessionAccess | undefined {
  const access = state.access[session.id];
  return access?.path === session.nativeSession?.path ? access : undefined;
}
/** Only a confirmed, recent owner blocks the composer; the Host rechecks under its lock before every write. */
function accessBlocked(access: NativeSessionAccess | undefined): boolean {
  return (
    !!access &&
    access.state !== "idle" &&
    !(access.state === "unknown" && access.reason === "unavailable") &&
    Date.now() - access.checkedAt <= ACCESS_MAX_AGE
  );
}
export function nativeSessionReadOnly(session: Session): boolean {
  if (!session.nativeSession) return false;
  if (syncBlocked(session)) return true;
  return accessBlocked(nativeSessionAccess(session));
}

/** Composer-visible access state; an unchanged ownership check only renews its lease. */
export function nativeSessionAccessSnapshot(session: Session): string {
  if (!session.nativeSession) return "";
  const access = nativeSessionAccess(session);
  return JSON.stringify([
    nativeSessionReadOnly(session),
    session.nativeSyncStatus?.state,
    session.nativeSyncStatus?.reason,
    access?.state,
    access?.reason,
    access?.holder?.pid,
    access?.holder?.provider,
    access?.holder?.command,
  ]);
}

function scheduleAccessExpiry(id: string): void {
  const timer = accessExpiryTimers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  accessExpiryTimers.delete(id);
  const access = state.access[id];
  if (!accessListeners.has(id) || !access || !accessBlocked(access)) return;
  const remaining = access.checkedAt + ACCESS_MAX_AGE + 1 - Date.now();
  if (remaining <= 0) return;
  accessExpiryTimers.set(id, setTimeout(() => {
    accessExpiryTimers.delete(id);
    for (const listener of accessListeners.get(id) ?? []) listener();
  }, remaining));
}

/** Notify only this conversation; an owner seen by a stopped poller must not lock it forever. */
export function subscribeNativeSessionAccess(id: string, listener: () => void): () => void {
  let subscribers = accessListeners.get(id);
  if (!subscribers) accessListeners.set(id, subscribers = new Set());
  subscribers.add(listener);
  scheduleAccessExpiry(id);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size) return;
    accessListeners.delete(id);
    const timer = accessExpiryTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    accessExpiryTimers.delete(id);
  };
}
export function nativeSessionAccessHint(session: Session): string | undefined {
  if (!nativeSessionReadOnly(session)) return undefined;
  const blocked = nativeSyncNotice(session.nativeSyncStatus);
  if (blocked) return blocked;
  const access = nativeSessionAccess(session);
  const holder = access?.holder;
  if (holder && access?.state === "external")
    return translate(
      "Open in {provider} (pid {pid}). Read-only until it exits; its messages appear here as they are written.",
      { provider: nativeProviderLabel(holder.provider), pid: holder.pid },
    );
  if (holder && access?.reason === "ambiguousProcess")
    return translate(
      "{provider} is running in this project (pid {pid}) and may be using this session. Read-only until it exits; history keeps syncing.",
      { provider: nativeProviderLabel(holder.provider), pid: holder.pid },
    );
  if (access?.state === "external")
    return translate(
      "This session is still open in another client. Saved history keeps syncing. Continue there, or close that session before retrying here; a finished reply may not release it.",
    );
  if (access?.reason === "anotherMonocode")
    return translate(
      "Another OmniCode window is using this session. It will become available when that operation finishes.",
    );
  if (access?.reason === "unsupportedPlatform")
    return translate(
      "Native session ownership cannot be verified on this platform. Imported history is read-only.",
    );
  return translate("Checking session status…");
}
function publishAccess(id: string, access: NativeSessionAccess) {
  publish({ access: { ...state.access, [id]: access } });
  scheduleAccessExpiry(id);
  for (const listener of accessListeners.get(id) ?? []) listener();
}

/** The Host's background watch setting, as last listed. */
export const nativeAutoSyncEnabled = (): boolean => state.autoSync;
export function setNativeAutoSync(enabled: boolean): void {
  publish({ autoSync: enabled });
  void hostNative()
    ?.list({ autoSync: enabled })
    .then(publishListing)
    .catch(() => undefined);
}

type Runtime = {
  /** Open conversations, for ownership probes. */
  live(): readonly Session[];
  changed(session: Session, summary: SessionSummary, imported: boolean): void;
};
let runtime: Runtime | undefined;
let operation: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = operation.catch(() => undefined).then(run);
  operation = next;
  return next;
}

function publishListing(listing: NativeSourceListing): void {
  publish({
    files: listing.sources,
    warnings: listing.warnings,
    autoSync: listing.autoSync,
    importedCount: listing.managedCount,
    lastSynced: listing.lastSyncedAt,
    bound: new Set([
      ...state.bound,
      ...listing.sources
        .filter((source) => source.boundSessionId)
        .map((source) => bindingKey(source.provider, source.providerSessionId)),
    ]),
  });
}

async function discover(refresh = false): Promise<NativeSessionFile[]> {
  const host = hostNative();
  if (!host) return [];
  const listing = await host.list(refresh ? { refresh: true } : {});
  publishListing(listing);
  return listing.sources;
}
export function discoverNativeSessions(): Promise<NativeSessionFile[]> {
  return serialized(async () => {
    publish({ busy: true, error: undefined });
    try {
      return await discover(true);
    } catch (error) {
      publish({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      publish({ busy: false });
    }
  });
}

/** Native sessions in a project that MonoCode has not imported or started itself. */
export function externalNativeSessions(
  files: readonly NativeSessionFile[],
  bound: ReadonlySet<string>,
  belongs: (cwd: string) => boolean,
): NativeSessionFile[] {
  return files.filter(
    (file) =>
      !bound.has(bindingKey(file.provider, file.providerSessionId)) &&
      belongs(file.cwd),
  );
}

let discoveryRun: Promise<void> | undefined;
let lastDiscovery = -Infinity;
const DISCOVERY_INTERVAL = 10_000;
let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
let discoveryPending = false;

/** Coalesce refresh requests into one Host listing per interval. */
function scheduleDiscovery(): void {
  discoveryPending = true;
  if (discoveryRun || discoveryTimer !== undefined) return;
  discoveryTimer = setTimeout(() => {
    discoveryTimer = undefined;
    void refreshNativeDiscovery();
  }, Math.max(0, lastDiscovery + DISCOVERY_INTERVAL - Date.now()));
}

/** Quiet sidebar refresh: no busy state, no error banner, at most every few seconds. */
export function refreshNativeDiscovery(force = false): Promise<void> {
  if (!desktop()) return Promise.resolve();
  if (discoveryRun) {
    scheduleDiscovery();
    return discoveryRun;
  }
  if (!force && Date.now() - lastDiscovery < DISCOVERY_INTERVAL) {
    scheduleDiscovery();
    return Promise.resolve();
  }
  if (discoveryTimer !== undefined) clearTimeout(discoveryTimer);
  discoveryTimer = undefined;
  discoveryPending = false;
  lastDiscovery = Date.now();
  const run = discover()
    .then(() => undefined)
    .catch(() => undefined);
  discoveryRun = run;
  void run.finally(() => {
    if (discoveryRun === run) discoveryRun = undefined;
    if (discoveryPending) scheduleDiscovery();
  });
  return run;
}

/** The Host imports (or finds) the conversation; it is then listed like any Host session. */
async function importOnHost(file: NativeSessionFile): Promise<string | null> {
  const host = hostNative();
  if (!host || !file.sourceId) return null;
  const id = await host.import(file.sourceId);
  publish({
    bound: new Set([...state.bound, bindingKey(file.provider, file.providerSessionId)]),
    importedCount: (state.importedCount ?? 0) + 1,
  });
  const shared = sharedSessionBackend();
  const owner = runtime;
  if (shared && owner) {
    const session = await shared.get(id).catch(() => null);
    const summary = session && (await shared.list(session.cwd).catch(() => [])).find((row) => row.id === id);
    if (session && summary && runtime === owner) owner.changed(session, summary, true);
  }
  return id;
}

export function importNativeSession(
  file: NativeSessionFile,
): Promise<string | null> {
  return serialized(async () => {
    publish({ busy: true, error: undefined });
    try {
      return await importOnHost(file);
    } catch (error) {
      publish({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      publish({ busy: false });
    }
  });
}

export type BulkImportProgress = { done: number; total: number; failed: number };

/** Import many sources in one queued run; one failure does not stop the rest. */
export function importNativeSessions(
  files: readonly NativeSessionFile[],
  options: {
    stop?: { cancelled: boolean };
    onProgress?: (progress: BulkImportProgress) => void;
    onImported?: (file: NativeSessionFile, id: string) => void;
  } = {},
): Promise<BulkImportProgress> {
  return serialized(async () => {
    const progress = { done: 0, total: files.length, failed: 0 };
    publish({ busy: true, error: undefined });
    try {
      for (const file of files) {
        if (options.stop?.cancelled) break;
        try {
          const id = await importOnHost(file);
          if (id) options.onImported?.(file, id);
          else progress.failed++;
        } catch {
          // A session without user messages yet must not stop the rest.
          progress.failed++;
        }
        progress.done++;
        options.onProgress?.({ ...progress });
      }
      return progress;
    } finally {
      publish({ busy: false });
    }
  });
}

/** "Sync now": the Host re-reads every managed conversation, then the listing refreshes. */
export function syncNativeSessions(): Promise<void> {
  return serialized(async () => {
    const host = hostNative();
    if (!host) return;
    publish({ busy: true, error: undefined });
    try {
      await host.syncAll();
      await discover(true);
    } catch (error) {
      publish({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      publish({ busy: false });
    }
  });
}

/** Ownership of an open native conversation, from the Host that runs it. */
async function hostAccess(session: Session): Promise<NativeSessionAccess | null> {
  if (hostOwned(session)) return hostNative()?.access(session.id) ?? null;
  const project = remoteProjectFor(session.cwd);
  if (!project || project.local) return null;
  const machine = await remoteMachineFor(project.environmentId);
  if (!machine) throw new Error(translate("Session status unavailable. Read-only for now."));
  return remoteRequest<NativeSessionAccess | null>(machine.id, "sessions.nativeAccess", {
    sessionId: remoteSessionFor(session.id) ?? session.id,
  });
}

let accessPoll: Promise<void> | undefined;
/** Ownership only matters where a composer is shown: probe open native conversations. */
export function pollNativeSessionAccess(): Promise<void> {
  if (accessPoll) return accessPoll;
  const run = (async () => {
    const owner = runtime;
    if (!owner) return;
    for (const current of owner.live()) {
      if (!current.nativeSession || runtime !== owner) continue;
      try {
        const access = await hostAccess(current);
        if (access && runtime === owner) publishAccess(current.id, access);
      } catch {
        // A transient probe failure keeps the last confirmed state until it ages out.
        const previous = nativeSessionAccess(current);
        if (previous && Date.now() - previous.checkedAt <= ACCESS_MAX_AGE) continue;
        publishAccess(current.id, {
          state: "unknown",
          reason: "unavailable",
          checkedAt: Date.now(),
          path: current.nativeSession.path,
        });
      }
    }
  })().catch(() => undefined);
  accessPoll = run;
  void run.then(() => {
    if (accessPoll === run) accessPoll = undefined;
  });
  return run;
}

/** Install once in the desktop app. */
export function installNativeSessionSync(owner: Runtime): () => void {
  runtime = owner;
  const accessRun = () => {
    void pollNativeSessionAccess();
  };
  const discoverRun = () => {
    void refreshNativeDiscovery();
  };
  const accessTimer = window.setInterval(accessRun, 5_000);
  window.addEventListener("focus", accessRun);
  window.addEventListener("focus", discoverRun);
  accessRun();
  discoverRun();
  return () => {
    window.clearInterval(accessTimer);
    window.removeEventListener("focus", accessRun);
    window.removeEventListener("focus", discoverRun);
    if (runtime === owner) {
      runtime = undefined;
      if (discoveryTimer !== undefined) clearTimeout(discoveryTimer);
      discoveryTimer = undefined;
      discoveryPending = false;
      lastDiscovery = -Infinity;
    }
  };
}
