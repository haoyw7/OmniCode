import { useQueries } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { mobileHostDirectoryQuery } from "./mobileQueries";
import type { HostProject, HostSessionSummary } from "../features/connections/model/protocol";
import type { Connection, MobileClient } from "./client";
import { connectionDisplayName } from "./connectionAppearance";

export interface MobileRemoteHost {
  endpoint: string;
  name: string;
  projects: HostProject[];
  sessions: HostSessionSummary[];
  failed: boolean;
}
export function useMobileHostDirectory(client: Pick<MobileClient, "peekProjects" | "peekSessions">, connections: readonly Connection[], activeEndpoint: string | undefined, enabled: boolean): MobileRemoteHost[] {
  const targets = connections.filter(item => item.endpoint !== activeEndpoint && !item.disabled);
  const results = useQueries({ queries: targets.map(connection => ({
    ...mobileHostDirectoryQuery(client, connection), enabled, refetchInterval: enabled ? 10000 : false as const,
  })) }, queryClient);
  if (!enabled) return [];
  return results.flatMap((result, index) => {
    const connection = targets[index];
    if (!result.data && !result.isError) return [];
    return [{ ...(result.data ?? { endpoint: connection.endpoint, projects: [], sessions: [], failed: false }),
      name: connectionDisplayName(connection.endpoint) || connection.name, failed: result.isError || !!result.data?.failed,
    }];
  });
}
