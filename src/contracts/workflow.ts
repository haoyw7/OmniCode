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

export type WorkflowAgentRuntime = {
  provider?: string | undefined;
  model?: string | undefined;
  thinking?: string | undefined;
  speed?: string | undefined;
  modelSettings?: Record<string, string> | undefined;
};

export type CreateWorkflowCausalityGraph = {
  steps: {
    id: string;
    kind: "ask" | "world-read";
    label: string;
    lane: string;
    labelPattern?:
      { head?: string | undefined; tail?: string | undefined } | undefined;
    line?: number | undefined;
    column?: number | undefined;
    lanes?: string[] | undefined;
    source?: string | undefined;
    phase?: string | undefined;
    repeat?: "stack" | "serial" | undefined;
  }[];
  lanes: {
    id: string;
    name?: string | undefined;
    namePattern?:
      { head?: string | undefined; tail?: string | undefined } | undefined;
    line?: number | undefined;
    column?: number | undefined;
  }[];
  participants: {
    id: string;
    phase: string;
    lane: string;
    steps: string[];
    member?: { index: number; of: number } | undefined;
    many?: true | undefined;
  }[];
  handoffs: {
    from: string;
    to: string;
    back?: true | undefined;
    types?: string[] | undefined;
  }[];
  phases?:
    | {
        id: string;
        name?: string | undefined;
        line?: number | undefined;
        column?: number | undefined;
        alongside?: string[] | undefined;
      }[]
    | undefined;
  phaseEdges?:
    { from: string; to: string; back?: true | undefined }[] | undefined;
  exits?: string[] | undefined;
  sink?: string[] | undefined;
  truncated?: boolean | undefined;
};

export type WorkflowRunsState = {
  revision: number;
  runs: {
    runId: string;
    status: "pending" | "running" | "completed" | "errored" | "stopped";
    usage: {
      spentTokens: number;
      nodesUsed: number;
      nodesUnlisted?: number | undefined;
      nodesUnlistedSettled?: number | undefined;
    };
    actors: {
      siteId: string;
      ordinal: number;
      status: "running" | "completed" | "waiting";
      name?: string | undefined;
      sessionId?: string | undefined;
      phaseName?: string | undefined;
      runtime?: { harness: string; model: string; label: string } | undefined;
    }[];
    nodes: {
      siteId: string;
      ordinal: number;
      phase:
        | "waiting"
        | "queued"
        | "dispatched"
        | "executing"
        | "repairing"
        | "nudged"
        | "settled";
      kind?: "ask" | "world-read" | undefined;
      outcome?: "ok" | "failed" | "cancelled" | undefined;
      cached?: boolean | undefined;
      actorSiteId?: string | undefined;
      actorOrdinal?: number | undefined;
      phaseName?: string | undefined;
      instructionsHead?: string | undefined;
      turn?: number | undefined;
      toolCalls?: number | undefined;
      lastTool?: { name: string; target?: string | undefined } | undefined;
    }[];
    lastEventSequence: number;
    toolCallId?: string | undefined;
    stopReason?:
      "provider" | "model" | "user" | "interrupted" | "superseded" | undefined;
    resumedFrom?: string | undefined;
    supersededBy?: string | undefined;
    error?: string | undefined;
    resumable?: true | undefined;
    resultPreview?: string | undefined;
    reports?:
      | {
          siteId: string;
          ordinal: number;
          preview: string;
          artifactId?: string | undefined;
        }[]
      | undefined;
    pendingQuestions?:
      | {
          qid: string;
          question: string;
          actorSiteId?: string | undefined;
          actorOrdinal?: number | undefined;
          actorName?: string | undefined;
          context?: string | undefined;
          askedAt?: number | undefined;
        }[]
      | undefined;
    concurrency?:
      | {
          cap: number;
          ceiling: number;
          key?: string | undefined;
          limit?: number | undefined;
          cooldownMs?: number | undefined;
        }
      | undefined;
    concurrencyCeiling?: number | undefined;
    subagentModel?: string | undefined;
    artifacts?:
      | {
          id: string;
          kind: "file" | "markdown" | "chart" | "table" | "metrics" | "board";
          version: number;
          title?: string | undefined;
          contentType?: string | undefined;
          bytes?: number | undefined;
          itemCount?: number | undefined;
          primary?: true | undefined;
        }[]
      | undefined;
    phases?: { name: string; rounds: number }[] | undefined;
    currentPhase?: string | undefined;
    phaseNames?: string[] | undefined;
    phaseAlongside?: number[][] | undefined;
    unlistedByPhase?:
      | {
          actors: number;
          settled: number;
          phaseName?: string | undefined;
          actorsSettled?: number | undefined;
          actorsFailed?: number | undefined;
        }[]
      | undefined;
    truncated?: boolean | undefined;
  }[];
};
