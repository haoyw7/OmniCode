import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { mobileProbeQuery } from "./mobileQueries";
import type { Connection, HostConnectionStatus } from "./client";

/** Probes a saved device that is not the active one while enabled. */
export function useProbedHostStatus(connection: Connection, enabled: boolean, probe: (connection: Connection) => Promise<HostConnectionStatus>): HostConnectionStatus {
  const result = useQuery({ ...mobileProbeQuery(connection, probe), enabled, refetchInterval: enabled && !connection.disabled ? 5000 : false }, queryClient);
  return result.isError ? { state: "failed" } : result.data ?? { state: connection.disabled ? "disconnected" : "reconnecting" };
}
