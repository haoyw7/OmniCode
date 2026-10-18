// Monocode stand-in for ZCode's agent/file-watcher services: saved workflows are
// read and changed by the Host workflow service of the project's machine.
import { workflowGlobalRequest, workflowRequest } from "../../model/workflowClient";
import type {
  MonocodeSavedWorkflowMeta,
  MonocodeSavedWorkflowRun,
  MonocodeSavedWorkflowScope,
  MonocodeWorkflowsGetResult,
} from "./shared.js";
import type { SavedWorkflowEntry, SavedWorkflowInvalidEntry } from "../../../../integrations/workflow/savedWorkflow";

export interface MonocodeAgentWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type MonocodeAgentSavedWorkflowTarget =
  | (MonocodeAgentWorkspaceTarget & { scope?: MonocodeSavedWorkflowScope })
  | ({ scope: "global" } & Partial<MonocodeAgentWorkspaceTarget>);

type Failure = { ok: false; reason: string; path?: string; detail?: string };

export interface IMonocodeAgentService {
  listSavedWorkflows(target: MonocodeAgentSavedWorkflowTarget): Promise<{ workflows: SavedWorkflowEntry[]; invalid: SavedWorkflowInvalidEntry[]; dir: string }>;
  getSavedWorkflow(params: MonocodeAgentSavedWorkflowTarget & { name: string }): Promise<MonocodeWorkflowsGetResult>;
  updateSavedWorkflowMeta(params: MonocodeAgentSavedWorkflowTarget & { name: string; meta: MonocodeSavedWorkflowMeta }): Promise<{ ok: true; path: string } | Failure>;
  deleteSavedWorkflow(params: MonocodeAgentSavedWorkflowTarget & { name: string }): Promise<{ ok: true; path: string } | Failure>;
  listSavedWorkflowRuns(params: MonocodeAgentSavedWorkflowTarget & { name?: string; limit: number }): Promise<{ runs: MonocodeSavedWorkflowRun[]; truncated?: true }>;
  moveSavedWorkflow(params: MonocodeAgentWorkspaceTarget & { name: string }): Promise<{ ok: true; from: string; to: string } | Failure>;
}

export interface IFileWatcherService {
  watch(params: { path: string }): Promise<{ id: string }>;
  unwatch(params: { id: string }): Promise<void>;
  onDynamicChange(id: string): (listener: () => void) => { dispose(): void };
}

/** Project requests go to the project's Host; global ones without a project to this computer's Host. */
function request<T>(target: MonocodeAgentSavedWorkflowTarget, action: string, params: Record<string, unknown>): Promise<T> {
  const scope = target.scope ? { scope: target.scope } : {};
  return target.workspacePath
    ? workflowRequest<T>(target.workspacePath, action, { ...scope, ...params })
    : workflowGlobalRequest<T>(action, params);
}

export const monocodeAgentService: IMonocodeAgentService = {
  listSavedWorkflows: (target) => request(target, "saved.list", {}),
  getSavedWorkflow: (params) => request(params, "saved.get", { name: params.name }),
  updateSavedWorkflowMeta: (params) => request(params, "saved.updateMeta", { name: params.name, meta: params.meta }),
  deleteSavedWorkflow: (params) => request(params, "saved.delete", { name: params.name }),
  listSavedWorkflowRuns: (params) => request(params, "saved.runs", { limit: params.limit, ...(params.name ? { name: params.name } : {}) }),
  moveSavedWorkflow: (params) => workflowRequest(params.workspacePath, "saved.move", { name: params.name }),
};

/** Monocode refreshes the hub on open and on demand instead of watching folders. */
export const noFileWatcher: IFileWatcherService = {
  watch: () => Promise.reject(new Error("Folder watching is not available")),
  unwatch: () => Promise.resolve(),
  onDynamicChange: () => () => ({ dispose: () => {} }),
};
