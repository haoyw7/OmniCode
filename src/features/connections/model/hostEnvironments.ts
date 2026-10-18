import { useEffect, useSyncExternalStore } from "react";
import { remoteRequest } from "./connections";
import { sharedHostMachineId } from "./remoteProjects";
import type { HostEnvironmentDefinition, HostEnvironments } from "./hostState";
import { parseWslPath, wslPath } from "../../../shared/lib/wslPaths";

/** Named environments live on this computer's shared Host, which applies
 * their variables to provider processes started inside their folders. */
export type HostEnvironmentState = { environments: HostEnvironmentDefinition[]; loaded: boolean; error: string };

let state: HostEnvironmentState = { environments: [], loaded: false, error: "" };
let revision = -1;
let loading: Promise<void> | undefined;
const subscribers = new Set<() => void>();

function publish(next: Partial<HostEnvironmentState>) {
  state = { ...state, ...next };
  for (const listener of subscribers) listener();
}

function request<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const machineId = sharedHostMachineId();
  if (!machineId) return Promise.reject(new Error("Shared conversation service is not connected"));
  return remoteRequest<T>(machineId, method, params);
}

function accept(value: HostEnvironments | null) {
  if (!value || value.revision < revision) return;
  revision = value.revision;
  publish({ environments: value.environments, loaded: true, error: "" });
}

export function refreshHostEnvironments(): Promise<void> {
  loading ??= request<HostEnvironments | null>("environments.list", { revision })
    .then(accept, (reason) => publish({ loaded: true, error: String(reason).replace(/^Error: /, "") }))
    .finally(() => { loading = undefined; });
  return loading;
}

const subscribe = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
const snapshot = () => state;

/** Reads the Host's environments, refreshing whenever a consumer mounts. */
export function useHostEnvironments(): HostEnvironmentState {
  useEffect(() => { void refreshHostEnvironments(); }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export async function saveHostEnvironment(value: HostEnvironmentDefinition): Promise<void> {
  accept(await request<HostEnvironments>("environments.patch", {
    operationId: crypto.randomUUID(), changes: { [value.id]: value },
  }));
}

/** The project path the desktop opens for one of an environment's folders. */
export function environmentProjectPath(environment: HostEnvironmentDefinition, folder: string): string {
  return environment.machine ? wslPath(environment.machine.distribution, folder) : folder;
}

/** The environment whose folder most specifically contains a desktop project path. */
export function environmentForPath(
  environments: HostEnvironmentDefinition[],
  cwd: string | undefined,
): HostEnvironmentDefinition | undefined {
  if (!cwd) return undefined;
  const wsl = parseWslPath(cwd);
  const path = (wsl?.hostPath ?? cwd).replace(/\\/g, "/");
  // Windows drive paths ignore case; POSIX and WSL paths do not.
  const insensitive = !wsl && /^[A-Za-z]:\//.test(path);
  const normalize = (value: string) => {
    const trimmed = value.replace(/\\/g, "/").replace(/(.)\/+$/, "$1");
    return insensitive ? trimmed.toLowerCase() : trimmed;
  };
  const target = normalize(path);
  let best: { depth: number; environment: HostEnvironmentDefinition } | undefined;
  for (const environment of environments) {
    if ((environment.machine?.distribution ?? "") !== (wsl?.machine.distribution ?? "")) continue;
    for (const folder of environment.folders) {
      const root = normalize(folder);
      const inside = target === root || target.startsWith(root.endsWith("/") ? root : `${root}/`);
      if (inside && (!best || root.length > best.depth)) best = { depth: root.length, environment };
    }
  }
  return best?.environment;
}
