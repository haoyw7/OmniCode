import { useMemo, useSyncExternalStore } from "react";
import { queryClient } from "../../../shared/lib/queryClient";
import { isConfigurationExecutionWarning } from "../../../integrations/harness/core/executionWarnings";
import { knownRemoteMachine, REMOTE_MACHINES_CHANGED } from "../../connections/model/connections";
import { remoteProjectFor, REMOTE_PROJECTS_CHANGED } from "../../connections/model/remoteProjects";
import type { HostSession } from "../../connections/model/protocol";

function subscribe(listener: () => void) {
  const stop = queryClient.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === "remoteSession" && event.query.queryKey[1] === "snapshot") listener();
  });
  window.addEventListener(REMOTE_PROJECTS_CHANGED, listener);
  window.addEventListener(REMOTE_MACHINES_CHANGED, listener);
  return () => {
    stop();
    window.removeEventListener(REMOTE_PROJECTS_CHANGED, listener);
    window.removeEventListener(REMOTE_MACHINES_CHANGED, listener);
  };
}

/** Reuse verified Host snapshots without fetching conversation text for settings. */
function warnings(cwd: string): string {
  const project = remoteProjectFor(cwd);
  const machine = project && knownRemoteMachine(project.environmentId);
  if (!project?.projectId || !machine) return "[]";
  const latest = new Set<string>();
  const result = new Set<string>();
  const queries = queryClient.getQueryCache().findAll({ queryKey: ["remoteSession", "snapshot", machine.id] })
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const query of queries) {
    const snapshot = query.state.data as HostSession | undefined;
    if (!snapshot || snapshot.projectId !== project.projectId || snapshot.executionWarnings === undefined) continue;
    const scope = JSON.stringify([snapshot.session.harness, snapshot.session.providerAccountId ?? "default", snapshot.session.executionCwd ?? snapshot.session.cwd]);
    if (latest.has(scope)) continue;
    latest.add(scope);
    for (const warning of snapshot.executionWarnings ?? []) {
      if (isConfigurationExecutionWarning(warning)) result.add(warning);
    }
  }
  return JSON.stringify([...result].sort());
}

export function useMcpExecutionWarnings(cwd: string): string[] {
  const value = useSyncExternalStore(subscribe, () => warnings(cwd), () => "[]");
  return useMemo(() => JSON.parse(value) as string[], [value]);
}
