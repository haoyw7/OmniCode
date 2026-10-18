// Monocode shim: ZCode's conversation projection, built from the Host session the
// lease watches — its live `workflowRuns` and rows derived from run-card blocks.
import { useMemo, useSyncExternalStore } from "react";
import type { Session } from "../../../sessions/model/session";
import type { ConversationRow, SessionConfigState, WorkflowRunsState } from "../_shims/protocol.js";
import type { SessionLease } from "./sessionDataLayer.js";

export type WorkflowConversationSnapshot = {
  sessionId: string;
  workflowRuns?: WorkflowRunsState;
  rows: { window: ConversationRow[] };
  config: SessionConfigState;
  session: Session;
};

const subscribeNothing = () => () => {};

/** Rows the workflow views read: one launch tool call per run card, plus the launch turn for user-launched runs. */
export function workflowRowsOf(session: Session): ConversationRow[] {
  const rows: ConversationRow[] = [];
  for (const block of session.blocks) {
    const run = block.workflowRun;
    if (!run) continue;
    rows.push({ kind: "toolCall", rowId: block.id, toolCallId: block.id, ...(run.graph ? { display: { kind: "create_workflow", causalityGraph: run.graph } } : {}) });
    if (run.launchedBy === "user")
      rows.push({
        kind: "turnHeader",
        rowId: `${block.id}:launch`,
        startedAt: run.createdAt,
        workflowLaunch: {
          runId: run.runId,
          toolCallId: block.id,
          name: run.name,
          ...(run.source.kind === "saved" ? { scope: run.source.scope } : {}),
          ...(run.scriptPath ? { path: run.scriptPath } : {}),
        },
      });
  }
  return rows;
}

export function workflowSnapshotOf(session: Session): WorkflowConversationSnapshot {
  return {
    sessionId: session.id,
    ...(session.workflowRuns ? { workflowRuns: session.workflowRuns } : {}),
    rows: { window: workflowRowsOf(session) },
    config: { model: { providerId: session.harness, modelId: session.model } },
    session,
  };
}

export function useConversationProjection(lease: SessionLease | null): { snapshot: WorkflowConversationSnapshot | undefined } {
  const session = useSyncExternalStore(lease?.subscribe ?? subscribeNothing, () => lease?.getSnapshot(), () => undefined);
  const snapshot = useMemo(() => (session ? workflowSnapshotOf(session) : undefined), [session]);
  return { snapshot };
}
