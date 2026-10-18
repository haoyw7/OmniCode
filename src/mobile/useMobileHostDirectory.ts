import { useEffect, useMemo, useState } from "react";
import type {
  HostProject,
  HostSessionSummary,
} from "../features/connections/model/protocol";
import type { Connection, MobileClient } from "./client";
import { connectionDisplayName } from "./connectionAppearance";

/** Another paired device's lists, read without making it the active Host. */
export interface MobileRemoteHost {
  endpoint: string;
  name: string;
  projects: HostProject[];
  sessions: HostSessionSummary[];
  failed: boolean;
}

const POLL_MS = 10_000;

/** Polls every enabled, inactive paired device while Home shows all devices. */
export function useMobileHostDirectory(
  client: Pick<MobileClient, "peekProjects" | "peekSessions">,
  connections: readonly Connection[],
  activeEndpoint: string | undefined,
  enabled: boolean,
): MobileRemoteHost[] {
  const [hosts, setHosts] = useState<Record<string, MobileRemoteHost>>({});
  const targets = connections.filter((item) => item.endpoint !== activeEndpoint && !item.disabled);
  const targetsKey = JSON.stringify(targets.map((item) => [item.endpoint, item.environmentId, item.token, item.name]));
  useEffect(() => {
    if (!enabled) return;
    const list: Connection[] = targets;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async (connection: Connection): Promise<MobileRemoteHost> => {
      const projects = await client.peekProjects(connection);
      const histories = await Promise.allSettled(
        projects.map((project) => client.peekSessions(connection, project.id)),
      );
      return {
        endpoint: connection.endpoint,
        name: connection.name,
        projects,
        sessions: histories.flatMap((result) => result.status === "fulfilled" ? result.value : []),
        failed: histories.some((result) => result.status === "rejected"),
      };
    };
    const refresh = async () => {
      const results = await Promise.allSettled(list.map(load));
      if (!live) return;
      setHosts((current) => {
        const next: Record<string, MobileRemoteHost> = {};
        results.forEach((result, index) => {
          const endpoint = list[index].endpoint;
          next[endpoint] = result.status === "fulfilled"
            ? result.value
            : { ...(current[endpoint] ?? { endpoint, name: list[index].name, projects: [], sessions: [] }), failed: true };
        });
        return next;
      });
      timer = setTimeout(refresh, POLL_MS);
    };
    void refresh();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `targetsKey` captures every field of `targets` the requests use.
  }, [client, targetsKey, enabled]);
  return useMemo(() => {
    if (!enabled) return [];
    const entries: string[][] = JSON.parse(targetsKey);
    return entries.flatMap(([endpoint, , , name]) => hosts[endpoint]
      ? [{ ...hosts[endpoint], name: connectionDisplayName(endpoint) || name }]
      : []);
  }, [enabled, targetsKey, hosts]);
}
