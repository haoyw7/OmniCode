import { invoke } from "@tauri-apps/api/core";
import { Orchestrator, type OrchestrationStorage } from "./orchestrationRuntime";
import { normalizeOrchestrationRun, type OrchestrationRun } from "./orchestrationState";

export * from "./orchestrationRuntime";
const storage: OrchestrationStorage = {
  save: (run) => invoke("control_save", { leadId: run.leadId, state: JSON.stringify(run) }),
  load: async (id) => {
    const raw = await invoke<string | null>("control_load", { leadId: id });
    if (!raw) return null;
    const run = JSON.parse(raw) as OrchestrationRun;
    if ((run.version !== 1 && run.version !== 2) || run.leadId !== id || !Array.isArray(run.tasks))
      throw new Error("Unsupported orchestration history");
    return normalizeOrchestrationRun(run);
  },
  enable: (sessionId, cwd) => invoke("control_enable", { sessionId, cwd }),
  disable: (sessionId) => invoke("control_disable", { sessionId }),
  scopes: (cwd, files) => invoke("control_scopes", { cwd, files }),
  resolvePath: (path) => invoke("control_write_path", { path }),
};
export const orchestrator = new Orchestrator(storage);
