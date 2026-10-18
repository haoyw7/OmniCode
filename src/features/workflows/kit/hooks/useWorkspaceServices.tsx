// Monocode shim: every project's saved workflows go through its Host.
import { monocodeAgentService, noFileWatcher } from "../_shims/services.js";

export function useWorkspaceServicesResolution(_workspacePath: string, remoteSessionId: string | null, _workspaceIdentity?: string, _remoteTarget?: unknown) {
  return { services: { workflowAgentService: monocodeAgentService, fileWatcherService: noFileWatcher }, rpcReady: true, remoteSessionId: remoteSessionId ?? null };
}
