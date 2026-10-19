import { sharedHostEnvironment, sharedHostMachineId } from "../../connections/model/remoteProjects";

export function providerUsageHost() {
  const machineId = sharedHostMachineId();
  const environmentId = sharedHostEnvironment();
  return machineId && environmentId ? { machineId, environmentId } : undefined;
}

/** Account IDs are scoped to the execution Host, including the built-in profile. */
export function providerUsageSourceKey(): string {
  const host = providerUsageHost();
  return host ? JSON.stringify([host.machineId, host.environmentId]) : "local";
}
