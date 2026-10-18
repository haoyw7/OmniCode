import { describe, expect, it } from "vitest";
import { reduceWorkflowRunsState } from "./workflow-runs-reducer";
import type { WorkflowRunNode, WorkflowRunsState } from "./workflow-runs";

describe("workflow terminal projection", () => {
  it.each(["stopped", "errored", "completed"] as const)("settles unfinished nodes on %s without changing recorded outcomes", status => {
    const phases: WorkflowRunNode["phase"][] = ["queued", "dispatched", "executing", "waiting", "repairing", "nudged"];
    const previous: WorkflowRunsState = {
      revision: 1,
      runs: [{
        runId: "run", status: "running", lastEventSequence: 5,
        usage: { spentTokens: 120, nodesUsed: 9 },
        actors: [{ siteId: "agent", ordinal: 0, status: "running" }],
        nodes: [
          ...phases.map((phase, ordinal) => ({ siteId: "ask", ordinal, actorSiteId: "agent", actorOrdinal: 0, phase })),
          ...(["ok", "failed", "cancelled"] as const).map((outcome, ordinal) => ({ siteId: "finished", ordinal, phase: "settled" as const, outcome })),
        ],
      }],
    };
    const envelope = { runId: "run", eventType: "run-settled", sequence: 6, payload: { status, ...(status === "stopped" ? { stopReason: "interrupted", resumable: true } : {}) } };
    const next = reduceWorkflowRunsState(previous, envelope)!;
    expect(next.runs[0].nodes.slice(0, phases.length)).toEqual(phases.map((_, ordinal) => ({
      siteId: "ask", ordinal, actorSiteId: "agent", actorOrdinal: 0,
      phase: "settled", outcome: status === "errored" ? "failed" : "cancelled",
    })));
    expect(next.runs[0].nodes.slice(phases.length)).toEqual(previous.runs[0].nodes.slice(phases.length));
    expect(next.runs[0].actors[0].status).toBe("completed");
    expect(next.runs[0].usage).toEqual(previous.runs[0].usage);
    expect(previous.runs[0].nodes.slice(0, phases.length).map(node => node.phase)).toEqual(phases);
    expect(reduceWorkflowRunsState(next, envelope)).toBeNull();
    const resumed = reduceWorkflowRunsState(next, { runId: "run", eventType: "run-started", sequence: 7, payload: {} })!;
    const executing = reduceWorkflowRunsState(resumed, { runId: "run", eventType: "node-executing", sequence: 8, payload: { instance: { siteId: "ask", ordinal: 0 } } })!;
    expect(executing.runs[0].status).toBe("running");
    expect(executing.runs[0].nodes.find(node => node.siteId === "ask" && node.ordinal === 0)?.phase).toBe("executing");
  });
});
