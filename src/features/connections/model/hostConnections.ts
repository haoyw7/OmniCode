import { listDesktopConnections } from "../../../platform/tauri/connections";
import { useSyncExternalStore } from "react";
import { remoteRequest } from "./connections";
import { sharedHostEnvironment, sharedHostMachineId } from "./remoteProjects";
import type { HostConnectionDefinition, HostConnections } from "../../../contracts/hostState";
import type { HostDescriptor, RemoteMachine } from "../../../contracts/protocol";
import type { HostStateRequest } from "./hostWorkspace";
import { translate } from "../../../shared/i18n/language";
import { hostStateTransportUnavailable } from "./hostStateOffline";

export const HOST_CONNECTIONS_CHANGE = "omnicode:host-connections";
type PendingChange = { operationId: string; changes: Record<string, HostConnectionDefinition | null>; importRelease?: boolean };
export type HostConnectionDirectoryState = { connections: HostConnectionDefinition[]; pending: boolean; error: string };

/** Only public discovery metadata is portable; endpoints and credentials never enter it. */
export function connectionDefinition(machine: RemoteMachine): HostConnectionDefinition {
  let hostname: string | undefined;
  if (machine.ssh) hostname = machine.ssh.target.split("@").at(-1);
  else { try { hostname = new URL(machine.endpoint).hostname; } catch { /* Endpoint is device-local. */ } }
  return {
    id: machine.environmentId, environmentId: machine.environmentId,
    name: machine.name, kind: machine.ssh ? "ssh" : "http",
    ...(hostname ? { hostname } : {}),
    ...(machine.ssh?.port ? { port: machine.ssh.port } : {}),
  };
}

export class HostConnectionDirectory {
  private serial: Promise<unknown> = Promise.resolve();
  private value: HostConnections = { revision: 0, connections: [] };
  private prefix: string;
  constructor(
    readonly environmentId: string,
    private readonly request: HostStateRequest,
    private readonly storage: Storage,
  ) {
    this.prefix = `omnicode.host-connections.v1:${encodeURIComponent(environmentId)}:`;
    try {
      const cached = JSON.parse(storage.getItem(`${this.prefix}cache`) ?? "null");
      if (cached && Number.isSafeInteger(cached.revision) && Array.isArray(cached.connections)) this.value = cached;
    } catch { /* Start from Host. */ }
  }
  private keys(): string[] {
    return Array.from({ length: this.storage.length }, (_, i) => this.storage.key(i))
      .filter((key): key is string => !!key?.startsWith(`${this.prefix}pending:`));
  }
  get pending(): boolean { return this.keys().length > 0; }
  get connections(): HostConnectionDefinition[] {
    const entries = new Map(this.value.connections.map((entry) => [entry.id, entry]));
    for (const key of this.keys()) {
      let pending: PendingChange;
      try { pending = JSON.parse(this.storage.getItem(key)!) as PendingChange; } catch { continue; }
      if (!pending?.changes || typeof pending.changes !== "object") continue;
      for (const [id, value] of Object.entries(pending.changes)) {
        if (value) entries.set(id, value); else entries.delete(id);
      }
    }
    return [...entries.values()];
  }
  async patch(changes: PendingChange["changes"], importRelease = false): Promise<void> {
    const pending: PendingChange = { operationId: crypto.randomUUID(), changes, ...(importRelease ? { importRelease: true } : {}) };
    this.storage.setItem(`${this.prefix}pending:${pending.operationId}`, JSON.stringify(pending));
    await this.sync().catch(() => undefined);
  }
  sync(): Promise<void> {
    const run = this.serial.catch(() => undefined).then(async () => {
      for (const key of this.keys()) {
        const raw = this.storage.getItem(key);
        if (!raw) continue;
        const result = await this.request<HostConnections>("connections.patch", JSON.parse(raw));
        if (result.revision >= this.value.revision) {
          this.value = result;
          this.storage.setItem(`${this.prefix}cache`, JSON.stringify(result));
        }
        if (this.storage.getItem(key) === raw) this.storage.removeItem(key);
      }
      const result = await this.request<HostConnections | null>("connections.list", { revision: this.value.revision });
      if (result) {
        this.value = result;
        this.storage.setItem(`${this.prefix}cache`, JSON.stringify(result));
      }
    });
    this.serial = run;
    return run;
  }
}

let directory: HostConnectionDirectory | undefined;
let state: HostConnectionDirectoryState = { connections: [], pending: false, error: "" };
let stop: (() => void) | undefined;
let activation = 0;
const subscribers = new Set<() => void>();
function publish(error = "") {
  const next = { connections: directory?.connections ?? [], pending: directory?.pending ?? false, error };
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  for (const listener of subscribers) listener();
  window.dispatchEvent(new Event(HOST_CONNECTIONS_CHANGE));
}
const subscribe = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
const snapshot = () => state;
export const useHostConnections = () => useSyncExternalStore(subscribe, snapshot, snapshot);

export function stopHostConnections(): void {
  stop?.();
  stop = undefined;
  activation++;
  directory = undefined;
  publish();
}

export async function initializeHostConnections(options?: {
  environmentId: string;
  request: HostStateRequest;
  allowCached?: boolean;
}): Promise<void> {
  stopHostConnections();
  const epoch = ++activation;
  const environmentId = options?.environmentId ?? sharedHostEnvironment();
  const machineId = sharedHostMachineId();
  if (!environmentId || (!options && !machineId)) return;
  const request: HostStateRequest = options?.request ?? ((method, params) => remoteRequest(machineId!, method, params));
  let descriptor: HostDescriptor | undefined;
  let initialError = "";
  try {
    descriptor = await request<HostDescriptor>("environment.describe");
  } catch (error) {
    const cached = localStorage.getItem(`omnicode.host-connections.v1:${encodeURIComponent(environmentId)}:cache`);
    if (!(options?.allowCached ?? !options) || !cached || !hostStateTransportUnavailable(error)) throw error;
    initialError = String(error);
  }
  if (epoch !== activation) return;
  if (descriptor && descriptor.environmentId !== environmentId) throw new Error("Host identity changed");
  if (descriptor && !descriptor.capabilities?.includes("connections.list")) throw new Error(translate("Update Host to share connections."));
  const next = new HostConnectionDirectory(environmentId, request, localStorage);
  directory = next;
  publish(initialError);
  const refresh = () => {
    void next.sync().then(() => { if (directory === next) publish(); })
      .catch((error) => { if (directory === next) publish(String(error)); });
  };
  if (!options && !import.meta.env.DEV) {
    const machines = await listDesktopConnections();
    const definitions = machines.filter((machine) => !machine.wsl && machine.environmentId !== environmentId).map(connectionDefinition);
    await next.patch(Object.fromEntries(definitions.map((entry) => [entry.id, entry])), true);
  }
  await next.sync().catch((error) => { initialError = String(error); });
  if (directory !== next) return;
  publish(initialError);
  const timer = setInterval(refresh, 2_000);
  window.addEventListener("online", refresh);
  window.addEventListener("focus", refresh);
  const visible = () => { if (document.visibilityState === "visible") refresh(); };
  document.addEventListener("visibilitychange", visible);
  stop = () => {
    clearInterval(timer);
    window.removeEventListener("online", refresh);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", visible);
  };
}

export async function publishHostConnection(machine: RemoteMachine): Promise<void> {
  if (!directory || machine.wsl || machine.environmentId === directory.environmentId) return;
  const definition = connectionDefinition(machine);
  await directory.patch({ [definition.id]: definition });
  publish();
}

export async function removeHostConnection(id: string): Promise<void> {
  if (!directory) return;
  await directory.patch({ [id]: null });
  publish();
}
