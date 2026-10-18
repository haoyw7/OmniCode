import { remoteRequest } from "./connections";
import {
  REMOTE_PROVIDERS,
  requireHostDescriptor,
  type HostDescriptor,
  type HostModelCatalog,
} from "./protocol";

const descriptors = new Map<string, Promise<HostDescriptor>>();
const catalogs = new Map<string, Promise<HostModelCatalog>>();

/** Share concurrent pane reads, but let every later reconnect revalidate the Host. */
function inFlight<T>(requests: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> {
  const existing = requests.get(key);
  if (existing) return existing;
  const request = Promise.resolve().then(read).then(
    (value) => {
      requests.delete(key);
      return value;
    },
    (error) => {
      requests.delete(key);
      throw error;
    },
  );
  requests.set(key, request);
  return request;
}

export function loadRemoteHostDescriptor(machineId: string, environmentId: string): Promise<HostDescriptor> {
  return inFlight(descriptors, JSON.stringify([machineId, environmentId]), async () => {
    const descriptor = requireHostDescriptor(await remoteRequest<HostDescriptor>(
      machineId,
      "environment.describe",
      { supportedProviders: REMOTE_PROVIDERS },
    ));
    if (descriptor.environmentId !== environmentId)
      throw new Error("Host identity changed. Reconnect this machine before continuing.");
    return descriptor;
  });
}

export function loadRemoteHostCatalog(machineId: string, environmentId: string, projectId: string): Promise<HostModelCatalog> {
  return inFlight(catalogs, JSON.stringify([machineId, environmentId, projectId]), () =>
    remoteRequest<HostModelCatalog>(machineId, "models.list", { projectId }),
  );
}
