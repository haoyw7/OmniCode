import { remoteRequest } from "./connections";
import { ModelCatalogLoad } from "../../../client/modelCatalogLoad";
import { translate } from "../../../shared/i18n/language";
import { REMOTE_PROVIDERS } from "../../../contracts/provider";
import { requireHostDescriptor } from "../../../client/hostProtocol";
import { type HostDescriptor, type HostModelCatalog } from "../../../contracts/protocol";

const descriptors = new Map<string, Promise<HostDescriptor>>();
const catalogs = new Map<string, ModelCatalogLoad>();

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

export function loadRemoteHostCatalog(
  machineId: string,
  environmentId: string,
  projectId: string,
  onUpdate?: (catalog: HostModelCatalog) => void,
): Promise<HostModelCatalog> {
  const key = JSON.stringify([machineId, environmentId, projectId]);
  let load = catalogs.get(key);
  if (!load) {
    load = new ModelCatalogLoad(params =>
      remoteRequest<HostModelCatalog>(machineId, "models.list", { projectId, ...params }),
      undefined, () => translate("Model discovery timed out"));
    catalogs.set(key, load);
    const clear = () => { if (catalogs.get(key) === load) catalogs.delete(key); };
    void load.promise.then(clear, clear);
  }
  return load.observe(onUpdate);
}
