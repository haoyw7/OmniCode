import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../../../shared/lib/queryClient";
import { workflowQueryScope } from "../../model/workflowQueryKeys";
import { resolveWorkspaceKey } from "../_shims/shared";
import type { IOmniCodeAgentService, OmniCodeAgentSavedWorkflowTarget } from "../_shims/services";
import { logger } from "../logger";

export function savedWorkflowsQuery(target: OmniCodeAgentSavedWorkflowTarget, service: IOmniCodeAgentService) {
  const workspace = target.scope === "global" && !target.workspacePath ? "global" : resolveWorkspaceKey({
    workspacePath: target.workspacePath ?? "", ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
  });
  return {
    queryKey: [...workflowQueryScope(service), "saved", target.scope ?? "project", workspace],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const [list, runs] = await Promise.all([
        service.listSavedWorkflows(target),
        service.listSavedWorkflowRuns({ ...target, limit: 50 }).then(result => result.runs).catch(error => {
          logger.warn("[savedWorkflows] Unable to load run history", { error: String(error) });
          return [];
        }),
      ]);
      signal.throwIfAborted();
      return { entries: list.workflows, invalid: list.invalid, runs, dir: list.dir };
    },
  };
}

export function useSavedWorkflows(target: OmniCodeAgentSavedWorkflowTarget, service: IOmniCodeAgentService, enabled = true) {
  const options = savedWorkflowsQuery(target, service);
  const read = useQuery({ ...options, enabled }, queryClient);
  const key = JSON.stringify(options.queryKey);
  const refresh = useCallback(async (_options?: { bypassCache?: boolean }) => {
    if (enabled) await invalidateAfterChange(JSON.parse(key));
  }, [key, enabled]);
  const errorCode = (read.error as { code?: unknown } | null)?.code;
  return { state: {
    entries: read.data?.entries ?? [], invalid: read.data?.invalid ?? [], runs: read.data?.runs ?? [], dir: read.data?.dir ?? null,
    loading: read.isFetching, loaded: read.isFetched, error: read.error ? String(read.error instanceof Error ? read.error.message : read.error) : null,
    errorCode: typeof errorCode === "number" ? errorCode : null,
  }, refresh, updatedAt: read.dataUpdatedAt };
}
