import { createContext } from "react";
import type { OrchestrationProposal, HarnessId } from "../../../contracts/session";

import type { HostWorkerReference, OrchestrationReadRun } from "./orchestrationClient";
import { hostOrchestrationRuntime } from "./hostOrchestrationRuntime";

export type OrchestrationWorkerDetail = {
  sessionId: string;
  leadId: string;
  title: string;
  harness: HarnessId;
  host?: HostWorkerReference;
};

/**
 * The lead's sidebar card lists workers. Approvals still go to the lead, not
 * to the user; `openDetails` is the one way to watch a worker's transcript.
 */
export const OrchestrationWorkers = createContext<{
  selectedId: string | null;
  inspect(sessionId: string | null): void;
  /**
   * Open this worker beside its lead, for when the card's model line is not
   * enough. Absent wherever the card renders without a workspace behind it.
   */
  openDetails?(worker: OrchestrationWorkerDetail): void;
}>({ selectedId: null, inspect: () => {} });

// Shared by transcript cards in both ordinary and split session panes.
export const OrchestrationActions = createContext<{
  canControl?: boolean;
  update(
    leadId: string,
    blockId: string,
    proposal: OrchestrationProposal,
  ): void;
  confirm(leadId: string, blockId: string): Promise<void>;
  retry(leadId: string, blockId: string): void;
  reload?(leadId: string, blockId: string): void;
  open(sessionId: string): void;
  /** Open every worker of a run as tabs beside the lead, not sidebar rows. */
  openAgents?(workers: OrchestrationWorkerDetail[]): void;
} | null>(null);

/** Read and control a run through its owner; clients never execute a scheduler. */
export type OrchestrationRuntime = {
  subscribe(listener: () => void): () => void;
  snapshot(): readonly OrchestrationReadRun[];
  hydrate(leadId: string): Promise<unknown>;
  resumeBlocker(leadId: string): { id: string; title: string } | undefined;
  resumeLeadBusy(leadId: string): boolean;
  resume(leadId: string): Promise<void>;
  stop(leadId: string): Promise<void>;
  cancelTask(leadId: string, taskId: string): Promise<void>;
};
export const OrchestrationRuntimeContext = createContext<OrchestrationRuntime>(hostOrchestrationRuntime);
