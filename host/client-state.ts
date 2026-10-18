import { createHash } from "node:crypto";
import type { HostStore } from "./store";
import type { HostConnectionDefinition, HostConnections, HostEnvironmentDefinition, HostEnvironments, HostPreferences, HostStateValue, HostWorkspace, HostWorkspaceKind } from "../src/features/connections/model/hostState";
import { parseProjectMachine, type ProjectMachine } from "../src/integrations/harness/core/machine";
import { isSharedPreferenceKey, validateSharedPreferenceValue } from "../src/features/settings/model/sharedPreferenceSchema";

const MAX_PREFERENCES_BYTES = 2 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)
    || value === "__proto__" || value === "constructor" || value === "prototype") throw new Error(`Invalid ${label}`);
  return value;
}

function json(value: unknown, maxBytes: number): HostStateValue {
  const visit = (part: unknown, depth: number): boolean => {
    if (depth > 64) return false;
    if (part === null || typeof part === "string" || typeof part === "boolean") return true;
    if (typeof part === "number") return Number.isFinite(part);
    if (Array.isArray(part)) return part.every((entry) => visit(entry, depth + 1));
    return object(part) && Object.entries(part).every(([key, entry]) =>
      key !== "__proto__" && key !== "constructor" && key !== "prototype" && visit(entry, depth + 1));
  };
  if (!visit(value, 0)) throw new Error("Invalid JSON state");
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maxBytes) throw new Error("Shared state is too large");
  return JSON.parse(text) as HostStateValue;
}

function revision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < -1) throw new Error("Invalid state revision");
  return Number(value);
}

function kind(value: unknown): HostWorkspaceKind {
  if (value !== "desktop" && value !== "mobile") throw new Error("Invalid workspace kind");
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function connection(id: string, input: unknown): HostConnectionDefinition {
  if (!object(input) || input.id !== id || typeof input.name !== "string" || !input.name.trim() || input.name.length > 200
    || (input.kind !== "http" && input.kind !== "ssh")) throw new Error("Invalid connection definition");
  const allowed = new Set(["id", "name", "kind", "environmentId", "hostname", "port"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Connection definitions cannot contain device credentials or endpoints");
  if (input.environmentId !== undefined) identity(input.environmentId, "connection Host identity");
  if (input.hostname !== undefined && (typeof input.hostname !== "string" || !input.hostname.trim() || input.hostname.length > 255
    || /[\s/@?#\\]/.test(input.hostname))) throw new Error("Invalid connection hostname");
  if (input.port !== undefined && (!Number.isInteger(input.port) || Number(input.port) < 1 || Number(input.port) > 65535)) throw new Error("Invalid connection port");
  return json(input, 2048) as HostConnectionDefinition;
}

const MAX_ENVIRONMENT_BYTES = 256 * 1024;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function environment(id: string, input: unknown): HostEnvironmentDefinition {
  if (!object(input) || input.id !== id || typeof input.name !== "string" || !input.name.trim() || input.name.length > 200
    || !Array.isArray(input.folders) || input.folders.length > 32 || !object(input.variables))
    throw new Error("Invalid environment definition");
  const allowed = new Set(["id", "name", "machine", "folders", "variables"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Invalid environment definition");
  const machine = input.machine === undefined ? undefined : parseProjectMachine(input.machine);
  const folders = input.folders.map((folder) => {
    if (typeof folder !== "string" || !folder.trim() || folder.length > 4096 || folder.includes("\0")
      || (machine ? !folder.startsWith("/") : !/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(folder)))
      throw new Error("Environment folders must be absolute paths on its machine");
    return folder;
  });
  const variables: Record<string, string> = {};
  const entries = Object.entries(input.variables);
  if (entries.length > 256) throw new Error("Too many environment variables");
  for (const [name, value] of entries) {
    if (!VARIABLE_NAME.test(name) || /^MONOCODE_/i.test(name)) throw new Error(`Invalid environment variable name: ${name}`);
    if (typeof value !== "string" || value.length > 32_768 || value.includes("\0")) throw new Error(`Invalid value for ${name}`);
    variables[name] = value;
  }
  return json({ id, name: input.name.trim(), ...(machine ? { machine } : {}), folders, variables }, MAX_ENVIRONMENT_BYTES) as HostEnvironmentDefinition;
}

/** Folder containment on the environment's own machine. Windows paths compare
 * case-insensitively with either separator; WSL paths are POSIX. */
function folderDepth(folder: string, cwd: string, posix: boolean): number {
  const normalize = (path: string) => {
    let value = posix ? path : path.replace(/\//g, "\\").toLowerCase();
    const sep = posix ? "/" : "\\";
    while (value.length > 1 && value.endsWith(sep) && !/^[a-z]:\\$/.test(value)) value = value.slice(0, -1);
    return value;
  };
  const root = normalize(folder);
  const path = normalize(cwd);
  const sep = posix ? "/" : "\\";
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep) ? root.length : -1;
}

/** Transactional shared client state. Receipt payloads survive both retries and Host restarts. */
export class HostClientState {
  constructor(private readonly store: HostStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS client_state (name TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS client_state_receipts (operation_id TEXT PRIMARY KEY, signature TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS client_workspaces (kind TEXT NOT NULL, window_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(kind, window_id));
    `);
  }

  private read<T>(name: string, fallback: T): { revision: number; value: T } {
    const row = this.store.db.prepare("SELECT revision,value FROM client_state WHERE name=?").get(name);
    return row ? { revision: Number(row.revision), value: JSON.parse(String(row.value)) as T } : { revision: 0, value: fallback };
  }

  private write(name: string, currentRevision: number, value: unknown): number {
    const next = currentRevision + 1;
    this.store.db.prepare("INSERT INTO client_state(name,revision,value) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,value=excluded.value")
      .run(name, next, JSON.stringify(value));
    return next;
  }

  private mutate<T>(method: string, params: Record<string, unknown>, action: () => T): T {
    const operationId = identity(params.operationId, "state operation ID");
    const signature = createHash("sha256").update(method).update(canonical(params)).digest("hex");
    return this.store.transaction(() => {
      const receipt = this.store.db.prepare("SELECT signature,result FROM client_state_receipts WHERE operation_id=?").get(operationId);
      if (receipt) {
        if (receipt.signature !== signature) throw new Error("State operation ID was already used for a different operation");
        return JSON.parse(String(receipt.result)) as T;
      }
      const result = action();
      this.store.db.prepare("INSERT INTO client_state_receipts(operation_id,signature,result) VALUES (?,?,?)")
        .run(operationId, signature, JSON.stringify(result));
      return result;
    });
  }

  preferencesRead(params: Record<string, unknown> = {}): HostPreferences | null {
    const current = this.read("preferences", { values: {} as Record<string, HostStateValue>, imported: false });
    if (revision(params.revision) === current.revision) return null;
    return { revision: current.revision, ...current.value };
  }

  preferencesPatch(params: Record<string, unknown>): HostPreferences {
    if (!object(params.changes) || Object.keys(params.changes).length > 2048) throw new Error("Invalid preference changes");
    if (params.importRelease !== undefined && typeof params.importRelease !== "boolean") throw new Error("Invalid release import flag");
    const changes = json(params.changes, MAX_PREFERENCES_BYTES) as Record<string, HostStateValue>;
    for (const [key, value] of Object.entries(changes)) {
      if (!isSharedPreferenceKey(key) || (value !== null && !validateSharedPreferenceValue(key, value))) throw new Error(`Invalid shared preference: ${key}`);
    }
    return this.mutate("preferences.patch", params, () => {
      const current = this.preferencesRead()!;
      if (params.importRelease && current.imported) return current;
      const values = { ...current.values };
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete values[key];
        else values[key] = value;
      }
      json(values, MAX_PREFERENCES_BYTES);
      const imported = current.imported || params.importRelease === true;
      return { revision: this.write("preferences", current.revision, { values, imported }), values, imported };
    });
  }

  workspacesRead(params: Record<string, unknown>): HostWorkspace | null {
    const workspaceKind = kind(params.kind);
    const windowId = params.windowId === undefined ? undefined : identity(params.windowId, "window ID");
    const active = this.read("workspace:activation", { kind: "desktop" });
    if (workspaceKind === "mobile" && !windowId && active.value.kind === "desktop") return this.workspacesRead({ kind: "desktop" });
    const latest = this.read(`workspace:${workspaceKind}`, { windowId: "" });
    const row = windowId || latest.value.windowId
      ? this.store.db.prepare("SELECT * FROM client_workspaces WHERE kind=? AND window_id=?").get(workspaceKind, windowId ?? latest.value.windowId)
      : undefined;
    // A phone projects the latest desktop snapshot to project/session selection.
    if (!row && workspaceKind === "mobile" && !windowId) return this.workspacesRead({ kind: "desktop" });
    return row ? {
      revision: Number(row.revision), windowId: String(row.window_id), kind: workspaceKind,
      snapshot: JSON.parse(String(row.snapshot)) as HostStateValue, updatedAt: Number(row.updated_at),
    } : null;
  }

  workspacesSave(params: Record<string, unknown>): HostWorkspace {
    const workspaceKind = kind(params.kind);
    const windowId = identity(params.windowId, "window ID");
    if (!object(params.snapshot)) throw new Error("Invalid workspace snapshot");
    if (params.activate !== undefined && typeof params.activate !== "boolean") throw new Error("Invalid workspace activation flag");
    if (params.importRelease !== undefined && typeof params.importRelease !== "boolean") throw new Error("Invalid release import flag");
    const snapshot = json(params.snapshot, MAX_WORKSPACE_BYTES);
    return this.mutate("workspaces.save", params, () => {
      const current = this.read(`workspace:${workspaceKind}`, { windowId: "" });
      if (params.importRelease && current.revision) return this.workspacesRead({ kind: workspaceKind })!;
      const next = this.write(`workspace:${workspaceKind}`, current.revision, { windowId: params.activate === false && current.value.windowId ? current.value.windowId : windowId });
      const active = this.read("workspace:activation", { kind: workspaceKind });
      if (params.activate !== false || !active.revision) this.write("workspace:activation", active.revision, { kind: workspaceKind });
      const updatedAt = Date.now();
      this.store.db.prepare("INSERT INTO client_workspaces(kind,window_id,revision,snapshot,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(kind,window_id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot,updated_at=excluded.updated_at")
        .run(workspaceKind, windowId, next, JSON.stringify(snapshot), updatedAt);
      return { revision: next, windowId, kind: workspaceKind, snapshot, updatedAt };
    });
  }

  connectionsList(params: Record<string, unknown> = {}): HostConnections | null {
    const current = this.read("connections", {} as Record<string, HostConnectionDefinition>);
    if (revision(params.revision) === current.revision) return null;
    return { revision: current.revision, connections: Object.values(current.value).sort((a, b) => a.id.localeCompare(b.id)) };
  }

  connectionsPatch(params: Record<string, unknown>): HostConnections {
    if (!object(params.changes) || Object.keys(params.changes).length > 256) throw new Error("Invalid connection changes");
    if (params.importRelease !== undefined && typeof params.importRelease !== "boolean") throw new Error("Invalid release import flag");
    const changes = Object.fromEntries(Object.entries(params.changes).map(([id, value]) => [identity(id, "connection ID"), value === null ? null : connection(id, value)]));
    return this.mutate("connections.patch", params, () => {
      const current = this.read("connections", {} as Record<string, HostConnectionDefinition>);
      if (params.importRelease && this.read("connections:imported", false).value) return this.connectionsList()!;
      for (const [id, value] of Object.entries(changes)) {
        if (value === null) delete current.value[id];
        else current.value[id] = value;
      }
      if (Object.keys(current.value).length > 256) throw new Error("Too many shared connections");
      this.write("connections", current.revision, current.value);
      if (params.importRelease) this.write("connections:imported", 0, true);
      return this.connectionsList()!;
    });
  }

  environmentsList(params: Record<string, unknown> = {}): HostEnvironments | null {
    const current = this.read("environments", {} as Record<string, HostEnvironmentDefinition>);
    if (revision(params.revision) === current.revision) return null;
    return { revision: current.revision, environments: Object.values(current.value).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };
  }

  environmentsPatch(params: Record<string, unknown>): HostEnvironments {
    if (!object(params.changes) || Object.keys(params.changes).length > 64) throw new Error("Invalid environment changes");
    const changes = Object.fromEntries(Object.entries(params.changes).map(([id, value]) => [identity(id, "environment ID"), value === null ? null : environment(id, value)]));
    return this.mutate("environments.patch", params, () => {
      const current = this.read("environments", {} as Record<string, HostEnvironmentDefinition>);
      for (const [id, value] of Object.entries(changes)) {
        if (value === null) delete current.value[id];
        else current.value[id] = value;
      }
      if (Object.keys(current.value).length > 128) throw new Error("Too many environments");
      this.write("environments", current.revision, current.value);
      return this.environmentsList()!;
    });
  }

  /** Variables of the environment whose folder most specifically contains `cwd`. */
  environmentVariables(cwd: string, machine?: ProjectMachine): Record<string, string> {
    let best: { depth: number; variables: Record<string, string> } | undefined;
    for (const entry of Object.values(this.read("environments", {} as Record<string, HostEnvironmentDefinition>).value)) {
      if ((entry.machine?.distribution ?? "") !== (machine?.distribution ?? "")) continue;
      for (const folder of entry.folders) {
        const depth = folderDepth(folder, cwd, !!machine || process.platform !== "win32");
        if (depth >= 0 && (!best || depth > best.depth)) best = { depth, variables: entry.variables };
      }
    }
    return { ...best?.variables };
  }
}
