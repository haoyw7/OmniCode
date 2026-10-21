import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { remoteRequest } from "./connections";
import { loadRemoteHostCatalog } from "./remoteHostMetadata";
import type { HostModelCatalog, HostSession } from "./protocol";

export const remoteSessionKeys = {
  snapshot: (machineId: string, sessionId: string) => ["remoteSession", "snapshot", machineId, sessionId] as const,
  descriptor: (machineId: string, environmentId: string) => ["remoteSession", "descriptor", machineId, environmentId] as const,
  catalog: (machineId: string, environmentId: string, projectId: string) => ["remoteSession", "catalog", machineId, environmentId, projectId] as const,
  sync: (machineId: string, environmentId: string, projectId: string, sessionId: string | undefined, shellId: string) => ["remoteSession", "sync", machineId, environmentId, projectId, sessionId, shellId] as const,
};

export function remoteSessionCatalogQuery(machineId: string, environmentId: string, projectId: string) {
  const queryKey = remoteSessionKeys.catalog(machineId, environmentId, projectId);
  return queryOptions({
    queryKey,
    // CatalogLoad can publish ready providers before slow CLIs finish.
    queryFn: async ({ signal }): Promise<HostModelCatalog> => {
      try {
        return await loadRemoteHostCatalog(machineId, environmentId, projectId, (catalog) => {
          if (!signal.aborted) queryClient.setQueryData(queryKey, catalog);
        });
      } catch (error) {
        if (!signal.aborted) queryClient.setQueryData<HostModelCatalog>(queryKey, (catalog) => catalog ? { ...catalog, pending: [] } : catalog);
        throw error;
      }
    },
  });
}

export const remoteSnapshotQuery = (queryKey: readonly unknown[], load: () => Promise<HostSession>) => queryOptions({
  queryKey,
  queryFn: load,
});

export function rememberSessionSnapshot(key: readonly unknown[], snapshot: HostSession) {
  queryClient.setQueryData(key, snapshot);
  const snapshots = queryClient.getQueryCache().findAll({ queryKey: ["remoteSession", "snapshot"] })
    .sort((a, b) => Number(JSON.stringify(b.queryKey) === JSON.stringify(key)) - Number(JSON.stringify(a.queryKey) === JSON.stringify(key)) || b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const old of snapshots.slice(8)) {
    if (old.state.fetchStatus !== "fetching") queryClient.removeQueries({ queryKey: old.queryKey, exact: true });
  }
}

export const remoteCommandMutation = () => mutationOptions({
  mutationFn: ([machineId, method, params]: Parameters<typeof remoteRequest>) => remoteRequest(machineId, method, params),
  retry: false, // Ambiguous commands must keep their ID and require an explicit retry.
});

export const remoteSessionReadQuery = <T>(machineId: string, method: string, params: object) => queryOptions({
  queryKey: ["remoteSession", "read", machineId, method, params],
  queryFn: () => remoteRequest<T>(machineId, method, params),
});
