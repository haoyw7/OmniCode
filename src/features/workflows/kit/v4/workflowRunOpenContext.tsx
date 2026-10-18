// Monocode shim for ZCode's run-open handler: a run line in the sidebar opens the
// run's detail tab through the desktop shell.
import { useCallback } from "react";
import { useWorkflowApp } from "../../ui/workflowAppContext";
import type { SessionWorkflowRunSummary } from "../_shims/protocol.js";

export interface WorkflowRunOpenTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  run: SessionWorkflowRunSummary;
}

type WorkflowRunOpenHandler = (target: WorkflowRunOpenTarget) => void;

export function useWorkflowRunOpen(): WorkflowRunOpenHandler | null {
  const app = useWorkflowApp();
  const open = useCallback<WorkflowRunOpenHandler>((target) => {
    app?.openRun({
      cwd: target.workspacePath,
      parentSessionId: target.sessionId,
      runId: target.run.runId,
      ...(target.run.toolCallId ? { toolCallId: target.run.toolCallId } : {}),
      ...(target.run.name ? { workflowName: target.run.name } : {}),
    });
  }, [app]);
  return app ? open : null;
}
