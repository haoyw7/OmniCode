// Sidebar run lines: each conversation's workflow runs summarized the way
// the sessions index does, from the run state the Host projects onto it.
import { createContext, useContext } from "react";
import {
  deriveSessionWorkflowActivity,
  type BackgroundWorkSummary,
  type SessionWorkflowActivity,
} from "../../../integrations/workflow/protocol/sessions-index-workflow-activity";
import { remoteSessionFor } from "../../connections/model/connections";
import type { Session } from "../../sessions/model/session";

/** Every conversation with workflow runs, once each. */
export function workflowActivityEntries(index: ReadonlyMap<string, WorkflowActivityEntry>): WorkflowActivityEntry[] {
  return [...new Set(index.values())];
}

export function sessionWorkflowActivity(session: Pick<Session, "blocks" | "workflowRuns">): SessionWorkflowActivity | undefined {
  const runs = session.workflowRuns;
  if (!runs?.runs.length) return undefined;
  const statusById = new Map(runs.runs.map((run) => [run.runId, run.status]));
  const works: BackgroundWorkSummary[] = [];
  for (const block of session.blocks) {
    const meta = block.workflowRun;
    if (!meta) continue;
    const status = statusById.get(meta.runId);
    works.push({
      workId: meta.runId,
      kind: "workflow",
      title: meta.name,
      status: status === "errored" ? "failed" : status === "stopped" ? "cancelled" : "running",
      startedAt: meta.createdAt,
    });
  }
  return deriveSessionWorkflowActivity({ workflowRuns: runs, backgroundWorks: works });
}

export type WorkflowActivityEntry = {
  /** The desktop conversation the run card lives in. */
  sessionId: string;
  cwd: string;
  title: string;
  harness: Session["harness"];
  activity: SessionWorkflowActivity;
};

/** Run activity by desktop session id and by the Host session id it is bound to. */
export function workflowActivityIndex(sessions: readonly Session[]): ReadonlyMap<string, WorkflowActivityEntry> {
  const index = new Map<string, WorkflowActivityEntry>();
  for (const session of sessions) {
    const activity = sessionWorkflowActivity(session);
    if (!activity) continue;
    const entry = { sessionId: session.id, cwd: session.cwd, title: session.title, harness: session.harness, activity };
    index.set(session.id, entry);
    const hostId = remoteSessionFor(session.id);
    if (hostId) index.set(hostId, entry);
  }
  return index;
}

export const WorkflowActivityContext = createContext<ReadonlyMap<string, WorkflowActivityEntry>>(new Map());

export function useWorkflowActivity(sessionId: string): WorkflowActivityEntry | undefined {
  return useContext(WorkflowActivityContext).get(sessionId);
}
