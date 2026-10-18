// Desktop/mobile access to the Host workflow service (`workflows.request`).

import { remoteMachineFor, remoteRequest } from "../../connections/model/connections";
import { remoteProjectFor, sharedHostMachineId } from "../../connections/model/remoteProjects";
import type { WorkflowAgentRuntime } from "../../../integrations/workflow/createWorkflow";
import type { WorkflowRunSettings } from "../../../integrations/workflow/sessionTypes";

export type WorkflowRpc = <T>(action: string, params?: Record<string, unknown>) => Promise<T>;

/** The Host owning a folder: the local shared Host, or the machine of a remote project. */
export async function workflowRpcFor(cwd: string): Promise<WorkflowRpc> {
  const project = remoteProjectFor(cwd);
  if (!project) throw new Error("Workflows need this project to run on a OmniCode Host");
  const machine = await remoteMachineFor(project.environmentId);
  if (!machine) throw new Error("Connect this project's machine to use workflows");
  return <T>(action: string, params: Record<string, unknown> = {}) =>
    remoteRequest<T>(machine.id, "workflows.request", { action, ...params });
}

/** A workflow request scoped to a project folder on its Host. */
export async function workflowRequest<T>(cwd: string, action: string, params: Record<string, unknown> = {}): Promise<T> {
  const project = remoteProjectFor(cwd);
  const rpc = await workflowRpcFor(cwd);
  return rpc<T>(action, { workspacePath: project?.cwd ?? cwd, ...params });
}

/** A request to this computer's shared Host, for global (not project) saved workflows. */
export async function workflowGlobalRequest<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const machineId = sharedHostMachineId();
  if (!machineId) throw new Error("Global workflows need the OmniCode Host on this computer");
  return remoteRequest<T>(machineId, "workflows.request", { action, scope: "global", ...params });
}

export type WorkflowStartInput = {
  name?: string;
  script?: string;
  saved?: { name: string; scope?: "project" | "global"; args?: Record<string, unknown> };
  path?: string;
  args?: Record<string, unknown>;
  maxConcurrency?: number;
  defaults?: WorkflowAgentRuntime;
  agents?: Record<string, WorkflowAgentRuntime>;
};

export type WorkflowStartResult =
  | { ok: false; reason: string; message: string; diagnostics?: string[]; scriptPath?: string }
  | { ok: true; runId: string; status: "running" | "awaiting_approval"; scriptPath?: string };

export const workflowActions = {
  start: (cwd: string, sessionId: string, input: WorkflowStartInput) =>
    workflowRequest<WorkflowStartResult>(cwd, "start", { sessionId, input }),
  approve: (cwd: string, runId: string) => workflowRequest<{ runId: string }>(cwd, "approve", { runId }),
  discard: (cwd: string, runId: string) => workflowRequest<{ runId: string }>(cwd, "discard", { runId }),
  cancel: (cwd: string, runId: string) => workflowRequest<{ ok: true; status: string }>(cwd, "cancel", { runId }),
  resume: (cwd: string, runId: string) =>
    workflowRequest<{ ok: true; runId: string } | { ok: false; reason: string; message: string }>(cwd, "resume", { runId }),
  retune: (cwd: string, runId: string, change: { maxConcurrency?: number | null; defaults?: WorkflowAgentRuntime | null; agents?: Record<string, WorkflowAgentRuntime> | null }) =>
    workflowRequest<WorkflowRunSettings>(cwd, "retune", { runId, ...change }),
  get: <T = Record<string, unknown>>(cwd: string, runId: string) => workflowRequest<T>(cwd, "get", { runId }),
  script: (cwd: string, runId: string) => workflowRequest<{ script: string; scriptPath?: string }>(cwd, "script", { runId }),
  nodeResult: (cwd: string, runId: string, siteId: string, ordinal: number) =>
    workflowRequest<{ status: string; kind: string; result?: unknown; error?: { message: string } }>(cwd, "nodeResult", { runId, siteId, ordinal }),
  artifact: (cwd: string, uri: string) => workflowRequest<{ contentType: string; base64: string } | null>(cwd, "artifact", { uri }),
  events: (cwd: string, runId: string, after?: number) =>
    workflowRequest<{ sequence: number; timeCreated?: number; event: Record<string, unknown> & { type: string } }[]>(cwd, "events", { runId, ...(after === undefined ? {} : { after }) }),
  providers: (cwd: string) =>
    workflowRequest<{ providers: { provider: string; models: { id: string; name: string; thinking?: string[]; speed?: string[] }[] }[] }>(cwd, "providers"),
  ceiling: (cwd: string) => workflowRequest<{ ceiling: number }>(cwd, "ceiling"),
};
