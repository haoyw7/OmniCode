import { queryClient } from "../shared/lib/queryClient";
import { createStore } from "zustand/vanilla";
import { readMobileDeviceInfo } from "./deviceInfo";
import { ModelCatalogLoad } from "../features/connections/model/modelCatalogLoad";
import { readMobileInstallationId } from "./deviceIdentity";
import { walkTranscript } from "../features/sessions/model/agentTranscript";
import type { Note, NoteUpsert } from "../features/notes/notesText";
import type { NoteImageAsset } from "../features/notes/noteImagesText";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { sessionMessageActivityAt } from "../features/sessions/model/sessionActivity";
import {
  HOST_PROTOCOL_VERSION,
  REMOTE_PROVIDERS,
  applySessionSync,
  migrateSavedHostCommand,
  sessionClockOffset,
  requireHostDescriptor,
  type HostDescriptor,
  type HostDeviceInfo,
  type HostDirectory,
  type HostProject,
  type HostSession,
  type HostSessionSummary,
  type HostSessionActivity,
  type HostModelCatalog,
  type HostProviderAccounts,
  type HostProviderUsage,
  type HostProviderUsageRequest,
  type HostSkillCatalog,
  type HostWorktree,
  type HostCommand,
  type CommandReceipt,
  type SessionSync,
  type SessionSyncResponse,
  type SessionSyncChunk,
  type RemoteAttachment,
} from "../features/connections/model/protocol";
import type {
  Attachment,
  LinkedWorkItem,
} from "../features/sessions/model/session";
import {
  MOBILE_ATTACHMENT_BYTES,
  MOBILE_ATTACHMENT_LIMIT,
} from "./attachments";
import {
  reuseRemoteAttachmentPreviews,
  withRemoteAttachmentPreviews,
} from "../features/connections/model/remoteAttachmentPreviews";
import { withoutSessionPreviewData } from "./sessionPreviewCache";
import { mobileOfflineCache, OFFLINE_SESSION_LIMIT, type MobileOfflineCache, type OfflineCacheWrite } from "./offlineCache";
import { isOfflineModels, isOfflineProjects, isOfflineSession } from "./offlineCacheData";
import type { MobileStorage } from "./storage";
import { translate } from "../shared/i18n/language";
import type { NativeSessionAccess } from "../integrations/harness/core/nativeSessions";
import {
  readSessionCache,
  cachedSessionSummary,
  removeSessionCache,
  saveSessionCache,
  SESSION_CACHE_PROJECT_LIMIT,
} from "./sessionCache";

export type Connection = {
  endpoint: string;
  token: string;
  environmentId: string;
  name: string;
  /** Explicitly switched off on this device; retain credentials for reconnect. */
  disabled?: boolean;
};
export type PendingCommand = {
  endpoint: string;
  environmentId: string;
  command: HostCommand;
  followup?: string | MobileFirstMessage;
};
export type MobileSessionPatch = {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  linkedWorkItem?: LinkedWorkItem | null;
};
export type MobileFirstMessage = Pick<
  Extract<HostCommand, { type: "send" }>,
  "text" | "attachments" | "intent" | "worktreeCreation"
>;
export type RpcTransport = (
  endpoint: string,
  token: string,
  request: object,
  options?: { timeoutMs?: number },
) => Promise<unknown>;
export type MobileBranches = {
  current: string | null;
  branches: string[];
  remotes: { remote: string; name: string }[];
};
export type MobileWorktrees = {
  worktrees: HostWorktree[];
  defaultRoot: string;
};
const RPC_TIMEOUT_MS = 20_000;
// Naming can try the configured title model, then ask the agent itself.
const WORKTREE_NAME_TIMEOUT_MS = 150_000;
// Checking out a large working copy can outlast an ordinary request.
const WORKTREE_CREATE_TIMEOUT_MS = 120_000;

export function normalizeHostUrl(input: string): string {
  const url = new URL(input.trim());
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error(
      "Enter the Host URL only, without credentials, a path, or query parameters.",
    );
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Use an HTTP or HTTPS Host URL.");
  return url.origin;
}

export class HostRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type HostConnectionStatus = {
  state: "disconnected" | "connected" | "reconnecting" | "failed";
  reason?: "authentication" | "timeout" | "identity";
  detail?: string;
};

export const nativeTransport: RpcTransport = async (
  endpoint,
  token,
  request,
  { timeoutMs = RPC_TIMEOUT_MS } = {},
) => {
  let status: number;
  let data: unknown;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url: `${endpoint}/rpc`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: request,
      connectTimeout: 10_000,
      readTimeout: timeoutMs,
      disableRedirects: true,
      responseType: "json",
    });
    status = response.status;
    data = response.data;
  } else if (import.meta.env.DEV) {
    const response = await fetch("/__mobile/rpc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint, request, timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    data = await response.json();
  } else {
    throw new Error("Open OmniCode on iOS or Android to connect to a Host.");
  }
  if (typeof data === "string") data = JSON.parse(data);
  if (status < 200 || status >= 300) {
    const message = (data as { error?: string })?.error;
    throw new HostRequestError(
      message || `Host request failed (${status})`,
      status,
    );
  }
  if (!data || typeof data !== "object" || !("result" in data))
    throw new Error("Invalid Host response.");
  return (data as { result: unknown }).result;
};

// Summary metadata can change without a transcript revision. Compare the full
// JSON value, including optional/nested provider metadata, before reusing it.
function sameCachedValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const previous = left as Record<string, unknown>, next = right as Record<string, unknown>;
  const keys = Object.keys(previous);
  return keys.length === Object.keys(next).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(next, key) && sameCachedValue(previous[key], next[key]));
}

let mobileClientQueryId = 0;

export class MobileClient {
  private deviceInfo?: Promise<HostDeviceInfo | undefined>;
  connection?: Connection;
  private capabilities: string[] = [];
  hasCapability(capability: string): boolean {
    return this.capabilities.includes(capability);
  }
  readonly connectionState = createStore(() => ({ status: { state: "disconnected" } as HostConnectionStatus }));
  private get connectionStatus() { return this.connectionState.getState().status; }
  private verificationEpoch = 0;
  getConnectionStatus = () => this.connectionStatus;
  subscribeConnectionStatus = (listener: () => void) => {
    return this.connectionState.subscribe(listener);
  };
  private setConnectionStatus(status: HostConnectionStatus, force = false) {
    const previous = this.connectionStatus;
    if (
      !force && previous.state === status.state &&
      previous.reason === status.reason &&
      previous.detail === status.detail
    )
      return;
    this.connectionState.setState({ status });
  }
  private connectionFailed(
    error: unknown,
    reason?: HostConnectionStatus["reason"],
  ) {
    const detail =
      error instanceof Error ? error.message : "Host connection failed.";
    this.setConnectionStatus({
      state: "failed",
      reason:
        reason ??
        (error instanceof HostRequestError && [401, 403].includes(error.status)
          ? "authentication"
          : error instanceof Error &&
              /timeout|timed out|aborted/i.test(
                `${error.name} ${error.message}`,
              )
            ? "timeout"
            : undefined),
      detail,
    });
  }
  private dataVisit = 0;
  private dataKey(kind: string, id = "") { return ["mobileClient", this.queryId, kind, this.cacheEpoch, id] as const; }
  private peekSnapshot(id: string) { return queryClient.getQueryData<HostSession>(this.dataKey("snapshot", id)); }
  private cacheSnapshot(id: string, value: HostSession) { this.cacheData("snapshot", id, value); }
  private dropSnapshot(id: string) { queryClient.removeQueries({ queryKey: this.dataKey("snapshot", id), exact: true }); }
  private snapshotEntries(): [string, HostSession][] { return this.dataEntries<HostSession>("snapshot"); }
  private peekSummaries(id: string) { return queryClient.getQueryData<HostSessionSummary[]>(this.dataKey("summaries", id)); }
  private cacheSummaries(id: string, value: HostSessionSummary[]) { this.cacheData("summaries", id, value); }
  private dropSummaries(id: string) { queryClient.removeQueries({ queryKey: this.dataKey("summaries", id), exact: true }); }
  private summaryEntries(): [string, HostSessionSummary[]][] { return this.dataEntries<HostSessionSummary[]>("summaries"); }
  private dataEntries<T>(kind: string): [string, T][] {
    return queryClient.getQueryCache().findAll({ queryKey: ["mobileClient", this.queryId, kind, this.cacheEpoch] })
      .filter(query => query.state.data !== undefined)
      .sort((a, b) => Number(a.meta?.visited ?? 0) - Number(b.meta?.visited ?? 0))
      .map(query => [query.queryKey[4] as string, query.state.data as T]);
  }
  private cacheData<T>(kind: string, id: string, value: T) {
    const queryKey = this.dataKey(kind, id);
    const query = queryClient.getQueryCache().build(queryClient, { queryKey, structuralSharing: false, gcTime: Infinity });
    query.setOptions({ ...query.options, meta: { visited: ++this.dataVisit } });
    queryClient.setQueryData(queryKey, value);
  }
  private projectSnapshot() { return queryClient.getQueryData<HostProject[]>(this.dataKey("projects")); }
  private cacheProjects(value: HostProject[]) { this.cacheData("projects", "", value); }
  private readQuery<T>(queryKey: readonly unknown[], queryFn: () => Promise<T>): Promise<T> {
    const current = queryClient.getQueryCache().find({ queryKey, exact: true });
    if (current?.state.fetchStatus === "fetching") return current.promise as Promise<T>;
    void queryClient.fetchQuery({ queryKey, queryFn, gcTime: Infinity, structuralSharing: false }).catch(() => undefined);
    const query = queryClient.getQueryCache().find({ queryKey, exact: true })!;
    const result = query.promise as Promise<T>;
    const release = () => {
      if (queryClient.getQueryCache().find({ queryKey, exact: true }) === query)
        queryClient.removeQueries({ queryKey, exact: true });
    };
    void result.then(release, release);
    return result;
  }
  // The LRU retains OFFLINE_SESSION_LIMIT transcripts; only the current and most recently read
  // conversation retain downloaded images. Late hydration never changes recency.
  private previewSessions = new Set<string>();
  private readonly queryId = ++mobileClientQueryId;
  private catalogVisit = 0;
  private modelQueryKey(key: string) { return ["mobileClient", this.queryId, "models", this.cacheEpoch, key] as const; }
  private trimModelQueries() {
    const entries = queryClient.getQueryCache().findAll({ queryKey: ["mobileClient", this.queryId, "models"] });
    entries.sort((a, b) => Number(b.meta?.visited ?? 0) - Number(a.meta?.visited ?? 0));
    for (const query of entries.slice(8)) if (query.state.fetchStatus !== "fetching") queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
  }
  private projectTurn = 0;
  private summariesEnvironmentId?: string;
  private summaryTurns = new Map<string, number>();
  private summaryWrite?: {
    timer: ReturnType<typeof setTimeout>;
    environmentId: string;
    epoch: number;
    removeListeners: () => void;
  };
  private cacheEpoch = 0;
  private offlineWrites = new Map<string, OfflineCacheWrite>();
  private offlineWriteHost?: string;
  private offlineTimer?: ReturnType<typeof setTimeout>;
  private stopOfflineListeners?: () => void;
  private cacheReadable() {
    return !!this.connection && !this.connection.disabled &&
      this.connectionStatus.reason !== "identity" && this.connectionStatus.reason !== "authentication";
  }
  private queueOffline(entry: OfflineCacheWrite) {
    if (!this.cacheReadable() || (this.offline === mobileOfflineCache && typeof indexedDB === "undefined")) return;
    const host = this.connection!.environmentId;
    if (this.offlineWriteHost && this.offlineWriteHost !== host) void this.flushOfflineCache();
    this.offlineWriteHost = host;
    const key = JSON.stringify([entry.kind, entry.id]);
    // A touch must not replace a pending content update.
    const previous = this.offlineWrites.get(key);
    this.offlineWrites.delete(key);
    this.offlineWrites.set(key, entry.value === undefined && previous ? previous : entry);
    if (this.offlineTimer !== undefined) return;
    this.offlineTimer = setTimeout(() => void this.flushOfflineCache(), 1000);
    const hidden = () => { if (document.visibilityState === "hidden") void this.flushOfflineCache(); };
    const pagehide = () => { void this.flushOfflineCache(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", hidden);
    if (typeof window !== "undefined") window.addEventListener("pagehide", pagehide);
    this.stopOfflineListeners = () => {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", hidden);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", pagehide);
    };
  }
  /** Also used at lifecycle boundaries; changing Hosts never reassigns pending writes. */
  async flushOfflineCache() {
    clearTimeout(this.offlineTimer);
    this.offlineTimer = undefined;
    this.stopOfflineListeners?.();
    this.stopOfflineListeners = undefined;
    const host = this.offlineWriteHost;
    const entries = [...this.offlineWrites.values()].map(entry => entry.kind === "session" && entry.value
      ? { ...entry, value: withoutSessionPreviewData(entry.value as HostSession, true) } : entry);
    this.offlineWrites.clear();
    this.offlineWriteHost = undefined;
    if (host && entries.length) await this.offline.write(host, entries).catch(() => {});
  }
  private async restoreOfflineCache() {
    const host = this.connection?.environmentId;
    const epoch = this.cacheEpoch;
    if (!host || !this.cacheReadable()) return;
    const entries = await this.offline.readHost(host).catch(() => []);
    if (epoch !== this.cacheEpoch || host !== this.connection?.environmentId || !this.cacheReadable()) return;
    for (const entry of entries) {
      const value = entry.value;
      if (entry.kind === "session" && isOfflineSession(value, entry.id)) {
        if (!!!this.peekSnapshot(entry.id)) this.cacheSnapshot(entry.id, value);
        if (this.snapshotEntries().length > OFFLINE_SESSION_LIMIT) this.dropSnapshot(this.snapshotEntries()[0]![0]);
      } else if (entry.kind === "models" && isOfflineModels(value)) {
        // A persisted catalog is a preview, never proof that a provider is still available.
        const queryKey = this.modelQueryKey(entry.id);
        if (!queryClient.getQueryData(queryKey)) queryClient.setQueryData(queryKey, { ...value, pending: [] }, { updatedAt: 0 });
        this.trimModelQueries();
      } else if (entry.kind === "projects" && isOfflineProjects(value)) {
        if (!this.projectSnapshot()) this.cacheProjects(value);
      } else if (entry.kind === "summaries" && Array.isArray(value)) {
        this.summariesEnvironmentId = host;
        for (const item of value.slice(-SESSION_CACHE_PROJECT_LIMIT)) {
          if (!Array.isArray(item) || typeof item[0] !== "string" || !Array.isArray(item[1])) continue;
          if (!!!this.peekSummaries(item[0]))
            this.cacheSummaries(item[0], item[1].map((row: unknown) => cachedSessionSummary(row, item[0]))
              .filter((row): row is HostSessionSummary => row !== undefined));
        }
      }
    }
    if (entries.length) this.setConnectionStatus({ ...this.connectionStatus }, true);
  }
  cachedProjects(): HostProject[] | undefined {
    return this.cacheReadable() ? this.projectSnapshot() : undefined;
  }
  private clearCaches() {
    void this.flushOfflineCache();
    this.capabilities = [];
    this.cancelSummaryWrite();
    this.cacheEpoch += 1;
    queryClient.removeQueries({ queryKey: ["mobileClient", this.queryId], predicate: query =>
      query.state.fetchStatus !== "fetching" || !["projectRead", "summaryRead", "sessionRead"].includes(String(query.queryKey[2])) });
    this.previewSessions.clear();
    queryClient.removeQueries({ queryKey: ["mobileClient", this.queryId, "models"] });
    this.summariesEnvironmentId = undefined;
    this.summaryTurns.clear();
  }
  private rememberSession(value: HostSession): HostSession {
    const previousSnapshot = this.peekSnapshot(value.session.id);
    if (!this.previewSessions.has(value.session.id)) value = withoutSessionPreviewData(value);
    this.dropSnapshot(value.session.id);
    this.cacheSnapshot(value.session.id, value);
    if (this.snapshotEntries().length > OFFLINE_SESSION_LIMIT)
      this.dropSnapshot(this.snapshotEntries()[0]![0]);
    if (!previousSnapshot || previousSnapshot.revision !== value.revision || previousSnapshot.updatedAt !== value.updatedAt) {
      this.queueOffline({ kind: "session", id: value.session.id, value });
      if (this.projectSnapshot()) this.queueOffline({ kind: "projects", id: "", value: this.projectSnapshot() });
    }
    const sessions = this.cachedSessions(value.projectId) ?? [];
    const previous = sessions.find((item) => item.id === value.session.id);
    if (!previous || previous.revision < value.revision ||
      (previous.revision === value.revision && previous.updatedAt < value.updatedAt)) {
      const lastUserMessage = [...value.session.blocks].reverse().find(
        (block) => block.role === "user" && !block.draft && !block.internal,
      );
      const sentAt = lastUserMessage?.sentAt ?? lastUserMessage?.startedAt;
      const item: HostSessionSummary = {
        ...previous,
        id: value.session.id, projectId: value.projectId,
        title: value.session.title,
        harness: value.session.harness as HostSessionSummary["harness"],
        status: value.status, revision: value.revision, updatedAt: value.updatedAt,
        pinned: value.pinned, archived: value.archived,
        lastUserMessageAt: sentAt !== undefined && Number.isFinite(sentAt) && sentAt > 0 ? sentAt : null,
        activityAt: sessionMessageActivityAt(value.session, value.status === "running") ?? null,
      };
      this.rememberSummaries(value.projectId, previous
        ? sessions.map((session) => session.id === item.id ? item : session)
        : [...sessions, item]);
    }
    return value;
  }
  cachedSession(sessionId: string): HostSession | undefined {
    if (!this.cacheReadable()) return undefined;
    const value = this.peekSnapshot(sessionId);
    if (value) {
      if ([...this.snapshotEntries().map(([id]) => id)].at(-1) !== sessionId) {
        this.queueOffline({ kind: "session", id: sessionId });
        if (this.projectSnapshot()) this.queueOffline({ kind: "projects", id: "" });
      }
      this.retainSessionPreviews(sessionId);
      this.dropSnapshot(sessionId);
      this.cacheSnapshot(sessionId, value);
    }
    return value;
  }
  private retainSessionPreviews(sessionId: string) {
    this.previewSessions.delete(sessionId);
    this.previewSessions.add(sessionId);
    if (this.previewSessions.size <= 2) return;
    const oldest = this.previewSessions.values().next().value!;
    this.previewSessions.delete(oldest);
    const snapshot = this.peekSnapshot(oldest);
    if (snapshot) this.cacheSnapshot(oldest, withoutSessionPreviewData(snapshot));
    // In-flight transfer promises are shared only until they settle in
    // remoteAttachmentPreviews. They must not repopulate this evicted preview.
    void queryClient.cancelQueries({ queryKey: this.dataKey("previewRead", oldest) });
  }
  private dispatching = false;
  private switchAttempt = 0;
  constructor(
    private readonly storage: MobileStorage,
    private readonly transport: RpcTransport = nativeTransport,
    private readonly offline: MobileOfflineCache = mobileOfflineCache,
  ) {}

  /** Every Host paired on this device, the active one included. */
  async savedConnections(): Promise<Connection[]> {
    let saved: Connection[] = [];
    try {
      const value: unknown = JSON.parse((await this.storage.get("connections")) ?? "[]");
      if (Array.isArray(value))
        saved = value.filter((item): item is Connection =>
          !!item && typeof item.endpoint === "string" && typeof item.token === "string" &&
          typeof item.environmentId === "string" && typeof item.name === "string");
    } catch {
      saved = [];
    }
    // Hosts paired before multiple connections existed live only in "connection".
    const active = await this.storage.get("connection");
    if (active) {
      const connection = JSON.parse(active) as Connection;
      const index = saved.findIndex((item) => item.endpoint === connection.endpoint);
      if (index < 0) saved.unshift(connection);
      else saved[index] = connection;
    }
    return saved;
  }
  /** Saves the active connection and keeps it in the paired Host list, one entry per address. */
  private async persist(connection: Connection): Promise<void> {
    const saved = await this.savedConnections();
    const index = saved.findIndex((item) => item.endpoint === connection.endpoint);
    if (index < 0) saved.push(connection);
    else saved[index] = connection;
    await this.storage.set("connections", JSON.stringify(saved));
    await this.storage.set("connection", JSON.stringify(connection));
  }
  /** Makes another paired connection, identified by its address, the active one. */
  async switchTo(endpoint: string): Promise<void> {
    if (this.connection?.endpoint === endpoint && !this.connection.disabled) return;
    const attempt = ++this.switchAttempt;
    const target = (await this.savedConnections())
      .find((item) => item.endpoint === endpoint);
    if (!target) throw new Error("This Host is no longer paired on this device.");
    const pending = await this.pending();
    if (pending && (pending.endpoint !== endpoint || pending.environmentId !== target.environmentId))
      throw new Error("Reconnect to the previous Host to resolve its pending request first.");
    // A later switch started while this one read storage; let it win.
    if (attempt !== this.switchAttempt) return;
    const connection = { ...target, disabled: false };
    await this.persist(connection);
    if (attempt !== this.switchAttempt) return;
    this.verificationEpoch += 1;
    this.connection = connection;
    this.clearCaches();
    this.setConnectionStatus({ state: "reconnecting" }, true);
    await this.restoreOfflineCache();
    if (attempt !== this.switchAttempt) return;
    await this.verify();
  }

  /** Check a saved device without changing the active connection or its caches. */
  async probeConnection(connection: Connection): Promise<HostConnectionStatus> {
    if (connection.disabled) return { state: "disconnected" };
    try {
      const host = requireHostDescriptor(await this.requestWith<HostDescriptor>(
        { ...connection }, "environment.describe", { supportedProviders: REMOTE_PROVIDERS },
      ));
      return host.environmentId === connection.environmentId
        ? { state: "connected" }
        : { state: "failed", reason: "identity" };
    } catch {
      return { state: "failed" };
    }
  }

  /** Read another paired device's projects without touching the active caches. */
  peekProjects(connection: Connection): Promise<HostProject[]> {
    return this.requestWith<HostProject[]>({ ...connection }, "projects.list", {});
  }
  /** Read another paired device's conversations without touching the active caches. */
  peekSessions(connection: Connection, projectId: string): Promise<HostSessionSummary[]> {
    return this.requestWith<HostSessionSummary[]>({ ...connection }, "sessions.list", { projectId });
  }

  async restore(): Promise<boolean> {
    // Starting over reads the journal from storage again.
    this.pendingValue = undefined;
    const saved = await this.storage.get("connection");
    if (!saved) return false;
    const connection = JSON.parse(saved) as Connection;
    this.connection = connection;
    this.clearCaches();
    if (connection.disabled) {
      this.setConnectionStatus({ state: "disconnected" });
      return false;
    }
    this.setConnectionStatus({ state: "reconnecting" });
    await this.restoreOfflineCache();
    await this.verify();
    return true;
  }
  async connect(endpoint: string, token: string): Promise<void> {
    endpoint = normalizeHostUrl(endpoint);
    token = token.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(token))
      throw new Error("Enter a valid device token from OmniCode Host.");
    if (!this.connection) this.setConnectionStatus({ state: "reconnecting" });
    try {
      const pending = await this.pending();
      if (pending && pending.endpoint !== endpoint)
        throw new Error(
          "Reconnect to the previous Host to resolve its pending request first.",
        );
      let descriptor: HostDescriptor;
      if (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(token)) {
        const paired = await this.requestWith<{ id: string; token: string; host: HostDescriptor }>(
          { endpoint, token },
          "devices.pair",
          {
            supportedProviders: REMOTE_PROVIDERS,
            ...(pending ? { expectedEnvironmentId: pending.environmentId } : {}),
          },
        );
        if (!paired || typeof paired.token !== "string" || !/^[A-Za-z0-9_-]+$/.test(paired.token))
          throw new Error("Invalid Host response.");
        descriptor = requireHostDescriptor(paired.host);
        // Save the private credential with the descriptor from the same receipt.
        // A second network request must not lose an already redeemed code.
        token = paired.token;
      } else {
        descriptor = requireHostDescriptor(
          await this.requestWith<HostDescriptor>(
            { endpoint, token },
            "environment.describe",
            { supportedProviders: REMOTE_PROVIDERS },
          ),
        );
      }
      if (
        pending &&
        (pending.endpoint !== endpoint ||
          pending.environmentId !== descriptor.environmentId)
      )
        throw new Error(
          "Reconnect to the previous Host to resolve its pending request first.",
        );
      const connection = {
        endpoint,
        token,
        environmentId: descriptor.environmentId,
        name: descriptor.name,
      };
      await this.persist(connection);
      this.connection = connection;
      this.clearCaches();
      this.capabilities = Array.isArray(descriptor.capabilities) ? descriptor.capabilities : [];
      this.setConnectionStatus({ state: "connected" }, true);
      await this.restoreOfflineCache();
    } catch (error) {
      if (!this.connection) this.connectionFailed(error);
      throw error;
    }
  }
  async verify(): Promise<void> {
    if (!this.connection) throw new Error("Connect to a Host first.");
    if (this.connection.disabled) return;
    const connection = this.connection;
    const epoch = ++this.verificationEpoch;
    let changedIdentity = false;
    try {
      const host = requireHostDescriptor(
        await this.rpc<HostDescriptor>("environment.describe", {
          supportedProviders: REMOTE_PROVIDERS,
        }),
      );
      if (this.connection !== connection || epoch !== this.verificationEpoch)
        return;
      if (host.environmentId !== connection.environmentId) {
        changedIdentity = true;
        this.clearCaches();
        await this.offline.removeHost(connection.environmentId).catch(() => {});
        removeSessionCache();
        const error = new Error(
          "Host identity changed. Connect to this machine again explicitly.",
        );
        throw error;
      }
      if (host.name !== connection.name) {
        const updated = { ...connection, name: host.name };
        await this.persist(updated);
        if (this.connection !== connection || epoch !== this.verificationEpoch)
          return;
        this.connection = updated;
      }
      this.capabilities = Array.isArray(host.capabilities) ? host.capabilities : [];
      this.setConnectionStatus({ state: "connected" });
    } catch (error) {
      if (this.connection === connection && epoch === this.verificationEpoch)
        this.connectionFailed(error, changedIdentity ? "identity" : undefined);
      throw error;
    }
  }
  async reconnect(): Promise<void> {
    if (!this.connection) throw new Error("Connect to a Host first.");
    this.verificationEpoch += 1;
    this.clearCaches();
    if (this.connection.disabled) {
      const connection = this.connection;
      const enabled = { ...connection, disabled: false };
      await this.persist(enabled);
      if (this.connection !== connection) return;
      this.connection = enabled;
    }
    this.setConnectionStatus({ state: "reconnecting" });
    await this.restoreOfflineCache();
    await this.verify();
  }
  async suspend(): Promise<void> {
    if (!this.connection) return;
    const connection = this.connection;
    const disabled = { ...connection, disabled: true };
    await this.persist(disabled);
    if (this.connection !== connection) return;
    this.verificationEpoch += 1;
    this.connection = disabled;
    this.setConnectionStatus({ state: "disconnected" });
    this.clearCaches();
  }
  /** Forgets a paired connection other than the active one; the active one uses `disconnect`. */
  async forget(endpoint: string): Promise<void> {
    if (this.connection?.endpoint === endpoint) return this.disconnect();
    const saved = await this.savedConnections();
    const forgotten = saved.find(item => item.endpoint === endpoint);
    const remaining = saved.filter((item) => item.endpoint !== endpoint);
    await this.storage.set("connections", JSON.stringify(remaining));
    if (forgotten && !remaining.some(item => item.environmentId === forgotten.environmentId))
      await this.offline.removeHost(forgotten.environmentId).catch(() => {});
  }
  async disconnect(): Promise<void> {
    this.pendingValue = undefined;
    const endpoint = this.connection?.endpoint;
    const host = this.connection?.environmentId;
    const remaining = (await this.savedConnections())
      .filter((item) => item.endpoint !== endpoint);
    await this.storage.set("connections", JSON.stringify(remaining));
    await this.storage.remove("connection");
    this.connection = undefined;
    this.setConnectionStatus({ state: "disconnected" });
    this.clearCaches();
    if (host && !remaining.some(item => item.environmentId === host))
      await this.offline.removeHost(host).catch(() => {});
    removeSessionCache();
  }
  private async requestWith<T>(
    connection: Pick<Connection, "endpoint" | "token"> & Partial<Connection>,
    method: string,
    params: object,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    try {
      if (method === "environment.describe" || method === "devices.pair") {
        const deviceInfo = await (this.deviceInfo ??= readMobileDeviceInfo());
        const installationId = await readMobileInstallationId(this.storage);
        if (deviceInfo || installationId) params = {
          ...params, deviceInfo: { ...deviceInfo, ...(installationId ? { installationId } : {}) },
        };
      }
      const result = await this.transport(
        connection.endpoint,
        connection.token,
        {
          version: HOST_PROTOCOL_VERSION,
          environmentId: connection.environmentId,
          method,
          params,
        },
        ...(options ? [options] : []),
      );
      if (
        this.connection === connection &&
        method !== "environment.describe" &&
        this.connectionStatus.state !== "reconnecting"
      )
        this.setConnectionStatus({ state: "connected" });
      return result as T;
    } catch (error) {
      if (
        this.connection === connection &&
        method !== "environment.describe" &&
        this.connectionStatus.state !== "reconnecting"
      ) {
        if (error instanceof HostRequestError && error.status === 400) {
          this.setConnectionStatus({ state: "connected" });
        } else this.connectionFailed(error);
      }
      throw error;
    }
  }
  rpc<T>(method: string, params: object = {}, options?: { timeoutMs?: number }): Promise<T> {
    if (!this.connection || this.connection.disabled)
      return Promise.reject(new Error("Connect to a Host first."));
    return this.requestWith<T>(this.connection, method, params, options);
  }
  branches(projectId: string, cwd?: string) {
    return this.rpc<MobileBranches>("git.branches", { projectId, ...(cwd ? { cwd } : {}) });
  }
  worktrees(projectId: string) {
    return this.rpc<MobileWorktrees>("git.worktrees", { projectId });
  }
  worktreeName(projectId: string, cwd: string, harness: string, message: string) {
    return this.rpc<string>(
      "git.worktreeName",
      { projectId, cwd, harness, message },
      { timeoutMs: WORKTREE_NAME_TIMEOUT_MS },
    );
  }
  worktreeCreate(projectId: string, cwd: string, branch: string, base: string) {
    return this.rpc<HostWorktree>("git.worktreeCreate", {
      projectId,
      cwd,
      branch,
      base,
      existing: false,
    }, { timeoutMs: WORKTREE_CREATE_TIMEOUT_MS });
  }
  listNotes() { return this.rpc<Note[]>("notes.list"); }
  getNote(id: string) { return this.rpc<Note | null>("notes.get", { id }); }
  upsertNote(note: NoteUpsert) { return this.rpc<Note>("notes.upsert", { note }); }
  deleteNote(id: string) { return this.rpc<void>("notes.delete", { id }); }
  noteImage(asset: string) { return this.rpc<{ mime: string; data: string }>("notes.image", { asset }); }
  saveNoteImage(noteId: string, name: string, data: string) {
    return this.rpc<NoteImageAsset>("notes.saveImage", { noteId, name, data });
  }

  projects(): Promise<HostProject[]> {
    return this.readQuery([...this.dataKey("projectRead"), this.projectTurn], () => this.loadProjects());
  }
  private async loadProjects() {
    const epoch = this.cacheEpoch;
    const turn = this.projectTurn;
    const projects = await this.rpc<HostProject[]>("projects.list");
    if (epoch !== this.cacheEpoch) throw new Error(translate("Host connection changed."));
    // Opening a project invalidates lists started before that mutation. Join
    // its replacement request instead of publishing the old project's list.
    if (turn !== this.projectTurn) return this.projectSnapshot() ?? this.projects();
    const cached = this.projectSnapshot();
    if (cached && sameCachedValue(cached, projects)) return cached;
    this.cacheProjects(projects);
    this.queueOffline({ kind: "projects", id: "", value: projects });
    return projects;
  }
  browseDirectories(path?: string) {
    return this.rpc<HostDirectory>(
      "projects.browse",
      path === undefined ? {} : { path },
    );
  }
  async openProject(cwd: string) {
    const epoch = this.cacheEpoch;
    const project = await this.rpc<HostProject>("projects.open", { cwd: cwd.trim() });
    if (epoch !== this.cacheEpoch) throw new Error(translate("Host connection changed."));
    this.projectTurn += 1;
    if (this.projectSnapshot())
      this.cacheProjects([...this.projectSnapshot()!.filter((item) => item.id !== project.id), project]);
    return project;
  }
  /** A new projectless chat folder on the Host, listed as a project. */
  async createChat() {
    const epoch = this.cacheEpoch;
    const project = await this.rpc<HostProject>("projects.createChat");
    if (epoch !== this.cacheEpoch) throw new Error(translate("Host connection changed."));
    this.projectTurn += 1;
    if (this.projectSnapshot())
      this.cacheProjects([...this.projectSnapshot()!.filter((item) => item.id !== project.id), project]);
    return project;
  }
  /** Last known list, including a bounded preview restored for this Host. */
  cachedSessions(projectId: string): HostSessionSummary[] | undefined {
    const connection = this.connection;
    if (!connection || connection.disabled || this.connectionStatus.reason === "identity") return undefined;
    if (this.summariesEnvironmentId !== connection.environmentId) {
      for (const [id, rows] of readSessionCache(connection.environmentId)) this.cacheSummaries(id, rows);
      this.summariesEnvironmentId = connection.environmentId;
    }
    const value = this.peekSummaries(projectId);
    if (value) {
      this.dropSummaries(projectId);
      this.cacheSummaries(projectId, value);
    }
    return value;
  }
  private nextSummaryTurn(projectId: string): number {
    const turn = (this.summaryTurns.get(projectId) ?? 0) + 1;
    this.summaryTurns.set(projectId, turn);
    return turn;
  }
  private cancelSummaryWrite() {
    const pending = this.summaryWrite;
    if (!pending) return;
    this.summaryWrite = undefined;
    clearTimeout(pending.timer);
    pending.removeListeners();
  }
  private flushSummaryWrite = () => {
    const pending = this.summaryWrite;
    if (!pending) return;
    this.cancelSummaryWrite();
    if (pending.epoch !== this.cacheEpoch ||
      pending.environmentId !== this.connection?.environmentId ||
      pending.environmentId !== this.summariesEnvironmentId ||
      this.connection.disabled || this.connectionStatus.reason === "identity") return;
    saveSessionCache(pending.environmentId, new Map(this.summaryEntries()));
  };
  private scheduleSummaryWrite() {
    if (this.summaryWrite || !this.summariesEnvironmentId) return;
    const page = typeof document === "undefined" ? undefined : document;
    const browser = typeof window === "undefined" ? undefined : window;
    const onVisibility = () => {
      if (page?.visibilityState === "hidden") this.flushSummaryWrite();
    };
    // Only a pending write owns listeners, including across reconnects.
    this.summaryWrite = {
      timer: setTimeout(this.flushSummaryWrite, 1_000),
      environmentId: this.summariesEnvironmentId,
      epoch: this.cacheEpoch,
      removeListeners: () => {
        page?.removeEventListener("visibilitychange", onVisibility);
        browser?.removeEventListener("pagehide", this.flushSummaryWrite);
      },
    };
    page?.addEventListener("visibilitychange", onVisibility);
    browser?.addEventListener("pagehide", this.flushSummaryWrite);
  }
  private rememberSummaries(projectId: string, sessions: HostSessionSummary[]) {
    const previous = this.cachedSessions(projectId);
    const byId = new Map(previous?.map((item) => [item.id, item]));
    const shared = sessions.map((item) => {
      const known = byId.get(item.id);
      return known && sameCachedValue(known, item) ? known : item;
    });
    if (previous?.length === shared.length && shared.every((item, index) => item === previous[index]))
      return previous;
    this.dropSummaries(projectId);
    this.cacheSummaries(projectId, shared);
    if (this.summaryEntries().length > SESSION_CACHE_PROJECT_LIMIT)
      this.dropSummaries(this.summaryEntries()[0]![0]);
    this.scheduleSummaryWrite();
    this.queueOffline({ kind: "summaries", id: "", value: this.summaryEntries().map(([id, rows]) =>
      // A saved transcript must remain reachable even in a project with hundreds of rows.
      [id, [...rows.filter(row => !!this.peekSnapshot(row.id)), ...rows.filter(row => !!!this.peekSnapshot(row.id))].slice(0, 100)]) });
    return shared;
  }
  sessions(projectId: string): Promise<HostSessionSummary[]> {
    const turn = this.summaryTurns.get(projectId) ?? 0;
    this.summaryTurns.set(projectId, turn);
    return this.readQuery([...this.dataKey("summaryRead", projectId), turn], () => this.loadSummaries(projectId, turn));
  }
  private async loadSummaries(projectId: string, turn: number) {
    const epoch = this.cacheEpoch;
    const environmentId = this.connection?.environmentId;
    const known = this.cachedSessions(projectId);
    const knownById = new Map(known?.map((item) => [item.id, item]));
    const value = await this.rpc<HostSessionSummary[]>("sessions.list", { projectId });
    if (epoch !== this.cacheEpoch || environmentId !== this.connection?.environmentId)
      throw new Error(translate("Host connection changed."));
    // A newer list or metadata mutation may settle before this request.
    if (this.summaryTurns.get(projectId) !== turn)
      return this.cachedSessions(projectId) ?? value;
    // Sync can discover a new conversation while the full list is in flight.
    // Keep those newer rows without losing the rest of the project's history.
    const merged = new Map(value.map((item) => [item.id, item]));
    for (const item of this.cachedSessions(projectId) ?? []) {
      const listed = merged.get(item.id);
      if (knownById.get(item.id) !== item && (!listed || listed.revision < item.revision))
        merged.set(item.id, item);
    }
    const sessions = [...merged.values()];
    return this.rememberSummaries(projectId, sessions);
  }
  activity() {
    return this.rpc<HostSessionActivity>("sessions.activity");
  }
  async updateSession(
    projectId: string,
    sessionId: string,
    patch: MobileSessionPatch,
  ) {
    const epoch = this.cacheEpoch;
    const summary = await this.rpc<HostSessionSummary>("sessions.update", {
      projectId,
      sessionId,
      ...patch,
    });
    if (epoch !== this.cacheEpoch) throw new Error(translate("Host connection changed."));
    const sessions = this.cachedSessions(projectId);
    const current = sessions?.find((item) => item.id === sessionId);
    const latest = current && current.revision > summary.revision ? current : summary;
    this.nextSummaryTurn(projectId);
    if (sessions) this.rememberSummaries(projectId, [
      ...sessions.filter((item) => item.id !== sessionId), latest,
    ]);
    return latest;
  }
  /** Returns the last catalog even after it expires so a new conversation can
   * render its Agent and model lists immediately while `models` refreshes. */
  cachedModels(projectId?: string): HostModelCatalog | undefined {
    if (!this.cacheReadable()) return undefined;
    const key = JSON.stringify(projectId ?? null), queryKey = this.modelQueryKey(key);
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    if (!query?.state.data) return undefined;
    query.setOptions({ ...query.options, meta: { ...query.meta, visited: ++this.catalogVisit } });
    this.queueOffline({ kind: "models", id: key });
    return query.state.data as HostModelCatalog;
  }
  models(projectId?: string, refresh = false, onUpdate?: (catalog: HostModelCatalog) => void) {
    const key = JSON.stringify(projectId ?? null), queryKey = this.modelQueryKey(key);
    const cached = this.cachedModels(projectId);
    if (cached) onUpdate?.(cached);
    const ttl = cached?.pending?.length ? 0 : cached && Object.keys(cached.errors).length ? 15_000 : 5 * 60_000;
    const epoch = this.cacheEpoch;
    let latest = cached;
    const stop = onUpdate ? queryClient.getQueryCache().subscribe(event => {
      if (event.type !== "updated" || JSON.stringify(event.query.queryKey) !== JSON.stringify(queryKey)) return;
      const value = event.query.state.data as HostModelCatalog | undefined;
      if (value && value !== latest) { latest = value; onUpdate(value); }
    }) : undefined;
    return queryClient.fetchQuery({
      queryKey, staleTime: refresh ? 0 : ttl, structuralSharing: false, meta: { visited: ++this.catalogVisit },
      queryFn: ({ signal }) => new ModelCatalogLoad(async params => {
        signal.throwIfAborted();
        if (epoch !== this.cacheEpoch) throw new Error(translate("Host connection changed."));
        const value = await this.rpc<HostModelCatalog>("models.list", { ...(projectId === undefined ? {} : { projectId }), ...params });
        signal.throwIfAborted();
        if (epoch !== this.cacheEpoch) throw new Error(translate("Host connection changed."));
        return value;
      }, value => {
        queryClient.setQueryData(queryKey, value);
        this.queueOffline({ kind: "models", id: key, value });
        this.trimModelQueries();
      }).promise,
    }).catch(error => {
      if (epoch !== this.cacheEpoch) throw new Error(translate("Host connection changed."));
      throw error;
    }).finally(() => { stop?.(); this.trimModelQueries(); });
  }
  async providerAccounts(): Promise<HostProviderAccounts | null> {
    const epoch = this.cacheEpoch;
    let result: HostProviderAccounts | null;
    try {
      result = await this.rpc<HostProviderAccounts>("providerAccounts.list");
    } catch (error) {
      if (!(error instanceof HostRequestError && error.status === 400 && error.message === "Unsupported host method"))
        throw error;
      result = null;
    }
    if (epoch !== this.cacheEpoch) throw new Error(translate("Host connection changed."));
    return result;
  }
  async providerAccountUsage(params: HostProviderUsageRequest): Promise<HostProviderUsage | null> {
    if (!this.hasCapability("providerAccounts.usage.v1")) return null;
    const epoch = this.cacheEpoch;
    let result: HostProviderUsage | null;
    try {
      result = await this.rpc<HostProviderUsage>("providerAccounts.usage", params);
    } catch (error) {
      if (!(error instanceof HostRequestError && error.status === 400 && error.message === "Unsupported host method"))
        throw error;
      result = null;
    }
    if (epoch !== this.cacheEpoch) throw new Error(translate("Host connection changed."));
    return result;
  }
  skills(projectId: string, harness: string, sessionId?: string, refresh = false) {
    return this.rpc<HostSkillCatalog>("skills.list", { projectId, harness,
      ...(sessionId ? { sessionId } : {}), ...(refresh ? { refresh: true } : {}) });
  }

  async readBinaryFile(path: string, projectId?: string): Promise<Uint8Array> {
    const base64 = await this.rpc<string>("workspace.run", {
      ...(projectId ? { projectId } : {}),
      command: "read_binary_file",
      args: { path },
    });
    return Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
  }

  private async sync(
    connection: Connection,
    sessionId: string,
    revision?: number,
  ): Promise<SessionSync> {
    const sentAt = Date.now();
    const result = await this.requestWith<SessionSyncResponse>(connection, "sessions.sync", {
      sessionId,
      revision,
    });
    const clockOffsetMs = sessionClockOffset(result, sentAt, Date.now());
    if (result.kind !== "chunked") return { ...result, clockOffsetMs };
    if (
      !Number.isSafeInteger(result.length) ||
      result.length < 0 ||
      result.length > 64 * 1024 * 1024
    )
      throw new Error("Conversation is too large to load on this device.");
    let serialized = "";
    while (serialized.length < result.length) {
      const chunk = await this.requestWith<SessionSyncChunk>(connection, "sessions.syncChunk", {
        sessionId,
        transfer: result.transfer,
        offset: serialized.length,
      });
      if (!chunk.data || serialized.length + chunk.data.length > result.length)
        throw new Error("Incomplete conversation response.");
      serialized += chunk.data;
    }
    return { ...JSON.parse(serialized) as SessionSync, clockOffsetMs };
  }
  /** Whether an imported native conversation may be continued now; null for ordinary sessions. */
  async nativeAccess(sessionId: string): Promise<NativeSessionAccess | null> {
    const connection = this.connection;
    if (!connection) throw new Error("Connect to a Host first.");
    const epoch = this.cacheEpoch;
    const result = await this.requestWith<NativeSessionAccess | null>(connection, "sessions.nativeAccess", { sessionId });
    if (epoch !== this.cacheEpoch)
      throw new Error(translate("Host connection changed."));
    return result;
  }

  async session(sessionId: string, minimumRevision?: number): Promise<HostSession> {
    this.retainSessionPreviews(sessionId);
    const queryKey = this.dataKey("sessionRead", sessionId);
    const current = queryClient.getQueryCache().find({ queryKey, exact: true });
    if (current?.state.fetchStatus === "fetching") {
      const result = await current.promise as HostSession;
      return minimumRevision !== undefined && result.revision < minimumRevision ? this.session(sessionId, minimumRevision) : result;
    }
    const connection = this.connection;
    if (!connection) throw new Error("Connect to a Host first.");
    const epoch = this.cacheEpoch, known = this.cachedSession(sessionId);
    return this.readQuery(queryKey, async () => {
      const sync = await this.sync(connection, sessionId, known?.revision);
      let result: HostSession;
      try { result = applySessionSync(known, sync); }
      catch { result = applySessionSync(undefined, await this.sync(connection, sessionId)); }
      if (epoch !== this.cacheEpoch) throw new Error(translate("Conversation request is no longer current."));
      if (result.session.id !== sessionId) throw new Error(translate("Host returned a different conversation."));
      return this.rememberSession(reuseRemoteAttachmentPreviews(result, this.peekSnapshot(sessionId)));
    }).catch(error => {
      if (epoch !== this.cacheEpoch) throw new Error(translate("Conversation request is no longer current."));
      throw error;
    });
  }

  async sessionPreviews(sessionId: string): Promise<HostSession | undefined> {
    const known = this.peekSnapshot(sessionId), connection = this.connection;
    if (!known || !connection || !this.previewSessions.has(sessionId) || ![...walkTranscript(known.session.blocks)].some(block =>
      block.attachments?.some(file => file.kind === "image" && file.data === undefined && !file.previewUrl && file.size <= MOBILE_ATTACHMENT_BYTES))) return known;
    const epoch = this.cacheEpoch;
    const value = await queryClient.fetchQuery({ queryKey: this.dataKey("previewRead", sessionId), gcTime: 0, structuralSharing: false, queryFn: async ({ signal }) => {
      const hydrated = await withRemoteAttachmentPreviews(connection.environmentId, known, known,
        params => this.requestWith(connection, "attachments.read", params));
      const current = this.peekSnapshot(sessionId);
      signal.throwIfAborted();
      if (!current || epoch !== this.cacheEpoch) return null;
      return this.rememberSession(reuseRemoteAttachmentPreviews(current, hydrated));
    } }).catch(() => null);
    return value ?? undefined;
  }
  /**
   * The journal only changes through this client, so one Keystore read serves
   * every later poll instead of a native decrypt on each 250ms session sync.
   */
  private pendingValue: Promise<string | null> | undefined;
  async pending(): Promise<PendingCommand | undefined> {
    const read = (this.pendingValue ??= this.storage.get("pending"));
    let value: string | null;
    try {
      value = await read;
    } catch (error) {
      if (this.pendingValue === read) this.pendingValue = undefined;
      throw error;
    }
    if (!value) return undefined;
    const pending = JSON.parse(value) as PendingCommand;
    return { ...pending, command: migrateSavedHostCommand(pending.command) };
  }
  private async writePending(value: string | null) {
    this.pendingValue = undefined;
    if (value === null) await this.storage.remove("pending");
    else await this.storage.set("pending", value);
    // A failed write leaves the cache empty, so the next read asks storage.
    this.pendingValue = Promise.resolve(value);
  }
  async uploadAttachments(
    files: Attachment[],
    accepted: Attachment[] = [],
  ): Promise<RemoteAttachment[]> {
    const reusable = (file: Attachment) =>
      accepted.some(
        (known) =>
          known.id === file.id &&
          known.name === file.name &&
          known.size === file.size &&
          known.kind === file.kind &&
          known.mimeType === file.mimeType,
      );
    if (files.length > MOBILE_ATTACHMENT_LIMIT)
      throw new Error("Attach up to 20 files per message.");
    if (
      files.some(
        (file) =>
          file.size > MOBILE_ATTACHMENT_BYTES ||
          (file.data === undefined && !reusable(file)),
      )
    )
      throw new Error("Each attachment must be readable and 20 MB or smaller.");
    const uploaded: RemoteAttachment[] = [];
    const chunkChars = 4 * Math.floor((512 * 1024) / 3);
    for (const file of files) {
      if (reusable(file)) {
        const { id, name, mimeType, kind, size } = file;
        uploaded.push({ id, name, mimeType, kind, size });
        continue;
      }
      const data = file.data!;
      let offset = 0;
      // Empty files still need a file created on the Host.
      for (
        let index = 0;
        index < data.length || (index === 0 && !data.length);
        index += chunkChars
      ) {
        const chunk = data.slice(index, index + chunkChars);
        const expected =
          offset +
          Math.floor(chunk.length / 4) * 3 -
          (chunk.endsWith("==") ? 2 : chunk.endsWith("=") ? 1 : 0);
        let response: { offset: number };
        try {
          response = await this.rpc("attachments.upload", {
            id: file.id,
            offset,
            size: file.size,
            data: chunk,
          });
        } catch (error) {
          if (error instanceof HostRequestError) throw error;
          // The Host's offset protocol makes retrying a lost chunk receipt safe.
          response = await this.rpc("attachments.upload", {
            id: file.id,
            offset,
            size: file.size,
            data: chunk,
          });
        }
        if (response.offset !== expected)
          throw new Error("Attachment upload was interrupted. Please retry.");
        offset = response.offset;
      }
      if (offset !== file.size)
        throw new Error("Attachment upload was interrupted. Please retry.");
      const { id, name, mimeType, kind, size } = file;
      uploaded.push({ id, name, mimeType, kind, size });
    }
    return uploaded;
  }
  async dispatch(
    command: HostCommand,
    followup?: string | MobileFirstMessage,
  ): Promise<CommandReceipt> {
    if (!this.connection) throw new Error("Connect to a Host first.");
    if (this.dispatching) throw new Error("A request is already being sent.");
    this.dispatching = true;
    try {
      if (await this.pending())
        throw new Error(
          "Resolve the pending request before sending another message.",
        );
      const { endpoint, environmentId } = this.connection;
      await this.writePending(
        JSON.stringify({
          endpoint,
          environmentId,
          command,
          followup,
        } satisfies PendingCommand),
      );
      return await this.flushPending();
    } finally {
      this.dispatching = false;
    }
  }
  async retryPending(): Promise<CommandReceipt> {
    if (this.dispatching) throw new Error("A request is already being sent.");
    this.dispatching = true;
    try {
      return await this.flushPending();
    } finally {
      this.dispatching = false;
    }
  }
  private async flushPending(): Promise<CommandReceipt> {
    try {
      let pending = await this.pending();
      if (!pending || !this.connection) throw new Error("No pending request.");
      if (
        pending.environmentId !== this.connection.environmentId ||
        pending.endpoint !== this.connection.endpoint
      )
        throw new Error("The pending request belongs to another Host.");
      let receipt = await this.rpc<CommandReceipt>(
        "commands.dispatch",
        pending.command,
      );
      if (pending.command.type === "create" && pending.followup) {
        // Persist the receipt-derived send before dispatch. A lost response or
        // app restart retries the exact command id, including the first turn.
        pending = {
          ...pending,
          followup: undefined,
          command: {
            ...(typeof pending.followup === "string"
              ? { text: pending.followup }
              : pending.followup),
            type: "send",
            commandId: crypto.randomUUID(),
            sessionId: receipt.sessionId,
          },
        };
        await this.writePending(JSON.stringify(pending));
        receipt = await this.rpc<CommandReceipt>(
          "commands.dispatch",
          pending.command,
        );
      }
      await this.writePending(null);
      return receipt;
    } catch (error) {
      // A Host 400 is a definitive command rejection. Transport failures remain
      // journaled so a retry can ask for the same receipt instead of resending.
      if (error instanceof HostRequestError && error.status === 400)
        await this.writePending(null);
      throw error;
    }
  }
}
