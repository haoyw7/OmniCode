// OmniCode shim: the services ZCode's saved-workflow hub reads.
import { omnicodeAgentService, noFileWatcher } from "../_shims/services.js";

export function useServices() {
  return { workflowAgentService: omnicodeAgentService, fileWatcherService: noFileWatcher };
}
