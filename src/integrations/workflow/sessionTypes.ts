// Session-facing workflow types shared by the Host, desktop and mobile.

import type { WorkflowAgentRuntime } from "./createWorkflow";
import type { CreateWorkflowCausalityGraph } from "./createWorkflow";

/** Per-run runtime configuration chosen at launch or retuned later. */
export type WorkflowRunSettings = {
  maxConcurrency?: number;
  /** Runtime for subagents whose persona does not choose one. */
  defaults?: WorkflowAgentRuntime;
  /** Per-subagent overrides keyed by the agent() name. */
  agents?: Record<string, WorkflowAgentRuntime>;
};

/** Where a run's script came from. */
export type WorkflowRunSource =
  | { kind: "inline" }
  | { kind: "saved"; name: string; scope: "project" | "global" }
  | { kind: "path" };

/**
 * A run card in the launching conversation. Live state lives in
 * `Session.workflowRuns`; this block anchors the card in the transcript and
 * carries the launch facts the card needs before the run's first event.
 */
export type WorkflowRunBlock = {
  runId: string;
  name: string;
  /** Who launched it: the conversation's agent, or the user from the sidebar. */
  launchedBy: "agent" | "user";
  source: WorkflowRunSource;
  /** Absolute path of the script file this run executes. */
  scriptPath?: string;
  /** Bounded causality graph from analysis, for the approval card and phase rail. */
  graph?: CreateWorkflowCausalityGraph;
  /** Commands world.run may execute, shown before the user approves the run. */
  commands?: string[];
  settings: WorkflowRunSettings;
  /** Approval state: runs an agent starts in a supervised conversation wait for the user. */
  approval?: "pending" | "approved" | "discarded";
  /** The run this one amends (its successor imports finished work from it). */
  amends?: string;
  /** Epoch ms when the run was submitted. */
  createdAt: number;
};
