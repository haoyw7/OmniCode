import { queryOptions } from "@tanstack/react-query";
import { listAutomationRuns } from "./automations";

export const automationKeys = {
  all: ["automations"] as const,
  list: ["automations", "list"] as const,
  runs: (id: string | null) => ["automations", "runs", id] as const,
};
export const automationRunsQuery = (id: string | null) => queryOptions({
  queryKey: automationKeys.runs(id),
  queryFn: () => listAutomationRuns(id!),
  enabled: !!id,
});
