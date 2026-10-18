import { invoke } from "@tauri-apps/api/core";
import type { HostDescriptor, HostProject } from "./protocol";
import {
  configureSharedHost, ensureSharedProject, parseRemotePath, remotePath,
  remoteProjectFor, rememberRemoteProject, sharedHostEnvironment,
  sharedHostMachineId, sharedProjects,
} from "./remoteProjects";
import {
  rememberRemoteSession, remoteRequest, remoteSessionFor, remoteSessionScopeFor,
} from "./connections";
import { parseWorkspaceSnapshot, type WorkspaceSnapshot } from "../../workspace/model/workspaceSnapshot";
import { translate } from "../../../shared/i18n/language";
import { hostStateTransportUnavailable } from "./hostStateOffline";

export type HostStateRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
export type WorkspaceRecord = {
  revision: number;
  windowId: string;
  kind: "desktop" | "mobile";
  snapshot: unknown;
  updatedAt: number;
};
export type WorkspaceLocation = { environmentId: string; projectId: string; sessionId?: string };
type ProjectReference = { environmentId: string; projectId: string; cwd: string; machine?: HostProject["machine"] };
type SharedWorkspace = {
  version: 1;
  workspace: WorkspaceSnapshot;
  projects: ProjectReference[];
  bindings: { shellId: string; sessionId: string; environmentId: string; projectId: string }[];
  location?: WorkspaceLocation;
};
type PendingWorkspace = {
  operationId: string;
  windowId: string;
  kind: "desktop" | "mobile";
  snapshot: unknown;
  activate: boolean;
  importRelease?: boolean;
};

/** Host-scoped, durable write-ahead cache. A retry keeps the same operation ID. */
export class HostWorkspaceJournal {
  private serial: Promise<unknown> = Promise.resolve();
  private readonly prefix: string;
  constructor(
    readonly environmentId: string,
    readonly windowId: string,
    readonly kind: "desktop" | "mobile",
    private readonly request: HostStateRequest,
    private readonly storage: Storage,
  ) {
    this.prefix = `monocode.host-workspace.v1:${encodeURIComponent(environmentId)}:`;
  }

  get pending(): boolean {
    return this.pendingKeys().length > 0;
  }

  private pendingKeys(): string[] {
    return Array.from({ length: this.storage.length }, (_, i) => this.storage.key(i))
      .filter((key): key is string => !!key?.startsWith(`${this.prefix}pending:`));
  }

  async read(): Promise<WorkspaceRecord | null> {
    try {
      const value = await this.request<WorkspaceRecord | null>("workspaces.read", { kind: this.kind });
      this.storage.setItem(`${this.prefix}cache:${this.kind}`, JSON.stringify(value));
      return value;
    } catch (error) {
      if (!hostStateTransportUnavailable(error)) throw error;
      const cached = this.storage.getItem(`${this.prefix}cache:${this.kind}`);
      let restored = cached !== null ? JSON.parse(cached) as WorkspaceRecord | null : null;
      for (const key of this.pendingKeys()) {
        const pending = JSON.parse(this.storage.getItem(key)!) as PendingWorkspace;
        if (pending.kind !== this.kind) continue;
        if (pending.activate || !restored || restored.windowId === pending.windowId)
          restored = { revision: -1, windowId: pending.windowId, kind: pending.kind, snapshot: pending.snapshot, updatedAt: 0 };
      }
      if (restored || cached !== null) return restored;
      throw error;
    }
  }

  async save(snapshot: unknown, activate: boolean, importRelease = false): Promise<void> {
    const pending: PendingWorkspace = {
      operationId: crypto.randomUUID(), windowId: this.windowId, kind: this.kind,
      snapshot, activate, ...(importRelease ? { importRelease: true } : {}),
    };
    // Keep each write separate: another window can be replaying an earlier one.
    this.storage.setItem(`${this.prefix}pending:${pending.operationId}`, JSON.stringify(pending));
    await this.flush().catch(() => undefined);
  }

  flush(): Promise<void> {
    const run = this.serial.catch(() => undefined).then(async () => {
      for (const key of this.pendingKeys()) {
        const raw = this.storage.getItem(key);
        if (!raw) continue;
        const pending = JSON.parse(raw) as PendingWorkspace;
        const result = await this.request<WorkspaceRecord>("workspaces.save", { ...pending });
        const previous = JSON.parse(this.storage.getItem(`${this.prefix}cache:${pending.kind}`) ?? "null") as WorkspaceRecord | null;
        if ((!previous || pending.activate || previous.windowId === pending.windowId) && (!previous || result.revision >= previous.revision))
          this.storage.setItem(`${this.prefix}cache:${pending.kind}`, JSON.stringify(result));
        // Never remove a newer write or another window's new operation.
        if (this.storage.getItem(key) === raw) this.storage.removeItem(key);
      }
    });
    this.serial = run;
    return run;
  }
}

const pathFields = new Set(["cwd", "projectCwd", "projectPath", "path", "executionCwd"]);
function mapPaths(value: unknown, convert: (path: string, owner?: string) => string, key = "", owner?: string): unknown {
  if (typeof value === "string") return pathFields.has(key) ? convert(value, owner) : value;
  if (Array.isArray(value)) return value.map((item) => mapPaths(item, convert, "", owner));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const ownerPath = typeof record.projectCwd === "string" ? record.projectCwd
    : typeof record.cwd === "string" ? record.cwd : typeof record.projectPath === "string" ? record.projectPath : undefined;
  const environmentId = ownerPath ? parseRemotePath(ownerPath)?.environmentId : owner;
  // Migrate old saved resource keys before converting local/remote path identities.
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== "worktreeCwd" || record.executionCwd === undefined).map(([oldName, entry]) => {
    const name = oldName === "worktreeCwd" ? "executionCwd" : oldName;
    return [name,
      name === "path" && record.terminal === true ? entry : mapPaths(entry, convert, name, environmentId)];
  }));
}

/** Persist resource identities, not the sender's local/remote addressing choice. */
export async function encodeHostWorkspace(snapshot: WorkspaceSnapshot): Promise<SharedWorkspace> {
  const environmentId = sharedHostEnvironment();
  if (!environmentId) throw new Error("Shared conversation service is not connected");
  const paths = new Set([snapshot.projectCwd, ...snapshot.sessions.map((entry) => entry.cwd)]);
  const projects: ProjectReference[] = [];
  for (const cwd of paths) {
    let project = remoteProjectFor(cwd);
    if (project?.local && !project.projectId) project = await ensureSharedProject(cwd);
    if (project?.projectId && !projects.some((entry) => entry.environmentId === project.environmentId && entry.projectId === project.projectId))
      projects.push({ environmentId: project.environmentId, projectId: project.projectId, cwd: project.cwd,
        ...(project.machine ? { machine: project.machine } : {}) });
  }
  const bindings = snapshot.sessions.flatMap((stub) => {
    const project = remoteProjectFor(stub.cwd);
    const sessionId = remoteSessionFor(stub.id);
    const scope = remoteSessionScopeFor(stub.id) ?? project;
    return sessionId && scope?.projectId
      ? [{ shellId: stub.id, sessionId, environmentId: scope.environmentId, projectId: scope.projectId }]
      : [];
  });
  const workspace = mapPaths(snapshot, (path, owner) => {
    if (!path || path === "~" || parseRemotePath(path) || !/^(\/|[A-Za-z]:[\\/])/.test(path)) return path;
    return remotePath(owner ?? environmentId, path);
  }) as WorkspaceSnapshot;
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  const activeBinding = bindings.find((binding) => binding.shellId === active?.focusedId);
  const project = remoteProjectFor(snapshot.projectCwd);
  return {
    version: 1, workspace, projects, bindings,
    ...(project?.projectId ? { location: {
      environmentId: project.environmentId, projectId: project.projectId,
      ...(activeBinding ? { sessionId: activeBinding.sessionId } : {}),
    } } : {}),
  };
}

export function decodeHostWorkspace(raw: unknown): WorkspaceSnapshot | null {
  const value = raw as Partial<SharedWorkspace> | null;
  if (!value || value.version !== 1 || !Array.isArray(value.projects) || !Array.isArray(value.bindings)) return null;
  const environmentId = sharedHostEnvironment();
  const localProjects = sharedProjects().map((project): HostProject => ({ id: project.projectId, cwd: project.cwd, name: project.cwd,
    ...(project.machine ? { machine: project.machine } : {}) }));
  for (const project of value.projects) {
    if (!project || typeof project.environmentId !== "string" || typeof project.projectId !== "string" || typeof project.cwd !== "string") continue;
    const entry = { id: project.projectId, cwd: project.cwd, name: project.cwd,
      ...(project.machine ? { machine: project.machine } : {}) };
    if (project.environmentId === environmentId) {
      if (!localProjects.some((known) => known.id === entry.id)) localProjects.push(entry);
    } else rememberRemoteProject(project.environmentId, entry);
  }
  if (environmentId) configureSharedHost(environmentId, localProjects, sharedHostMachineId());
  for (const binding of value.bindings) {
    if (binding && [binding.shellId, binding.sessionId, binding.environmentId, binding.projectId].every((entry) => typeof entry === "string" && !!entry))
      rememberRemoteSession(binding.shellId, binding.sessionId, binding);
  }
  const snapshot = parseWorkspaceSnapshot(mapPaths(value.workspace, (path) => {
    const remote = parseRemotePath(path);
    return remote && !remote.machine && remote.environmentId === environmentId ? remote.hostPath : path;
  }));
  if (!snapshot) return null;
  // Terminal IDs address a window-owned PTY. Restore its configuration with a new ID.
  for (const pane of [...snapshot.tabs.flatMap((tab) => [...tab.editorPanes, ...(tab.terminalPanes ?? [])]), ...snapshot.projectTerminals.map((dock) => dock.pane)]) {
    for (const file of pane.files) if (file.terminal) {
      const previous = file.id;
      file.id = crypto.randomUUID();
      if (pane.activeFileId === previous) pane.activeFileId = file.id;
    }
  }
  return snapshot;
}

export function mobileWorkspaceLocation(record: WorkspaceRecord | null, environmentId: string): WorkspaceLocation | undefined {
  const value = record?.snapshot as { location?: WorkspaceLocation } | null;
  const location = value?.location;
  if (location?.environmentId !== environmentId || typeof location.projectId !== "string") return;
  return { environmentId, projectId: location.projectId,
    ...(typeof location.sessionId === "string" ? { sessionId: location.sessionId } : {}) };
}

let desktop: HostWorkspaceJournal | undefined;
let lastSnapshot: SharedWorkspace | undefined;
let activeSinceSave = false;
let activityTimer: ReturnType<typeof setTimeout> | undefined;
let disposeDesktop: (() => void) | undefined;
export const HOST_WORKSPACE_STATUS = "monocode:host-workspace-status";
const notify = () => window.dispatchEvent(new Event(HOST_WORKSPACE_STATUS));
export const hostWorkspacePending = () => desktop?.pending ?? false;

export function stopHostWorkspaces(): void {
  disposeDesktop?.();
  disposeDesktop = undefined;
  clearTimeout(activityTimer);
  desktop = undefined;
  lastSnapshot = undefined;
  activeSinceSave = false;
}

/** Called before workspace bootstrap. Live windows never subscribe to snapshots. */
export async function initializeHostWorkspaces(): Promise<void> {
  stopHostWorkspaces();
  const environmentId = sharedHostEnvironment();
  const machineId = sharedHostMachineId();
  if (!environmentId || !machineId) return;
  try {
    const descriptor = await remoteRequest<HostDescriptor>(machineId, "environment.describe");
    if (descriptor.environmentId !== environmentId) throw new Error("Host identity changed");
    if (!descriptor.capabilities?.includes("workspaces.read")) throw new Error(translate("Update Host to share workspace state."));
  } catch (error) {
    const cached = localStorage.getItem(`monocode.host-workspace.v1:${encodeURIComponent(environmentId)}:cache:desktop`);
    if (!cached || !hostStateTransportUnavailable(error)) throw error;
  }
  desktop = new HostWorkspaceJournal(environmentId, crypto.randomUUID(), "desktop",
    (method, params) => remoteRequest(machineId, method, params), localStorage);
  const activity = () => {
    activeSinceSave = true;
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
      if (!lastSnapshot || !desktop || !activeSinceSave) return;
      activeSinceSave = false;
      void desktop.save(lastSnapshot, true).catch(() => undefined).finally(notify);
    }, 300);
  };
  window.addEventListener("pointerdown", activity, { passive: true });
  window.addEventListener("keydown", activity);
  window.addEventListener("focus", activity);
  const retry = () => { void desktop?.flush().catch(() => undefined).finally(notify); };
  window.addEventListener("online", retry);
  window.addEventListener("focus", retry);
  const timer = setInterval(retry, 2_000);
  disposeDesktop = () => {
    clearInterval(timer);
    window.removeEventListener("pointerdown", activity);
    window.removeEventListener("keydown", activity);
    window.removeEventListener("focus", activity);
    window.removeEventListener("online", retry);
    window.removeEventListener("focus", retry);
  };
  await desktop.flush().catch(() => undefined);
}

/** Returns undefined only before Host bootstrap (legacy tests/auxiliary windows). */
export async function loadHostWorkspace(): Promise<unknown | null | undefined> {
  if (!desktop) return undefined;
  const record = await desktop.read();
  if (record) return decodeHostWorkspace(record.snapshot);
  if (import.meta.env.DEV) return null;
  const legacy = parseWorkspaceSnapshot(await invoke("workspace_get_snapshot"));
  if (!legacy) return null;
  const shared = await encodeHostWorkspace(legacy);
  await desktop.save(shared, true, true);
  const imported = await desktop.read();
  return imported ? decodeHostWorkspace(imported.snapshot) : null;
}

export async function saveHostWorkspace(snapshot: unknown): Promise<boolean> {
  if (!desktop) return false;
  const parsed = parseWorkspaceSnapshot(snapshot);
  if (!parsed) return true;
  lastSnapshot = await encodeHostWorkspace(parsed);
  const activate = activeSinceSave;
  activeSinceSave = false;
  // A durable local write is success while offline; the status stays pending.
  const saved = desktop.save(lastSnapshot, activate);
  notify();
  await saved;
  notify();
  return true;
}
