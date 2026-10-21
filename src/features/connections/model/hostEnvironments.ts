import { queryOptions, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { remoteRequest } from "./connections";
import { sharedHostMachineId } from "./remoteProjects";
import type { HostEnvironmentDefinition, HostEnvironments } from "./hostState";
import { parseWslPath, wslPath } from "../../../shared/lib/wslPaths";

/** Named environments live on this computer's shared Host, which applies
 * their variables to provider processes started inside their folders. */
export type HostEnvironmentState = { environments: HostEnvironmentDefinition[]; loaded: boolean; error: string };

const environmentKey = () => ["hostEnvironments", sharedHostMachineId()] as const;
function environmentsQuery() {
  const queryKey = environmentKey(), machineId = sharedHostMachineId();
  return queryOptions({
    queryKey,
    queryFn: async () => {
      if (!machineId) throw new Error("Shared conversation service is not connected");
      const previous = queryClient.getQueryData<HostEnvironments>(queryKey);
      const value = await remoteRequest<HostEnvironments | null>(machineId, "environments.list", { revision: previous?.revision ?? -1 });
      const current = queryClient.getQueryData<HostEnvironments>(queryKey);
      return value && (!current || value.revision >= current.revision) ? value : current ?? { revision: -1, environments: [] };
    },
  });
}
export async function refreshHostEnvironments(): Promise<void> {
  await queryClient.fetchQuery(environmentsQuery()).catch(() => undefined);
}
export function useHostEnvironments(): HostEnvironmentState {
  const read = useQuery(environmentsQuery(), queryClient);
  return { environments: read.data?.environments ?? [], loaded: read.isFetched, error: read.error?.message ?? "" };
}
export async function saveHostEnvironment(value: HostEnvironmentDefinition): Promise<void> {
  const machineId = sharedHostMachineId(), queryKey = environmentKey();
  if (!machineId) throw new Error("Shared conversation service is not connected");
  const result = await remoteRequest<HostEnvironments>(machineId, "environments.patch", {
    operationId: crypto.randomUUID(), changes: { [value.id]: value },
  });
  queryClient.setQueryData<HostEnvironments>(queryKey, current => current && current.revision > result.revision ? current : result);
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
