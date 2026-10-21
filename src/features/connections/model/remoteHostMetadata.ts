import { queryClient } from "../../../shared/lib/queryClient";
import { remoteRequest } from "./connections";
import { ModelCatalogLoad } from "./modelCatalogLoad";
import { REMOTE_PROVIDERS, requireHostDescriptor, type HostDescriptor, type HostModelCatalog } from "./protocol";

/** Revalidate later reconnects while sharing concurrent descriptor requests. */
export function loadRemoteHostDescriptor(machineId: string, environmentId: string): Promise<HostDescriptor> {
  return queryClient.fetchQuery({
    queryKey: ["remoteHostTransport", machineId, environmentId, "descriptor"],
    queryFn: async () => {
      const descriptor = requireHostDescriptor(await remoteRequest<HostDescriptor>(machineId, "environment.describe", { supportedProviders: REMOTE_PROVIDERS }));
      if (descriptor.environmentId !== environmentId) throw new Error("Host identity changed. Reconnect this machine before continuing.");
      return descriptor;
    },
  });
}

export function loadRemoteHostCatalog(machineId: string, environmentId: string, projectId: string, onUpdate?: (catalog: HostModelCatalog) => void): Promise<HostModelCatalog> {
  const queryKey = ["remoteHostTransport", machineId, environmentId, "catalog", projectId];
  let latest: HostModelCatalog | undefined;
  const stop = onUpdate ? queryClient.getQueryCache().subscribe(event => {
    if (event.type !== "updated" || JSON.stringify(event.query.queryKey) !== JSON.stringify(queryKey)) return;
    const value = event.query.state.data as HostModelCatalog | undefined;
    if (value && value !== latest) { latest = value; onUpdate(value); }
  }) : undefined;
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (query?.state.fetchStatus === "fetching" && query.state.data) {
    latest = query.state.data as HostModelCatalog; onUpdate?.(latest);
  }
  return queryClient.fetchQuery({
    queryKey, structuralSharing: false,
    queryFn: ({ signal }) => new ModelCatalogLoad(async params => {
      signal.throwIfAborted();
      const value = await remoteRequest<HostModelCatalog>(machineId, "models.list", { projectId, ...params });
      signal.throwIfAborted();
      return value;
    }, value => queryClient.setQueryData(queryKey, value), queryClient.getQueryData<HostModelCatalog>(queryKey)).promise,
  }).finally(() => stop?.());
}
