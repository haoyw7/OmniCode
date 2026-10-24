import type { HarnessId } from "../../../contracts/session";
import { HOST_PROVIDER_RUNTIME_CAPABILITY, type HarnessBinaryInspection, type HarnessCliPlan, type HarnessInstall, type ProviderMutationStatus } from "../../../contracts/providerRuntime";
import { remoteRequest } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { sharedHostEnvironment, sharedHostMachineId } from "../../connections/model/remoteProjects";
import { translate } from "../../../shared/i18n/language";

async function target(): Promise<string> {
  const machineId = sharedHostMachineId(), environmentId = sharedHostEnvironment();
  if (!machineId || !environmentId) throw new Error(translate("Connect to the shared Host to manage provider installations."));
  const host = await loadRemoteHostDescriptor(machineId, environmentId);
  if (sharedHostMachineId() !== machineId || sharedHostEnvironment() !== environmentId) throw new Error(translate("Host connection changed."));
  if (!host.capabilities.includes(HOST_PROVIDER_RUNTIME_CAPABILITY)) throw new Error(translate("Update the Host to manage provider installations."));
  return machineId;
}

export async function inspectHarnessBinary(provider: HarnessId, binaryPath?: string | null): Promise<HarnessBinaryInspection> {
  return remoteRequest(await target(), "providers.runtimeInspect", { provider, binaryPath });
}
export async function hostHarnessCliPlan(provider: HarnessId, binaryPath: string | null): Promise<HarnessCliPlan> {
  return remoteRequest(await target(), "providers.runtimePlan", { provider, binaryPath });
}
export async function fetchHostHarnessInstall(provider: HarnessId, binaryPath?: string | null): Promise<HarnessInstall> {
  return remoteRequest(await target(), "providers.runtimeInfo", { provider, binaryPath });
}
export async function latestHostHarnessVersion(provider: HarnessId): Promise<string> {
  return remoteRequest(await target(), "providers.runtimeLatest", { provider });
}
export async function claimHostHarnessUpdateCheck(): Promise<boolean> {
  return remoteRequest(await target(), "providers.runtimeClaimUpdateCheck");
}
async function mutate(action: "install" | "update" | "uninstall", provider: HarnessId, binaryPath?: string | null): Promise<void> {
  const machineId = await target();
  let status = await remoteRequest<ProviderMutationStatus>(machineId, "providers.runtimeStart", { action, provider, binaryPath, operationId: crypto.randomUUID() });
  const deadline = Date.now() + 17 * 60_000;
  while (status.status === "running" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    status = await remoteRequest<ProviderMutationStatus>(machineId, "providers.runtimeStatus", { id: status.id });
  }
  if (status.status !== "succeeded") throw new Error(status.error || translate("Provider installation is still running on the Host."));
}
export const installHostHarness = (provider: HarnessId) => mutate("install", provider);
export const updateHarnessCli = (provider: HarnessId) => mutate("update", provider);
export const uninstallHostHarness = (provider: HarnessId, binaryPath: string | null) => mutate("uninstall", provider, binaryPath);
