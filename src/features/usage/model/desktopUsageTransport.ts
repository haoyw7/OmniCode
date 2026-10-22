import { USAGE_CAPABILITY } from "../../../integrations/harness/core/usage";
import { remoteRequest } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import type { RemoteMachine } from "../../connections/model/protocol";
import type { UsageTransport } from "./usageTransport";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { remoteMachineFor } from "../../connections/model/connections";
import { providerUsageHost } from "../../providers/model/providerUsageSource";
import type { UsageLimitsNoticeSource } from "./usageLimitsNotice";
export function desktopUsageTransport(
  machine: Pick<RemoteMachine, "id" | "environmentId" | "name">,
): UsageTransport {
  const read = async <T>(method: string, params: unknown): Promise<T> => {
    const descriptor = await loadRemoteHostDescriptor(
      machine.id,
      machine.environmentId,
    );
    if (!descriptor.capabilities.includes(USAGE_CAPABILITY))
      throw new Error(
        "This Host does not support usage yet. Update and restart it, then refresh.",
      );
    return remoteRequest<T>(machine.id, method, params);
  };
  return {
    sourceKey: JSON.stringify(["desktop", machine.environmentId]),
    label: machine.name,
    enabled: true,
    summary: (input) => read("usage.summary", input),
    limits: (refresh) => read("usage.limits", { refresh }),
    update: (patch) => read("usage.settings.update", patch),
    progress: () => read("usage.progress", {}),
    reset: (accountId, creditId) =>
      read("usage.limits.reset", {
        accountId,
        creditId,
        idempotencyKey: crypto.randomUUID(),
      }),
  };
}
export function desktopUsageNoticeSource(
  cwd?: string,
): UsageLimitsNoticeSource | undefined {
  const project = cwd ? remoteProjectFor(cwd) : undefined,
    shared = providerUsageHost();
  const environmentId = project?.environmentId ?? shared?.environmentId;
  if (!environmentId) return undefined;
  return {
    sourceKey: JSON.stringify(["desktop", environmentId]),
    limits: async (refresh) => {
      const machine = await remoteMachineFor(environmentId);
      if (machine) return desktopUsageTransport(machine).limits(refresh);
      if (shared?.environmentId === environmentId)
        return desktopUsageTransport({
          id: shared.machineId,
          environmentId,
          name: "",
        }).limits(refresh);
      throw new Error("Connect to a Host to view usage.");
    },
  };
}
