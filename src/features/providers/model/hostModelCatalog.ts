import { remoteRequest } from "../../connections/model/connections";
import { ModelCatalogLoad } from "../../../client/modelCatalogLoad";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { sharedHostEnvironment, sharedHostMachineId } from "../../connections/model/remoteProjects";
import { beginCatalogLoad, setHarnessModels } from "../../../integrations/harness/core/modelCatalog";
import type { HarnessId } from "../../../contracts/session";
import type { HostModelCatalog } from "../../../contracts/protocol";
import { translate } from "../../../shared/i18n/language";
import { showStatusToast } from "../../../shared/ui/StatusToast";

const pending = new Map<string, { promise: Promise<void>; force: boolean }>();
const queuedRefreshes = new Map<string, Promise<void>>();
const loaded = new Set<string>();

/** Desktop catalogs are projections of Host discovery, including before the
 * first project opens. A disconnected Host leaves the cached catalog intact;
 * it must never start a provider in the WebView as a fallback. */
export async function refreshHostModelCatalogs(
  ids: Iterable<HarnessId>,
  options?: { force?: boolean },
): Promise<void> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return;
  const machineId = sharedHostMachineId();
  const environmentId = sharedHostEnvironment();
  if (!machineId || !environmentId) {
    console.debug("[omnicode] model catalog: Shared conversation service is not connected");
    if (options?.force) showStatusToast(translate("Shared conversation service is not connected"), "error");
    return;
  }
  await Promise.all(wanted.map((harness) => {
    const key = JSON.stringify([machineId, environmentId, harness]);
    const existing = pending.get(key);
    if (existing) {
      if (!options?.force || existing.force) return existing.promise;
      const queued = queuedRefreshes.get(key);
      if (queued) return queued;
      const next = existing.promise.then(() => refreshHostModelCatalogs([harness], options))
        .finally(() => queuedRefreshes.delete(key));
      queuedRefreshes.set(key, next);
      return next;
    }
    if (!options?.force && loaded.has(key)) return;
    const done = beginCatalogLoad(harness);
    const current = () => sharedHostMachineId() === machineId && sharedHostEnvironment() === environmentId;
    const request = (async () => {
      const descriptor = await loadRemoteHostDescriptor(machineId, environmentId);
      if (!descriptor.capabilities.includes("models.list"))
        throw new Error(translate("This Host does not support model discovery"));
      if (options?.force && !descriptor.capabilities.includes("models.refresh.v1"))
        throw new Error(translate("This Host does not support refreshing model discovery. Update the Host to refresh models."));
      if (!descriptor.providers.includes(harness)) return;
      let firstRead = true;
      const catalog = new ModelCatalogLoad(
        (params) => {
          const force = firstRead && options?.force === true;
          firstRead = false;
          return remoteRequest<HostModelCatalog>(machineId, "models.list", {
            ...params, providers: params.providers ?? [harness], ...(force ? { force: true } : {}),
          });
        },
        (value) => {
          const models = value.models[harness];
          if (current() && models?.length) setHarnessModels(harness, models);
        },
        () => translate("Model discovery timed out"),
      );
      const value = await catalog.promise;
      if (value.errors[harness]) throw new Error(value.errors[harness]);
      if (current() && value.models[harness]?.length) loaded.add(key);
    })().catch((error: unknown) => {
      console.debug(`[omnicode] ${harness} Host catalog`, error);
      if (options?.force) showStatusToast(error instanceof Error ? error.message : String(error), "error");
    }).finally(() => {
      pending.delete(key);
      done();
    });
    pending.set(key, { promise: request, force: options?.force === true });
    return request;
  }));
}
