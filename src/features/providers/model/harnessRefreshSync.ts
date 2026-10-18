import { useEffect } from "react";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import { onHarnessesRefreshed, onHarnessUpdated } from "./harnessUpdates";

/**
 * Every window (workspace windows and the Quick Composer) keeps its own
 * availability and model stores, so a refresh or self-update run in one
 * window has to be replayed in the others for their model pickers to follow.
 */
export function useHarnessRefreshSync(): void {
  useEffect(() => {
    const stops = [
      onHarnessUpdated((harness) => {
        void refreshHarnessCatalogs([harness], { force: true });
      }),
      onHarnessesRefreshed(async (harnesses) => {
        await probeHarnessAvailability({ force: true });
        await refreshHarnessCatalogs(
          harnesses.filter((harness) => isHarnessAvailable(harness)),
          { force: true },
        );
      }),
    ].map((stop) => stop.catch(() => undefined));
    return () => {
      for (const stop of stops) void stop.then((unlisten) => unlisten?.());
    };
  }, []);
}
