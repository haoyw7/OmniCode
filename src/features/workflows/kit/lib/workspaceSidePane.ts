// Side-pane tab and open-request types from ZCode (Apache-2.0)
// packages/ui/src/lib/workspaceSidePane.ts; OmniCode opens these as editor-pane tabs.
import type { WorkflowAgentAvatar } from "../../model/workflowAgentAvatar";
import type { WorkflowRunArtifactKind } from "../_shims/protocol";
type WorkspaceScope = { workspacePath: string; workspaceIdentity?: string; remoteSessionId?: string };

export interface WorkflowRunSidePaneTab extends WorkspaceScope {
  id: string;
  type: "workflow-run";
  ownerTaskId?: string | null;
  openedAt?: number;
  workspaceKey: string;
  parentSessionId: string;
  toolCallId: string;
  runId: string;
  workflowName?: string;
  focusPhaseId?: string;
}

export interface OpenWorkflowRunSideTabRequest {
  parentSessionId: string;
  toolCallId: string;
  runId: string;
  workflowName?: string;
  phaseId?: string;
  replaceRunId?: string;
}

export interface OpenWorkflowActorSessionSideTabRequest {
  avatar?: WorkflowAgentAvatar;
  parentSessionId: string;
  runId: string;
  actorSessionId?: string;
  siteId: string;
  ordinal: number;
  actorName?: string;
}

export interface OpenWorkflowArtifactSideTabRequest {
  kind?: WorkflowRunArtifactKind;
  parentSessionId: string;
  runId: string;
  artifactId: string;
  version?: number;
  title?: string;
  contentType?: string;
  sourcePath?: string;
}

export interface OpenWorkflowWorkspaceSideTabRequest {
  parentSessionId: string;
  toolCallId: string;
  runId: string;
  workflowName?: string;
  phaseId?: string;
}

export type OpenScopedWorkflowRunSideTabRequest = OpenWorkflowRunSideTabRequest & WorkspaceScope;
export type OpenScopedWorkflowActorSessionSideTabRequest = OpenWorkflowActorSessionSideTabRequest & WorkspaceScope;
export type OpenScopedWorkflowArtifactSideTabRequest = OpenWorkflowArtifactSideTabRequest & WorkspaceScope;
export type OpenScopedWorkflowWorkspaceSideTabRequest = OpenWorkflowWorkspaceSideTabRequest & WorkspaceScope;
