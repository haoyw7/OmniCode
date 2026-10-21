import { HISTORY_MODE, type HistoryRequest } from "../../../integrations/harness/core/history";
import { readHistoryWindow } from "./historyRead";
import { removeToolContentQueries } from "../../sessions/model/toolContentQueries";
import type { ToolContentMode } from "../../../integrations/harness/core/toolContent";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo } from "react";
import { queryOptions, useQuery, type Query } from "@tanstack/react-query";
import { queryClient, invalidateAfterChange } from "../../../shared/lib/queryClient";
import {
  applySessionSync,
  migrateSavedHostCommand,
  sessionClockOffset,
  type HostCommand,
  type HostSession,
  type HostSessionSummary,
  type RemoteMachine,
  type SessionSync,
  type SessionSyncChunk,
  type SessionSyncResponse,
} from "./protocol";
import { remoteProjectFor, ensureSharedProject, sharedHostMachineId, isSharedHostMachine } from "./remoteProjects";
import { translate } from "../../../shared/i18n/language";
import {
  reuseRemoteAttachmentPreviews,
  withRemoteAttachmentPreviews,
} from "./remoteAttachmentPreviews";
import { hostOrchestrationClient } from "../../orchestration/model/orchestrationClient";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { useHostConnections } from "./hostConnections";
import {
  OUTBOX_PREFIX,
  deleteOutboxEntries,
  outboxEntry,
  outboxKeys,
  putOutboxEntry,
} from "./remoteOutbox";

export const REMOTE_MACHINES_CHANGED = "omnicode:remote-machines";
const CHANGE = REMOTE_MACHINES_CHANGED;
export const REMOTE_HISTORY_CHANGE = "omnicode:remote-history";
export const REMOTE_HISTORY_UPDATED = "omnicode:remote-history-updated";
export const refreshRemoteProjectSessions = () =>
  window.dispatchEvent(new Event(REMOTE_HISTORY_CHANGE));
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

export async function remoteRequest<T>(
  machineId: string,
  method: string,
  params: unknown = {},
): Promise<T> {
  const result = await invoke<T>("remote_request", { machineId, method, params });
  if (method === "sessions.delete" && machineId === sharedHostMachineId()) {
    // Explicit deletion clears the migration row's native worktree/reminder
    // references, without deleting the original attachment recovery files.
    await invoke("session_delete", { sessionId: (params as { sessionId: string }).sessionId, imagePaths: [] });
  }
  return result;
}

/** Share one transfer at a time; a newer revision waits for the current transfer. */
function syncRemoteSession(machineId: string, sessionId: string, revision?: number, waitMs?: number, contentMode?: ToolContentMode, history?: HistoryRequest): Promise<SessionSync> {
  const queryKey = ["remoteSessionTransfer", machineId, sessionId, contentMode ?? "full", history];
  const pending = queryClient.getQueryCache().find<SessionSync>({ queryKey, exact: true });
  if (pending?.state.fetchStatus === "fetching" && pending.promise) {
    if (pending.meta?.revision === revision) return pending.promise;
    const retry = () => syncRemoteSession(machineId, sessionId, revision, waitMs, contentMode, history);
    return pending.promise.then(retry, retry);
  }
  return queryClient.fetchQuery({
    queryKey, gcTime: 0, meta: { revision },
    queryFn: () => requestSessionSync(machineId, sessionId, revision, waitMs, contentMode, history),
  });
}

/** Assemble bounded pieces of one Host revision before releasing the request. */
async function requestSessionSync(
  machineId: string,
  sessionId: string,
  revision?: number,
  waitMs?: number,
  contentMode?: ToolContentMode,
  history?: HistoryRequest,
): Promise<SessionSync> {
  const sentAt = Date.now();
  const response = await remoteRequest<SessionSyncResponse>(
    machineId,
    history?.before ? "sessions.history" : "sessions.sync",
    { sessionId, revision, ...(history ? { history } : {}), ...(waitMs ? { waitMs } : {}), ...(contentMode ? { contentMode } : {}) },
  );
  const clockOffsetMs = sessionClockOffset(response, sentAt, Date.now());
  if (response.kind !== "chunked") return { ...response, clockOffsetMs };
  const pieces: string[] = [];
  let offset = 0;
  while (offset < response.length) {
    const { data } = await remoteRequest<SessionSyncChunk>(
      machineId,
      "sessions.syncChunk",
      { sessionId, transfer: response.transfer, offset },
    );
    if (!data) throw new Error("Session transfer ended early");
    pieces.push(data);
    offset += data.length;
  }
  if (offset !== response.length)
    throw new Error("Session transfer has an unexpected length");
  return { ...JSON.parse(pieces.join("")) as SessionSync, clockOffsetMs };
}

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
  contentMode?: ToolContentMode,
  windowed = false,
  earlier = false,
): Promise<HostSession> {
  if (windowed) return readHistoryWindow(["desktop", machineId, sessionId], known, earlier, async (base, page) => {
    const history: HistoryRequest = { mode: HISTORY_MODE, start: base?.history?.start,
      ...(page && base?.history?.start ? { before: base.history.start } : {}) };
    const revision = base?.history?.mode === HISTORY_MODE && base.contentMode === contentMode ? base.revision : undefined;
    const update = await syncRemoteSession(machineId, sessionId, revision, page ? undefined : waitMs, contentMode, history);
    let result: HostSession;
    try { result = applySessionSync(base, update); }
    catch { result = applySessionSync(undefined, await syncRemoteSession(machineId, sessionId, undefined, undefined, contentMode, history)); }
    return reuseRemoteAttachmentPreviews(result, base);
  });
  const sync = (revision?: number) =>
    syncRemoteSession(machineId, sessionId, revision, revision === undefined ? undefined : waitMs, contentMode);
  const update = await sync(known?.contentMode === contentMode ? known?.revision : undefined);
  let snapshot: HostSession;
  try {
    snapshot = applySessionSync(known, update);
  } catch {
    snapshot = applySessionSync(undefined, await sync());
  }
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

const machinesKey = ["remoteMachines"] as const;
const machinesQuery = () => queryOptions({
  queryKey: machinesKey,
  queryFn: async () => {
    const revision = machineRevision;
    const value = await invoke<RemoteMachine[]>("remote_machines");
    return machineRevision === revision ? (Array.isArray(value) ? value : []) : queryClient.getQueryData<RemoteMachine[]>(machinesKey) ?? [];
  },
});
export async function remoteMachineById(machineId: string): Promise<RemoteMachine | undefined> {
  const known = queryClient.getQueryData<RemoteMachine[]>(machinesKey)?.find(machine => machine.id === machineId);
  return known ?? (await queryClient.fetchQuery(machinesQuery())).find(machine => machine.id === machineId);
}
export function knownRemoteMachine(environmentId: string): RemoteMachine | undefined {
  return queryClient.getQueryData<RemoteMachine[]>(machinesKey)?.find(entry => entry.environmentId === environmentId);
}
export async function remoteMachineFor(environmentId: string): Promise<RemoteMachine | undefined> {
  const state = queryClient.getQueryState<RemoteMachine[]>(machinesKey);
  const known = knownRemoteMachine(environmentId);
  if (known || (state?.data && state.fetchStatus !== "fetching")) return known;
  await queryClient.fetchQuery(machinesQuery());
  return knownRemoteMachine(environmentId);
}

export async function connectMachine(
  name: string,
  url: string,
  token: string,
): Promise<RemoteMachine> {
  const machine = await invoke<RemoteMachine>("remote_connect", {
    name,
    url,
    token,
  });
  machineRevision++;
  queryClient.setQueryData<RemoteMachine[]>(machinesKey, current => [
    ...(current ?? []).filter(entry => entry.id !== machine.id), machine,
  ]);
  window.dispatchEvent(new Event(CHANGE));
  const { publishHostConnection } = await import("./hostConnections");
  await publishHostConnection(machine);
  return machine;
}

export async function disconnectMachine(machineId: string): Promise<void> {
  const machine = queryClient.getQueryData<RemoteMachine[]>(machinesKey)?.find(entry => entry.id === machineId);
  if (machineId === sharedHostMachineId() || (machine && isSharedHostMachine(machine)))
    throw new Error(translate("This computer cannot be removed."));
  await invoke("remote_disconnect", { machineId });
  removeToolContentQueries(["desktop", machineId]);
  await queryClient.cancelQueries({ queryKey: ["sessionHistory", "desktop", machineId] });
  queryClient.removeQueries({ queryKey: ["sessionHistory", "desktop", machineId] });
  machineRevision++;
  queryClient.setQueryData<RemoteMachine[]>(machinesKey, current => (current ?? []).filter(entry => entry.id !== machineId));
  window.dispatchEvent(new Event(CHANGE));
}

export function useRemoteMachines(enabled = true): { machines: RemoteMachine[]; loaded: boolean } {
  const directory = useHostConnections();
  const read = useQuery({ ...machinesQuery(), enabled }, queryClient);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { void invalidateAfterChange(machinesKey); };
    window.addEventListener(CHANGE, refresh);
    return () => window.removeEventListener(CHANGE, refresh);
  }, [enabled]);
  return useMemo(() => ({
    loaded: read.isFetched,
    machines: (read.data ?? []).map(machine => {
      const shared = directory.connections.find(entry => entry.environmentId === machine.environmentId);
      return shared && shared.name !== machine.name ? { ...machine, name: shared.name } : machine;
    }),
  }), [read.data, read.isFetched, directory.connections]);
}

/** A successful request can publish reachability before the next scheduled probe. */
export function reportRemoteMachineStatus(machineId: string, online: boolean) {
  queryClient.setQueryData(["remoteMachineOnline", machineId], { online, failures: 0 });
}
export function useRemoteMachineOnline(machineId?: string): boolean | undefined {
  const read = useQuery({
    queryKey: ["remoteMachineOnline", machineId], enabled: !!machineId,
    refetchInterval: query => query.state.data?.failures ? Math.min(30_000, 3_000 * 2 ** query.state.data.failures) : 15_000,
    queryFn: async () => {
      try {
        await remoteRequest(machineId!, "environment.describe");
        return { online: true, failures: 0 };
      } catch {
        const previous = queryClient.getQueryData<{ failures: number }>(["remoteMachineOnline", machineId]);
        return { online: false, failures: Math.min(4, (previous?.failures ?? 0) + 1) };
      }
    },
  }, queryClient);
  return read.data?.online;
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

type HistoryData = { sessions: HostSessionSummary[]; loaded: boolean };
type HistoryError = Error & { failures?: number; unavailable?: boolean };
const sessionProjectKey = (project: string) => remoteProjectFor(project)?.key ??
  (project.replace(/\\/g, "/").replace(/\/+$/, "") || "/");
const sessionProjectIdentity = (project: string) => {
  const remote = remoteProjectFor(project);
  return remote ? JSON.stringify([remote.environmentId, remote.local ? remote.key : remote.projectId]) : undefined;
};
const remoteHistoryKey = (project: string) => {
  const remote = remoteProjectFor(project);
  return ["remoteHistory", sessionProjectKey(project), sessionProjectIdentity(project) ?? null,
    remote ? knownRemoteMachine(remote.environmentId)?.id ?? null : null] as const;
};
function storedHistory(project: string): HistoryData {
  try {
    const raw = localStorage.getItem(historyKey(sessionProjectKey(project))) ?? localStorage.getItem(historyKey(project));
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (Array.isArray(value)) return { sessions: value, loaded: true };
  } catch { /* A damaged disk snapshot never prevents a fresh read. */ }
  return { sessions: [], loaded: false };
}
function remoteHistoryQuery(project: string) {
  const queryKey = remoteHistoryKey(project);
  const identity = sessionProjectIdentity(project);
  const remote = remoteProjectFor(project);
  return queryOptions({
    queryKey, initialData: () => storedHistory(project),
    meta: queryClient.getQueryCache().find({ queryKey, exact: true })?.meta ?? {},
    queryFn: async (): Promise<HistoryData> => {
      const previous = queryClient.getQueryData<HistoryData>(queryKey) ?? storedHistory(project);
      try {
        if (!remote) throw new Error("Remote project is not registered on this computer");
        const machine = await remoteMachineFor(remote.environmentId);
        if (!machine) throw Object.assign(new Error("Remote machine is not connected"), { unavailable: true });
        const hostProject = remote.local ? await ensureSharedProject(remote.key) : remote;
        if (sessionProjectIdentity(project) !== identity || knownRemoteMachine(remote.environmentId)?.id !== machine.id) return previous;
        const sessions = await remoteRequest<HostSessionSummary[]>(machine.id, "sessions.list", { projectId: hostProject.projectId });
        if (sessionProjectIdentity(project) !== identity || knownRemoteMachine(remote.environmentId)?.id !== machine.id) return previous;
        for (const row of sessions) hostOrchestrationClient.accept({ machineId: machine.id, project: hostProject }, row);
        if (!previous.loaded || JSON.stringify(sessions) !== JSON.stringify(previous.sessions))
          persistRemoteHistory(sessionProjectKey(project), sessions);
        return { sessions, loaded: true };
      } catch (reason) {
        const previousError = queryClient.getQueryState<HistoryData, HistoryError>(queryKey)?.error;
        const error: HistoryError = reason instanceof Error ? reason : new Error(String(reason));
        error.failures = Math.min(4, (previousError?.failures ?? 0) + 1);
        throw error;
      }
    },
  });
}
function historyQuery(project: string) {
  return queryClient.getQueryCache().build(queryClient, queryClient.defaultQueryOptions(remoteHistoryQuery(project)));
}
function historyState(query: Pick<Query<HistoryData, Error>, "state">) {
  const { data, error, fetchStatus } = query.state;
  return {
    sessions: data?.sessions ?? [], loaded: data?.loaded ?? false,
    pending: fetchStatus === "fetching" && (!data?.loaded || !!error),
    error: fetchStatus === "fetching" || (error as HistoryError | null)?.unavailable ? undefined : error?.message,
    offline: !!error,
  };
}
// Legacy consumers receive only presentation changes; unchanged background reads stay silent.
queryClient.getQueryCache().subscribe(event => {
  if (event.type !== "updated" || event.query.queryKey[0] !== "remoteHistory") return;
  const state = historyState(event.query as Query<HistoryData, Error>);
  const next = [state.sessions, state.loaded, state.pending, state.error, state.offline];
  const previous = event.query.meta?.announced as unknown[] | undefined;
  if (previous && next.every((value, index) => value === previous[index])) return;
  if (event.query.meta) event.query.meta.announced = next;
  window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED));
});
export function cachedRemoteSessions(project: string): HostSessionSummary[] {
  return historyQuery(project).state.data!.sessions;
}
export function hasCachedRemoteProjectSessions(project: string): boolean {
  return historyQuery(project).state.data!.loaded;
}
export function cachedRemoteProjectSessionsState(project: string): Readonly<Omit<RemoteProjectSessions, "machine" | "sessions">> {
  const { sessions: _sessions, ...state } = historyState(historyQuery(project));
  const remote = remoteProjectFor(project);
  return { ...state, offline: (!!remote || isRemoteProjectPath(project)) &&
    (!remote || !knownRemoteMachine(remote.environmentId) || state.offline) };
}
export function cachedRemoteSessionSummary(project: string, sessionId: string) {
  return cachedRemoteSessions(project).find(session => session.id === sessionId);
}
export function prefetchRemoteProjectSessions(project: string): Promise<unknown> {
  if (!remoteProjectFor(project) && !isRemoteProjectPath(project)) return Promise.resolve();
  const request = queryClient.fetchQuery(remoteHistoryQuery(project));
  void request.catch(() => {});
  return historyQuery(project).promise ?? request;
}
export function useRemoteProjectSessions(project: string, enabled = true): RemoteProjectSessions {
  const remote = remoteProjectFor(project);
  useRemoteMachines(enabled && !!remote);
  const machine = remote ? knownRemoteMachine(remote.environmentId) : undefined;
  const options = remoteHistoryQuery(project);
  const read = useQuery({
    ...options, enabled: enabled && !!remote,
    refetchInterval: query => query.state.error ? Math.min(30_000, 3_000 * 2 ** ((query.state.error as HistoryError).failures ?? 1)) : 3_000,
    notifyOnChangeProps: () => {
      const state = queryClient.getQueryState<HistoryData>(options.queryKey);
      return state?.data?.loaded && !state.error ? ["data", "error"] : ["data", "error", "isFetching"];
    },
  }, queryClient);
  useEffect(() => {
    const refresh = () => {
      if (remoteProjectFor(project) || isRemoteProjectPath(project)) void prefetchRemoteProjectSessions(project).catch(() => {});
    };
    window.addEventListener(REMOTE_HISTORY_CHANGE, refresh);
    return () => window.removeEventListener(REMOTE_HISTORY_CHANGE, refresh);
  }, [project]);
  const state = {
    sessions: read.data?.sessions ?? [], loaded: read.data?.loaded ?? false,
    pending: read.isFetching && (!read.data?.loaded || read.isError),
    error: read.isFetching || (read.error as HistoryError | null)?.unavailable ? undefined : read.error?.message,
    offline: read.isError,
  };
  return { ...state, machine, offline: (!!remote || isRemoteProjectPath(project)) && (!machine || state.offline) };
}
