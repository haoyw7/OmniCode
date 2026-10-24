import { deleteHostProjection, hostProjectionIdentity, saveHostProjection } from "../../../platform/tauri/hostProjectionCache";
import { desktopHostHttp } from "../../../platform/tauri/hostTransport";
import { SessionSyncClient } from "../../../client/sessionSync";
import { flushCommandOutbox, isDefinitiveCommandRejection, StoredCommandJournal } from "../../../client/commandOutbox";
import { listDesktopConnections, pairDesktopConnection, removeDesktopConnection } from "../../../platform/tauri/connections";
import { useEffect, useMemo, useState } from "react";
import { migrateSavedHostCommand } from "../../../client/hostProtocol";
import { type HostCommand, type HostSession, type HostSessionSummary, type RemoteMachine } from "../../../contracts/protocol";
import { remoteProjectFor, ensureSharedProject, sharedHostMachineId, isSharedHostMachine } from "./remoteProjects";
import { translate } from "../../../shared/i18n/language";
import { reuseRemoteAttachmentPreviews, withRemoteAttachmentPreviews } from "./remoteAttachmentPreviews";
import { hostOrchestrationClient } from "../../orchestration/model/orchestrationClient";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { useHostConnections } from "./hostConnections";
import { OUTBOX_PREFIX, deleteOutboxEntries, outboxEntry, outboxKeys, putOutboxEntry, desktopOutboxStorage } from "../../../platform/tauri/remoteOutbox";

export const REMOTE_MACHINES_CHANGED = "omnicode:remote-machines";
const CHANGE = REMOTE_MACHINES_CHANGED;
export const REMOTE_HISTORY_CHANGE = "omnicode:remote-history";
export const REMOTE_HISTORY_UPDATED = "omnicode:remote-history-updated";
export const refreshRemoteProjectSessions = () =>
  window.dispatchEvent(new Event(REMOTE_HISTORY_CHANGE));
let cachedMachines: RemoteMachine[] = [];
let machinesLoaded = false;
let machineRequest: Promise<RemoteMachine[]> | undefined;
let machineRevision = 0;
export const OPEN_CONNECTIONS_EVENT = "omnicode:open-connections";
export const OPEN_REMOTE_PROJECT_EVENT = "omnicode:open-remote-project";
export const OPEN_NEW_ENVIRONMENT_EVENT = "omnicode:open-new-environment";
export const refreshRemoteMachines = () =>
  window.dispatchEvent(new Event(CHANGE));
const TAB_KEY = "omnicode.remote-tabs.v2";
const TAB_SCOPE_KEY = "omnicode.remote-tab-scopes.v1";
export type RemoteSessionScope = { environmentId: string; projectId: string };
/** Read storage on every lookup so writes in other windows are immediately visible,
 * but decode each version only once instead of once per sidebar row or tab. */
function cachedRemoteRecord<T>(key: string) {
  let serialized: string | null | undefined;
  let record: Readonly<Record<string, T>> = {};
  return (): Readonly<Record<string, T>> => {
    try {
      const next = localStorage.getItem(key);
      if (next === serialized) return record;
      let value: unknown;
      try { value = JSON.parse(next ?? "{}"); } catch { /* Invalid storage is empty. */ }
      record = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, T>
        : {};
      serialized = next;
      return record;
    } catch {
      return {};
    }
  };
}
const remoteTabBindings = cachedRemoteRecord<string>(TAB_KEY);
const remoteTabScopes = cachedRemoteRecord<RemoteSessionScope & { hostId: string }>(TAB_SCOPE_KEY);
const EXECUTION_CWD_KEY = "omnicode.remote-pending-execution-cwds.v1";

function pendingExecutionDirectories(): Record<string, string> {
  const current = localStorage.getItem(EXECUTION_CWD_KEY);
  const legacyKey = "omnicode.remote-pending-worktrees.v1";
  const legacy = localStorage.getItem(legacyKey);
  const raw = current ?? legacy ?? "{}";
  const value = JSON.parse(raw);
  if (legacy !== null) {
    localStorage.setItem(EXECUTION_CWD_KEY, raw);
    localStorage.removeItem(legacyKey);
  }
  return value;
}

export function remotePendingExecutionCwd(shellId: string): string | undefined {
  try {
    const value = pendingExecutionDirectories()[shellId];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The host checkout currently used by a remote tab. */
export function remoteTabCwd(project: string, shellId?: string): string | undefined {
  if (!shellId) return undefined;
  const sessionId = remoteSessionFor(shellId);
  const summary = sessionId ? cachedRemoteSessionSummary(project, sessionId) : undefined;
  return (
    summary?.executionCwd ?? summary?.cwd ??
    remotePendingExecutionCwd(shellId)
  );
}

export function rememberRemotePendingExecutionCwd(shellId: string, path?: string) {
  try {
    const all = pendingExecutionDirectories();
    if (path) all[shellId] = path;
    else delete all[shellId];
    localStorage.setItem(EXECUTION_CWD_KEY, JSON.stringify(all));
  } catch {
    /* selection is restored from the host once a session exists */
  }
}

/** The host session a tab in a remote project shows; none for a new session. */
export function remoteSessionFor(shellId: string): string | undefined {
  const value = remoteTabBindings()[shellId];
  return typeof value === "string" ? value : undefined;
}
/** Resolves many tabs with one storage read; each `remoteSessionFor` reads it again. */
export function remoteSessionResolver(): (shellId: string) => string | undefined {
  const bindings = remoteTabBindings();
  return (shellId) => {
    const value = bindings[shellId];
    return typeof value === "string" ? value : undefined;
  };
}
export function remoteSessionScopeFor(shellId: string): RemoteSessionScope | undefined {
  try {
    const value = remoteTabScopes()[shellId];
    if (value?.hostId === remoteSessionFor(shellId) && typeof value.environmentId === "string" && typeof value.projectId === "string")
      return { environmentId: value.environmentId, projectId: value.projectId };
  } catch { /* Legacy bindings are resolved from workspace identity during bootstrap. */ }
}
export function rememberRemoteSession(shellId: string, sessionId?: string, scope?: RemoteSessionScope) {
  try {
    const knownScope = scope ?? remoteSessionScopeFor(shellId);
    const all = { ...remoteTabBindings() };
    const scopes = { ...remoteTabScopes() };
    const nextScope = sessionId && knownScope ? { ...knownScope, hostId: sessionId } : undefined;
    // Pollers re-bind the same tab on every snapshot. An unchanged binding
    // must not rewrite storage or make every history list refetch.
    if (
      all[shellId] === sessionId &&
      JSON.stringify(scopes[shellId]) === JSON.stringify(nextScope)
    )
      return;
    if (sessionId) all[shellId] = sessionId;
    else delete all[shellId];
    localStorage.setItem(TAB_KEY, JSON.stringify(all));
    if (nextScope) scopes[shellId] = nextScope;
    else delete scopes[shellId];
    localStorage.setItem(TAB_SCOPE_KEY, JSON.stringify(scopes));
  } catch {
    /* tab selection is best effort */
  }
  window.dispatchEvent(new Event(REMOTE_HISTORY_CHANGE));
}

export function forgetDeletedRemoteBindings(ids: readonly string[], local?: {
  environmentId: string;
  projectIds?: ReadonlySet<string>;
  legacyShellIds?: ReadonlySet<string>;
}): string[] {
  const deleted = new Set(ids);
  const bindings = { ...remoteTabBindings() };
  const scopes = { ...remoteTabScopes() };
  const removed: string[] = [];
  for (const [shellId, hostId] of Object.entries(bindings)) {
    if (typeof hostId !== "string" || !deleted.has(hostId)) continue;
    const scope = remoteSessionScopeFor(shellId);
    const owned = scope ? !!local && scope.environmentId === local.environmentId &&
      (!local.projectIds || local.projectIds.has(scope.projectId)) : shellId === hostId || !!local?.legacyShellIds?.has(shellId);
    if (!owned) continue;
    delete bindings[shellId];
    delete scopes[shellId];
    removed.push(shellId);
  }
  localStorage.setItem(TAB_KEY, JSON.stringify(bindings));
  localStorage.setItem(TAB_SCOPE_KEY, JSON.stringify(scopes));
  return removed;
}

/**
 * Drops bindings into this Host's projects whose session the Host no longer
 * lists. `known` must be its complete session list; bindings without a scope,
 * for other machines or projects, or named in `keep` are left alone.
 */
export function forgetUnknownRemoteBindings(
  local: { environmentId: string; projectIds: ReadonlySet<string> },
  known: ReadonlySet<string>,
  keep: ReadonlySet<string>,
): string[] {
  const bindings = { ...remoteTabBindings() };
  const scopes = { ...remoteTabScopes() };
  const removed: string[] = [];
  for (const [shellId, hostId] of Object.entries(bindings)) {
    if (typeof hostId !== "string" || known.has(hostId)) continue;
    if (keep.has(shellId) || keep.has(hostId)) continue;
    const scope = remoteSessionScopeFor(shellId);
    if (
      scope?.environmentId !== local.environmentId ||
      !local.projectIds.has(scope.projectId)
    )
      continue;
    delete bindings[shellId];
    delete scopes[shellId];
    removed.push(shellId);
  }
  // Rewriting the whole table on every launch costs more than it saves.
  if (!removed.length) return removed;
  localStorage.setItem(TAB_KEY, JSON.stringify(bindings));
  localStorage.setItem(TAB_SCOPE_KEY, JSON.stringify(scopes));
  return removed;
}

const pendingPrefix = (project: string, environment: string) =>
  `${OUTBOX_PREFIX}${JSON.stringify([project, environment])}:`;

type PendingEntry = { command: HostCommand; shellId?: string; followup?: HostCommand };
const readPendingEntry = (value: string): PendingEntry => {
  const parsed = JSON.parse(value) as PendingEntry | HostCommand;
  const entry = "command" in parsed ? parsed : { command: parsed };
  return { ...entry, command: migrateSavedHostCommand(entry.command) };
};

export const pendingRemoteFollowup = (project: string, environment: string, id: string) => {
  const value = outboxEntry(`${pendingPrefix(project, environment)}${id}`);
  return value ? readPendingEntry(value).followup : undefined;
};

export const pendingRemoteCommand = (
  project: string,
  environment: string,
  sessionId?: string | null,
  shellId?: string,
): HostCommand | undefined => {
  const prefix = pendingPrefix(project, environment);
  for (const key of outboxKeys()) {
    if (key.startsWith(prefix)) {
      const value = outboxEntry(key);
      if (value) {
        const entry = readPendingEntry(value);
        const command = entry.command;
        if (
          sessionId === undefined ||
          (sessionId === null
            ? command.type === "create" && (!entry.shellId || entry.shellId === shellId)
            : command.type !== "create" && command.sessionId === sessionId)
        )
          return command;
      }
    }
  }
};

// Each command owns its storage entry: a late receipt from another pane can
// never erase this pane's uncertain request. Persistence must succeed before
// dispatch; unlike preferences, silently dropping an outbox entry is unsafe.
export const savePendingRemoteCommand = async (
  project: string,
  environment: string,
  command: HostCommand,
  shellId?: string,
  followup?: HostCommand,
) => {
  try {
    await putOutboxEntry(
      `${pendingPrefix(project, environment)}${command.commandId}`,
      JSON.stringify({ command, shellId,
        followup: followup ?? pendingRemoteFollowup(project, environment, command.commandId),
      } satisfies PendingEntry),
    );
  } catch {
    throw new Error(
      "Cannot save your request locally. Free up app storage before sending.",
    );
  }
};
export const clearPendingRemoteCommand = (
  project: string,
  environment: string,
  commandId: string,
) =>
  void deleteOutboxEntries([`${pendingPrefix(project, environment)}${commandId}`]);

/** Pane-independent command dispatch using the same durable journal as the UI. */
export async function dispatchRemoteCommand(
  machineId: string,
  project: string,
  environment: string,
  command: HostCommand,
  shellId?: string,
  followup?: HostCommand,
  options?: { deferFollowup?: boolean; onCreated?(sessionId: string): boolean },
): Promise<import("../../../contracts/protocol").CommandReceipt> {
  const initialBinding = shellId ? remoteSessionFor(shellId) : undefined;
  await savePendingRemoteCommand(project, environment, command, shellId, followup);
  const slot = (commandId: string) => new StoredCommandJournal<PendingEntry>(
    desktopOutboxStorage, `${pendingPrefix(project, environment)}${commandId}`, readPendingEntry,
  );
  let journal = slot(command.commandId);
  return flushCommandOutbox<PendingEntry>({
    journal: {
      read: () => journal.read(),
      write: async (entry) => {
        const previous = journal;
        const next = slot(entry.command.commandId);
        await next.write(entry);
        journal = next;
        await previous.clear();
      },
      clear: () => journal.clear(),
    },
    validate: () => {},
    dispatch: (value) => remoteRequest(machineId, "commands.dispatch", value),
    next: (entry, receipt) => {
      if (entry.command.type !== "create") return;
      if (entry.shellId && (remoteSessionFor(entry.shellId) === initialBinding || remoteSessionFor(entry.shellId) === receipt.sessionId)) {
        // UI callers can acknowledge their own transition before the binding
        // notification. A late create never replaces a newer user selection.
        if (options?.onCreated?.(receipt.sessionId) !== false)
          rememberRemoteSession(entry.shellId, receipt.sessionId, {
            environmentId: environment, projectId: entry.command.projectId,
          });
      }
      return entry.followup && entry.followup.type !== "create"
        ? { command: { ...entry.followup, sessionId: receipt.sessionId }, shellId: entry.shellId }
        : undefined;
    },
    definitiveRejection: isDefinitiveCommandRejection,
    deferFollowup: options?.deferFollowup,
  });
}

export async function remoteRequest<T>(
  machineId: string,
  method: string,
  params: unknown = {},
): Promise<T> {
  const cacheIdentity = method === "sessions.delete" ? await hostProjectionIdentity(machineId).catch(() => undefined) : undefined;
  const result = await desktopHostHttp.request<T>(machineId, method, params as object);
  if (method === "sessions.delete" && cacheIdentity) {
    await deleteHostProjection(machineId, (params as { sessionId: string }).sessionId, cacheIdentity).catch(() => undefined);
  }
  return result;
}

const sessionSyncClient = new SessionSyncClient<{ machineId: string; identity?: string }>({
  key: ({ machineId, identity }) => JSON.stringify([machineId, identity]),
  request: ({ machineId }, method, params) => remoteRequest(machineId, method, params),
});

/** Fetches only what changed since `known`; falls back to a full snapshot. */
export async function loadRemoteSession(
  machineId: string,
  sessionId: string,
  known?: HostSession,
): Promise<HostSession> {
  const snapshot = await loadRemoteSessionText(machineId, sessionId, known);
  return withRemoteAttachmentPreviews(machineId, snapshot, known,
    (params) => remoteRequest(machineId, "attachments.read", params));
}

/** The conversation without waiting on image downloads. Previews already held
 * in `known` carry over; `loadRemoteSessionPreviews` fills in the rest. */
export async function loadRemoteSessionText(
  machineId: string,
  sessionId: string,
  known?: HostSession,
  waitMs?: number,
): Promise<HostSession> {
  const identity = await hostProjectionIdentity(machineId).catch(() => undefined);
  const snapshot = await sessionSyncClient.load({ machineId, identity }, sessionId, known, waitMs);
  if (identity) await saveHostProjection(machineId, snapshot, identity).catch(() => undefined);
  return reuseRemoteAttachmentPreviews(snapshot, known);
}

/** Downloads the image previews `loadRemoteSessionText` left out. */
export function loadRemoteSessionPreviews(
  machineId: string,
  snapshot: HostSession,
): Promise<HostSession> {
  return withRemoteAttachmentPreviews(machineId, snapshot, snapshot,
    (params) => remoteRequest(machineId, "attachments.read", params));
}

/** The connected machine for an environment, from the last machine list read. */
export function knownRemoteMachine(
  environmentId: string,
): RemoteMachine | undefined {
  return cachedMachines.find((entry) => entry.environmentId === environmentId);
}

/** The connected machine for an environment, reading the list when needed. */
export async function remoteMachineFor(
  environmentId: string,
): Promise<RemoteMachine | undefined> {
  const known = knownRemoteMachine(environmentId);
  if (known || (machinesLoaded && !machineRequest)) return known;
  await readRemoteMachines();
  return knownRemoteMachine(environmentId);
}

function readRemoteMachines(): Promise<RemoteMachine[]> {
  if (machineRequest) return machineRequest;
  const revision = machineRevision;
  const request = listDesktopConnections().then((value) => {
    if (machineRevision === revision) {
      cachedMachines = Array.isArray(value) ? value : [];
      machinesLoaded = true;
    }
    return cachedMachines;
  });
  machineRequest = request;
  void request.finally(() => {
    if (machineRequest === request) machineRequest = undefined;
  }).catch(() => {});
  return request;
}

export async function connectMachine(
  name: string,
  url: string,
  token: string,
): Promise<RemoteMachine> {
  const machine = await pairDesktopConnection(name, url, token);
  machineRevision++;
  cachedMachines = [
    ...cachedMachines.filter((entry) => entry.id !== machine.id),
    machine,
  ];
  machinesLoaded = true;
  window.dispatchEvent(new Event(CHANGE));
  const { publishHostConnection } = await import("./hostConnections");
  await publishHostConnection(machine);
  return machine;
}

export async function disconnectMachine(machineId: string): Promise<void> {
  const machine = cachedMachines.find((entry) => entry.id === machineId);
  if (machineId === sharedHostMachineId() || (machine && isSharedHostMachine(machine)))
    throw new Error(translate("This computer cannot be removed."));
  await removeDesktopConnection(machineId);
  machineRevision++;
  cachedMachines = cachedMachines.filter((entry) => entry.id !== machineId);
  window.dispatchEvent(new Event(CHANGE));
}

export function useRemoteMachines(enabled = true): {
  machines: RemoteMachine[];
  loaded: boolean;
} {
  const directory = useHostConnections();
  const [state, setState] = useState<{
    machines: RemoteMachine[];
    loaded: boolean;
  }>({ machines: cachedMachines, loaded: machinesLoaded });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const refresh = () => {
      void readRemoteMachines()
        .then((value) => {
          if (!disposed) {
            setState({
              machines: value,
              loaded: true,
            });
          }
        })
        .catch(() => {
          // A temporary connection failure should not blank every remote
          // panel while a fresh machine list is requested.
          if (!disposed) setState({ machines: cachedMachines, loaded: true });
        });
    };
    refresh();
    window.addEventListener(CHANGE, refresh);
    return () => {
      disposed = true;
      window.removeEventListener(CHANGE, refresh);
    };
  }, [enabled]);
  return useMemo(() => ({
    ...state,
    machines: state.machines.map((machine) => {
      const shared = directory.connections.find((entry) => entry.environmentId === machine.environmentId);
      return shared && shared.name !== machine.name ? { ...machine, name: shared.name } : machine;
    }),
  }), [state, directory.connections]);
}

const STATUS = "omnicode:remote-machine-status";
const machineOnline = new Map<string, boolean>();
const statusWatchers = new Map<
  string,
  { count: number; timer?: ReturnType<typeof setTimeout> }
>();

/** Records whether a machine answered its latest request, for every view
 * that shows its connection state. */
export function reportRemoteMachineStatus(machineId: string, online: boolean) {
  if (machineOnline.get(machineId) === online) return;
  machineOnline.set(machineId, online);
  window.dispatchEvent(new Event(STATUS));
}

function watchMachineStatus(machineId: string): () => void {
  const existing = statusWatchers.get(machineId);
  if (existing) {
    existing.count++;
  } else {
    const watcher: { count: number; timer?: ReturnType<typeof setTimeout> } =
      { count: 1 };
    statusWatchers.set(machineId, watcher);
    let failures = 0;
    const poll = async () => {
      try {
        await remoteRequest(machineId, "environment.describe");
        failures = 0;
        reportRemoteMachineStatus(machineId, true);
      } catch {
        failures = Math.min(4, failures + 1);
        reportRemoteMachineStatus(machineId, false);
      }
      if (statusWatchers.get(machineId) === watcher)
        watcher.timer = setTimeout(
          () => void poll(),
          failures ? Math.min(30_000, 3_000 * 2 ** failures) : 15_000,
        );
    };
    void poll();
  }
  return () => {
    const watcher = statusWatchers.get(machineId);
    if (!watcher || --watcher.count > 0) return;
    clearTimeout(watcher.timer);
    statusWatchers.delete(machineId);
  };
}

/** Whether a machine is reachable; undefined until the first check returns. */
export function useRemoteMachineOnline(machineId?: string): boolean | undefined {
  const [online, setOnline] = useState(() =>
    machineId ? machineOnline.get(machineId) : undefined,
  );
  useEffect(() => {
    if (!machineId) {
      setOnline(undefined);
      return;
    }
    const update = () => setOnline(machineOnline.get(machineId));
    update();
    window.addEventListener(STATUS, update);
    const unwatch = watchMachineStatus(machineId);
    return () => {
      window.removeEventListener(STATUS, update);
      unwatch();
    };
  }, [machineId]);
  return online;
}

const historyKey = (project: string) => `omnicode.remote-history.v2:${project}`;

// Native transcript block IDs dominate list rows and are refetched with the
// list; caching them let a few long sessions fill the WebView quota.
const cachedHistoryRow = (row: HostSessionSummary): HostSessionSummary => {
  if (!row.nativeSession) return row;
  const { nativeIds: _nativeIds, ...link } = row.nativeSession;
  return { ...row, nativeSession: { ...link, blockIds: [] } };
};

function persistRemoteHistory(key: string, sessions: HostSessionSummary[]) {
  const serialized = JSON.stringify(sessions.map(cachedHistoryRow));
  try {
    localStorage.setItem(historyKey(key), serialized);
    return;
  } catch {
    /* Other projects' lists are refetchable; make room for the visible one. */
  }
  try {
    const prefix = historyKey("");
    const others: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const stored = localStorage.key(index);
      if (stored?.startsWith(prefix) && stored !== historyKey(key)) others.push(stored);
    }
    for (const stored of others) localStorage.removeItem(stored);
    localStorage.setItem(historyKey(key), serialized);
  } catch {
    /* Keep the successful in-memory cache if storage is still full. */
  }
}

export type RemoteProjectSessions = {
  /** Undefined when this machine is not connected on this computer. */
  machine?: RemoteMachine;
  sessions: HostSessionSummary[];
  /** True after a successful response or a restored cache, including an empty list. */
  loaded: boolean;
  pending: boolean;
  error?: string;
  offline: boolean;
};

type CachedRemoteProjectSessions = Omit<RemoteProjectSessions, "machine">;
const sessionCaches = new Map<string, CachedRemoteProjectSessions>();
const sessionRequests = new Map<string, {
  identity: string;
  machineId?: string;
  promise: Promise<void>;
}>();
const sessionWatchers = new Map<string, {
  count: number;
  timer?: ReturnType<typeof setTimeout>;
}>();

const sessionProjectKey = (project: string) => remoteProjectFor(project)?.key ??
  (project.replace(/\\/g, "/").replace(/\/+$/, "") || "/");
const sessionProjectIdentity = (project: string) => {
  const remote = remoteProjectFor(project);
  return remote ? JSON.stringify([
    remote.environmentId,
    remote.local ? remote.key : remote.projectId,
  ]) : undefined;
};

function sessionCache(project: string): CachedRemoteProjectSessions {
  const key = sessionProjectKey(project);
  const known = sessionCaches.get(key);
  if (known) return known;
  let sessions: HostSessionSummary[] = [];
  let loaded = false;
  try {
    const stored = localStorage.getItem(historyKey(key)) ??
      localStorage.getItem(historyKey(project));
    if (stored !== null) {
      const value: unknown = JSON.parse(stored);
      if (Array.isArray(value)) {
        sessions = value as HostSessionSummary[];
        loaded = true;
      }
    }
  } catch {
    /* A damaged or unavailable cache does not prevent a fresh request. */
  }
  const state = { sessions, loaded, pending: false, offline: false };
  sessionCaches.set(key, state);
  return state;
}

/** The most recent successful list, even while this project is collapsed. */
export function cachedRemoteSessions(project: string): HostSessionSummary[] {
  return sessionCache(project).sessions;
}

/** Whether a complete successful list is available, including an empty cache. */
export function hasCachedRemoteProjectSessions(project: string): boolean {
  return sessionCache(project).loaded;
}

/** Read collapsed-project load/error state without starting a polling hook. */
export function cachedRemoteProjectSessionsState(
  project: string,
): Readonly<Omit<RemoteProjectSessions, "machine" | "sessions">> {
  const { sessions: _sessions, ...state } = sessionCache(project);
  const remote = remoteProjectFor(project);
  return {
    ...state,
    offline:
      (!!remote || isRemoteProjectPath(project)) &&
      (!remote || !knownRemoteMachine(remote.environmentId) || state.offline),
  };
}

export function cachedRemoteSessionSummary(project: string, sessionId: string) {
  return cachedRemoteSessions(project).find((session) => session.id === sessionId);
}

/** Reads once without starting polling. Pollers and search share this request. */
export function prefetchRemoteProjectSessions(project: string): Promise<void> {
  const remote = remoteProjectFor(project);
  if (!remote) {
    if (!isRemoteProjectPath(project)) return Promise.resolve();
    const error = new Error("Remote project is not registered on this computer");
    const state = sessionCache(project);
    state.pending = false;
    state.offline = true;
    state.error = error.message;
    window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED));
    return Promise.reject(error);
  }
  const key = sessionProjectKey(project);
  const identity = sessionProjectIdentity(project)!;
  const pending = sessionRequests.get(key);
  const knownMachineId = knownRemoteMachine(remote.environmentId)?.id;
  if (pending?.identity === identity &&
      (!pending.machineId || pending.machineId === knownMachineId)) return pending.promise;
  const state = sessionCache(project);
  const request = { identity, machineId: knownMachineId, promise: Promise.resolve() };
  let unavailable = false;
  // Every listener re-renders on an update event, so announce only real
  // changes; an idle poll that returns the same list announces nothing.
  const visible = () => [state.sessions, state.loaded, state.pending, state.error, state.offline];
  const before = visible();
  // A loaded, healthy list refreshes in the background with nothing to wait for.
  if (!state.loaded || state.offline || state.error) {
    state.pending = true;
    state.error = undefined;
  }
  const started = visible();
  request.promise = (async () => {
    try {
      const machine = await remoteMachineFor(remote.environmentId);
      if (!machine) {
        unavailable = true;
        throw new Error("Remote machine is not connected");
      }
      request.machineId = machine.id;
      const hostProject = remote.local ? await ensureSharedProject(remote.key) : remote;
      if (sessionRequests.get(key) !== request ||
          sessionProjectIdentity(project) !== identity ||
          knownRemoteMachine(remote.environmentId)?.id !== machine.id) return;
      const next = await remoteRequest<HostSessionSummary[]>(
        machine.id, "sessions.list", { projectId: hostProject.projectId },
      );
      // Re-registering a folder or changing its Host must not let an older
      // request overwrite the replacement project's history.
      if (sessionRequests.get(key) !== request ||
          sessionProjectIdentity(project) !== identity ||
          knownRemoteMachine(remote.environmentId)?.id !== machine.id) return;
      // Pollers refetch every few seconds; an identical list keeps its array so
      // history views do not re-render (or rewrite storage) for nothing.
      const serialized = JSON.stringify(next);
      const unchanged = state.loaded && JSON.stringify(state.sessions) === serialized;
      if (!unchanged) state.sessions = next;
      for (const row of next) hostOrchestrationClient.accept({ machineId: machine.id, project: hostProject }, row);
      state.loaded = true;
      state.offline = false;
      state.error = undefined;
      if (!unchanged) persistRemoteHistory(key, next);
    } catch (error) {
      if (sessionRequests.get(key) === request &&
          sessionProjectIdentity(project) === identity &&
          knownRemoteMachine(remote.environmentId)?.id === request.machineId) {
        state.offline = true;
        state.error = unavailable ? undefined :
          error instanceof Error ? error.message : String(error);
      }
      throw error;
    } finally {
      if (sessionRequests.get(key) === request) {
        sessionRequests.delete(key);
        state.pending = false;
        if (visible().some((value, index) => value !== started[index]))
          window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED));
      }
    }
  })();
  sessionRequests.set(key, request);
  if (started.some((value, index) => value !== before[index]))
    window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED));
  return request.promise;
}

function watchProjectSessions(project: string): () => void {
  const key = sessionProjectKey(project);
  let watcher = sessionWatchers.get(key);
  if (watcher) {
    watcher.count++;
  } else {
    watcher = { count: 1 };
    sessionWatchers.set(key, watcher);
    const current = watcher;
    let failures = 0;
    const poll = async () => {
      try {
        await prefetchRemoteProjectSessions(project);
        failures = 0;
      } catch {
        failures = Math.min(4, failures + 1);
      }
      if (sessionWatchers.get(key) === current)
        current.timer = setTimeout(
          () => void poll(),
          failures ? Math.min(30_000, 3_000 * 2 ** failures) : 3_000,
        );
    };
    void poll();
  }
  const current = watcher;
  return () => {
    if (sessionWatchers.get(key) !== current || --current.count > 0) return;
    clearTimeout(current.timer);
    sessionWatchers.delete(key);
  };
}

/** Lists a remote project's host sessions, keeping the last list visible
 * while the machine is unreachable. */
export function useRemoteProjectSessions(
  project: string,
  enabled = true,
): RemoteProjectSessions {
  const remote = remoteProjectFor(project);
  useRemoteMachines(enabled && !!remote);
  const machine = remote ? knownRemoteMachine(remote.environmentId) : undefined;
  const [state, setState] = useState(() => ({ ...sessionCache(project) }));
  useEffect(() => {
    // Every project's history poll announces itself to every list; only a
    // list whose own state changed should re-render.
    const updated = () =>
      setState((current) => {
        const next = sessionCache(project);
        return current.sessions === next.sessions &&
          current.loaded === next.loaded &&
          current.pending === next.pending &&
          current.error === next.error &&
          current.offline === next.offline
          ? current
          : { ...next };
      });
    // `machine` is derived outside this state, so machine changes always render.
    const machinesChanged = () => setState({ ...sessionCache(project) });
    const refresh = () => {
      if (remoteProjectFor(project) || isRemoteProjectPath(project))
        void prefetchRemoteProjectSessions(project).catch(() => {});
    };
    updated();
    window.addEventListener(REMOTE_HISTORY_UPDATED, updated);
    window.addEventListener(REMOTE_HISTORY_CHANGE, refresh);
    window.addEventListener(CHANGE, machinesChanged);
    return () => {
      window.removeEventListener(REMOTE_HISTORY_UPDATED, updated);
      window.removeEventListener(REMOTE_HISTORY_CHANGE, refresh);
      window.removeEventListener(CHANGE, machinesChanged);
    };
  }, [project]);
  useEffect(() => {
    if (!enabled || !remote) return;
    return watchProjectSessions(project);
  }, [project, enabled, remote?.environmentId, remote?.projectId, machine?.id]);
  return {
    ...state,
    machine,
    offline: (!!remote || isRemoteProjectPath(project)) && (!machine || state.offline),
  };
}
