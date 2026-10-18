import { useEffect, useSyncExternalStore } from "react";
import type { MobileClient } from "./client";

export function useHostConnectionStatus(
  client: MobileClient,
  connected: boolean,
  foreground: boolean,
) {
  const status = useSyncExternalStore(
    client.subscribeConnectionStatus,
    client.getConnectionStatus,
    client.getConnectionStatus,
  );
  const endpoint = client.connection?.endpoint;
  useEffect(() => {
    if (!connected || !foreground) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        if (client.getConnectionStatus().state === "failed")
          await client.reconnect();
        else if (client.getConnectionStatus().state === "connected") await client.verify();
      } catch {
        // The client reports the failure; retry without replacing the user's task error.
      } finally {
        if (live) timer = setTimeout(check, 5000);
      }
    };
    void check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, connected, foreground, endpoint]);
  return status;
}
