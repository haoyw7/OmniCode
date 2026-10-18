// OmniCode stand-in for `@zcode/shared`: the test ids and saved-workflow types the
// ported workflow UI reads.
import type { SavedWorkflowArgType, SavedWorkflowArgsDeclaration, SavedWorkflowEntry, SavedWorkflowMeta } from "../../../../integrations/workflow/savedWorkflow";

export const TID_CHAT_WORKFLOW_RUN_DIGEST = "workflow-run-digest";
export const TID_WORKFLOWS_CREATE_VIA_CHAT = "workflows-create-via-chat";
export const TID_WORKFLOWS_EMPTY = "workflows-empty";
export const TID_WORKFLOWS_LIST = "workflows-list";
export const TID_WORKFLOWS_REFRESH = "workflows-refresh";
export const TID_WORKFLOW_ACTION_DELETE = "workflow-action-delete";
export const TID_WORKFLOW_ACTION_MOVE = "workflow-action-move";
export const TID_WORKFLOW_ARTIFACTS_SECTION = "workflow-run-artifacts";
export const TID_WORKFLOW_ARTIFACTS_TOGGLE = "workflow-run-artifacts-toggle";
export const TID_WORKFLOW_ARTIFACT_CARD = "workflow-run-artifact-card";
export const TID_WORKFLOW_ARTIFACT_CHIP = "workflow-run-artifact-chip";
export const TID_WORKFLOW_CARD = "workflow-card";
export const TID_WORKFLOW_CARD_MENU = "workflow-card-menu";
export const TID_WORKFLOW_CARD_RUN = "workflow-card-run";
export const TID_WORKFLOW_DETAIL = "workflow-detail";
export const TID_WORKFLOW_DETAIL_DESCRIPTION = "workflow-detail-description";
export const TID_WORKFLOW_DETAIL_MENU = "workflow-detail-menu";
export const TID_WORKFLOW_DETAIL_RUN = "workflow-detail-run";
export const TID_WORKFLOW_DETAIL_SCRIPT = "workflow-detail-script";
export const TID_WORKFLOW_DETAIL_TAB = "workflow-detail-tab";
export const TID_WORKFLOW_DETAIL_WHEN_TO_USE = "workflow-detail-when-to-use";
export const TID_WORKFLOW_GLOBAL_GROUP = "workflow-global-group";
export const TID_WORKFLOW_LAUNCH_ARG = "workflow-launch-arg";
export const TID_WORKFLOW_LAUNCH_DIALOG = "workflow-launch-dialog";
export const TID_WORKFLOW_LAUNCH_ERROR = "workflow-launch-error";
export const TID_WORKFLOW_LAUNCH_SUBMIT = "workflow-launch-submit";
export const TID_WORKFLOW_LAUNCH_TARGET = "workflow-launch-target";
export const TID_WORKFLOW_META_DISCARD = "workflow-meta-discard";
export const TID_WORKFLOW_META_SAVE = "workflow-meta-save";
export const TID_WORKFLOW_MOVE_DIALOG = "workflow-move-dialog";
export const TID_WORKFLOW_MOVE_DIALOG_SUBMIT = "workflow-move-dialog-submit";
export const TID_WORKFLOW_MOVE_DIALOG_TARGET = "workflow-move-dialog-target";
export const TID_WORKFLOW_PROJECT_GROUP = "workflow-project-group";
export const TID_WORKFLOW_RUN_ROW = "workflow-run-row";

export function testId(base: string, suffix: string): string {
  return `${base}-${suffix}`;
}

export function resolveWorkspaceKey(params: { workspacePath: string; workspaceIdentity?: string }): string {
  return params.workspaceIdentity?.trim() || params.workspacePath;
}

export type OmniCodeSavedWorkflowArgType = SavedWorkflowArgType;
export type OmniCodeSavedWorkflowArgsDeclaration = SavedWorkflowArgsDeclaration;
export type OmniCodeSavedWorkflowMeta = SavedWorkflowMeta;
export type OmniCodeSavedWorkflowEntry = SavedWorkflowEntry;
export type OmniCodeSavedWorkflowScope = SavedWorkflowEntry["scope"];

export type OmniCodeSavedWorkflowRunStatus = "pending" | "running" | "completed" | "errored" | "stopped";

export type OmniCodeSavedWorkflowRun = {
  runId: string;
  name?: string;
  status: OmniCodeSavedWorkflowRunStatus;
  stopReason?: "user" | "model" | "provider" | "interrupted" | "superseded";
  createdAt: number;
  updatedAt: number;
  spentTokens: number;
  parentSessionId?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  cwd?: string;
  artifacts?: { id: string; kind: "file" | "markdown" | "chart" | "table" | "metrics" | "board"; title?: string; version: number; contentType?: string }[];
};

export type OmniCodeWorkflowsGetResult =
  | { ok: true; name: string; path: string; scope: OmniCodeSavedWorkflowScope; meta: OmniCodeSavedWorkflowMeta; script: string }
  | { ok: false; reason: "invalid_name" | "not_found" | "parse_error" | "read_error"; path?: string; detail?: string };

/** The permission request a workflow approval card renders. */
export interface OmniCodePermissionRequest {
  type: "permission_request";
  taskId: string;
  requestId: string;
  description: string;
  kind: string;
  title?: string;
  options: { optionId: string; name: string; kind: string }[];
  /** The tool input (ZCode: CreateWorkflow / AmendWorkflow input). */
  raw?: unknown;
  display?: { kind: "create_workflow"; causalityGraph?: import("../../../../integrations/workflow/protocol/create-workflow-display").ToolCallCreateWorkflowCausalityGraph };
}
