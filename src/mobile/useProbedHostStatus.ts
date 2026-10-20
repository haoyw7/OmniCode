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
    let timer: ReturnType<typeof setTimeout>;
    setObserved({ state: connection.disabled ? "disconnected" : "reconnecting" });
    const check = async () => {
      try {
        const value = await probe(connection);
        if (live) setObserved(value);
      } catch {
        if (live) setObserved({ state: "failed" });
      } finally {
        if (live && !connection.disabled) timer = setTimeout(check, 5000);
      }
    };
    void check();
    return () => { live = false; clearTimeout(timer); };
  }, [enabled, connection, probe]);
  return observed;
}
