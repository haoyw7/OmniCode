// Run settings rules. Adapted from ZCode (Apache-2.0): ZCode retunes one run-level
// subagent model; Monocode retunes per-agent runtimes and the concurrency limit.
import type { WorkflowRunState } from "../../_shims/protocol.js";

/**
 * Runs whose settings can change: live runs (new subagents and concurrency pick
 * the change up), and stopped or errored runs, whose resume or amend uses them.
 */
export function isWorkflowRunConfigurable(run: WorkflowRunState | undefined): boolean {
  if (run === undefined) return false;
  switch (run.status) {
    case "pending":
    case "running":
    case "errored":
      return true;
    case "stopped":
      return run.stopReason !== "superseded";
    default:
      return false;
  }
}

export function workflowRunSettingsCeiling(run: WorkflowRunState): number | undefined {
  return run.concurrencyCeiling ?? run.concurrency?.ceiling;
}

export function clampWorkflowRunSettingsBound(value: number, ceiling: number | undefined): number {
  const floor = Math.max(1, Math.floor(value));
  return ceiling === undefined ? floor : Math.min(floor, ceiling);
}
