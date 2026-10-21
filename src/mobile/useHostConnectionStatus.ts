import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { mobileSourceKey } from "./mobileQueries";
import type { MobileClient } from "./client";

export function useHostConnectionStatus(client: MobileClient, connected: boolean, foreground: boolean) {
  const status = useSyncExternalStore(client.subscribeConnectionStatus, client.getConnectionStatus, client.getConnectionStatus);
  useQuery({
    queryKey: ["mobile", "connectionHeartbeat", mobileSourceKey(client), client.connection?.endpoint],
    enabled: connected && foreground, refetchInterval: 5000, gcTime: 0, notifyOnChangeProps: [],
    queryFn: async () => {
      if (client.getConnectionStatus().state === "failed") await client.reconnect();
      else if (client.getConnectionStatus().state === "connected") await client.verify();
      return null;
    },
  }, queryClient);
  return status;
}
