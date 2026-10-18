// OmniCode shim: every project's saved workflows go through its Host.
import { omnicodeAgentService, noFileWatcher } from "../_shims/services.js";

export function useWorkspaceServicesResolution(_workspacePath: string, remoteSessionId: string | null, _workspaceIdentity?: string, _remoteTarget?: unknown) {
  return { services: { workflowAgentService: omnicodeAgentService, fileWatcherService: noFileWatcher }, rpcReady: true, remoteSessionId: remoteSessionId ?? null };
}
