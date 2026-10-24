import { remoteRequest } from "../../connections/model/connections";
import { sharedHostMachineId, sharedHostEnvironment } from "../../connections/model/remoteProjects";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { translate } from "../../../shared/i18n/language";

export async function automationHostRequest<T>(method: "automations.list" | "automations.upsert" | "automations.delete" | "automations.runs" | "automations.run" | "automations.claimEvent", params?: Record<string, unknown>): Promise<T> {
  const machineId = sharedHostMachineId();
  if (!machineId) throw new Error(translate("Shared conversation service is not connected"));
  const descriptor = await loadRemoteHostDescriptor(machineId, sharedHostEnvironment() ?? "");
  if (!descriptor.capabilities.includes("automations.v1")) throw new Error(translate("Update Host to use shared automations."));
  return remoteRequest<T>(machineId, method, params);
}
