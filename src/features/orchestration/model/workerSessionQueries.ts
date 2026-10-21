import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { loadRemoteSession } from "../../connections/model/connections";
import type { HostSession } from "../../connections/model/protocol";
import type { HostWorkerReference } from "./orchestrationClient";

export function workerSessionQuery(source?: HostWorkerReference) {
  const queryKey = ["orchestration", "worker-session", source?.machineId, source?.project.environmentId, source?.project.projectId, source?.leadId, source?.sessionId] as const;
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<HostSession> => {
      signal.throwIfAborted();
      if (!source) throw new Error("Missing worker session reference");
      const known = queryClient.getQueryData<HostSession>(queryKey);
      const next = await loadRemoteSession(source.machineId, source.sessionId, known);
      if (next.projectId !== source.project.projectId || next.session.id !== source.sessionId || next.session.orchestrationLeadId !== source.leadId) {
        throw new Error("Worker session does not match its project and lead");
      }
      return next;
    },
    refetchInterval: (query) => !query.state.error && query.state.data?.status === "running" ? 750 : 3_000,
  });
}
