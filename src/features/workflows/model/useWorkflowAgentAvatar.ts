import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { watchHostSession, type HostSessionLease } from "./workflowSessionWatch";
import { buildWorkflowTimeline } from "../kit/components/workflow-timeline/timeline-model";
import { buildWorkflowGraphByToolCallId, resolveWorkflowRunGraph } from "../kit/v4/workflowRunCardJoin";
import { workflowRowsOf } from "../kit/v4/useConversationProjection";
import type { WorkflowAgentAvatar } from "./workflowAgentAvatar";

const subscribeNothing = () => () => {};

export function useWorkflowAgentAvatar(cwd: string, parentSessionId: string, runId: string, sessionId: string) {
  const [watch, setWatch] = useState<{ cwd: string; lease: HostSessionLease }>();
  useEffect(() => {
    const lease = watchHostSession(cwd, parentSessionId);
    setWatch({ cwd, lease });
    return () => lease.release();
  }, [cwd, parentSessionId]);
  const lease = watch?.cwd === cwd && watch.lease.sessionId === parentSessionId ? watch.lease : undefined;
  const session = useSyncExternalStore(lease?.subscribe ?? subscribeNothing, () => lease?.getSnapshot(), () => undefined);
  return useMemo<WorkflowAgentAvatar | undefined>(() => {
    if (!session) return;
    const runs = session.workflowRuns?.runs;
    const run = runs?.find((candidate) => candidate.runId === runId);
    const block = session.blocks.find((candidate) => candidate.workflowRun?.runId === runId);
    const graph = resolveWorkflowRunGraph(buildWorkflowGraphByToolCallId(workflowRowsOf(session)),
      run?.toolCallId ?? block?.id ?? "", runs);
    if (!graph) return;
    const pill = buildWorkflowTimeline(graph, run).stations.flatMap((station) => station.pills)
      .find((candidate) => candidate.instance?.sessionId === sessionId);
    if (pill) return { avatarIndex: pill.avatarIndex, name: pill.runtimeName ?? "", status: pill.status };
  }, [session, runId, sessionId]);
}
