import { useEffect, useState } from "react";
import type { Connection, HostConnectionStatus } from "./client";

/** Probes a saved device that is not the active one while `enabled`. */
export function useProbedHostStatus(
  connection: Connection,
  enabled: boolean,
  probe: (connection: Connection) => Promise<HostConnectionStatus>,
): HostConnectionStatus {
  const [observed, setObserved] = useState<HostConnectionStatus>({ state: "reconnecting" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setObserved({ state: connection.disabled ? "disconnected" : "reconnecting" });
    void probe(connection).then((value) => { if (live) setObserved(value); })
      .catch(() => { if (live) setObserved({ state: "failed" }); });
    return () => { live = false; };
  }, [enabled, connection, probe]);
  return observed;
}
