// Monocode shim: the workspace a workflow pane reads from.
export type PaneWorkspaceScope = {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
};
