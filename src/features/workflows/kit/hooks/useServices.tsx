// Monocode shim: the services ZCode's saved-workflow hub reads.
import { monocodeAgentService, noFileWatcher } from "../_shims/services.js";

export function useServices() {
  return { workflowAgentService: monocodeAgentService, fileWatcherService: noFileWatcher };
}
