// The run-card summary type from ZCode (Apache-2.0) packages/ui/src/ToolCallBlocks/fileSummaryTypes.ts.
import type { WorkflowRunState } from "../_shims/protocol.js";

export interface WorkflowRunCardSummary {
  runId: string;
  /** The launching row's id (Monocode: the run-card block id). */
  toolCallId?: string;
  status: WorkflowRunState["status"];
  stopReason?: WorkflowRunState["stopReason"];
  nodesSettled: number;
  nodesTotal: number;
  agents?: number;
  run?: WorkflowRunState;
  resumable?: true;
}
