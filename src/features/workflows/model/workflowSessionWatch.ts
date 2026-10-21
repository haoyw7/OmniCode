import { QueryObserver } from "@tanstack/react-query";
import { queryClient, invalidateAfterChange } from "../../../shared/lib/queryClient";
import { loadRemoteSession, remoteMachineFor, remoteRequest, remoteSessionFor } from "../../connections/model/connections";
import type { HostSession } from "../../connections/model/protocol";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import type { Session } from "../../sessions/model/session";

export type HostSessionLease = {
  readonly sessionId: string;
  getSnapshot(): Session | undefined;
  subscribe(listener: () => void): () => void;
  /** Re-read now (after a command), instead of waiting for the next poll. */
  refresh(): void;
  /** Answer a tool approval the session is waiting on. */
  approve(requestId: number, decision: "allow" | "deny"): Promise<void>;
  release(): void;
};

type WatchedSession = { session: Session; host?: HostSession };

export function watchHostSession(cwd: string, sessionId: string, seed?: Session): HostSessionLease {
  const project = remoteProjectFor(cwd);
  const hostId = remoteSessionFor(sessionId) ?? sessionId;
  const queryKey = ["workflowHostSession", project?.environmentId, project?.projectId, cwd, hostId];
  const observer = new QueryObserver<WatchedSession | null>(queryClient, {
    queryKey, gcTime: 0, notifyOnChangeProps: ["data"], structuralSharing: false,
    ...(seed ? { initialData: { session: seed } } : {}),
    refetchInterval: query => {
      const data = query.state.data;
      return data?.host?.status === "running" || data?.session.workflowRuns?.runs.some(run => run.status === "running" || run.status === "pending") ? 900 : 4_000;
    },
    queryFn: async ({ signal }) => {
      const current = queryClient.getQueryData<WatchedSession | null>(queryKey);
      const machine = project ? await remoteMachineFor(project.environmentId) : undefined;
      if (!machine) return current ?? null;
      const next = await loadRemoteSession(machine.id, hostId, current?.host);
      signal.throwIfAborted();
      return current?.host === next ? current : { host: next, session: next.session };
    },
  });
  // A lease owns the observer lifetime; Query shares its reads with other leases.
  const stop = observer.subscribe(() => {});
  let released = false;
  const refresh = () => { if (!released) void invalidateAfterChange(queryKey); };
  return {
    sessionId,
    getSnapshot: () => observer.getCurrentResult().data?.session,
    subscribe: listener => observer.subscribe(() => listener()),
    refresh,
    approve: async (requestId, decision) => {
      const machine = project ? await remoteMachineFor(project.environmentId) : undefined;
      const runId = observer.getCurrentResult().data?.host?.runId;
      if (!machine || !runId) throw new Error("This subagent is not waiting for an approval");
      await queryClient.getMutationCache().build(queryClient, {
        mutationFn: () => remoteRequest(machine.id, "commands.dispatch", {
          type: "approve", commandId: crypto.randomUUID(), sessionId: hostId, runId, requestId, decision,
        }),
      }).execute(undefined);
      refresh();
    },
    release: () => {
      if (released) return;
      released = true;
      stop();
      observer.destroy();
    },
  };
}
