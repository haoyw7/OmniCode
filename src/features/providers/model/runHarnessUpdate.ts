import { inspectHarnessBinary, updateHarnessCli } from "./hostProviderRuntime";
import { compareSemver, parseOpenCodeVersion } from "../../../integrations/harness/providers/opencode/opencodeProtocol";
import { refreshHostModelCatalogs } from "./hostModelCatalog";
import { announceHarnessUpdated, type HarnessUpdate } from "./harnessUpdates";
import { harnessUpdateError } from "./harnessUpdateErrors";

export type HarnessUpdateState =
  | { status: "idle" }
  | { status: "updating" }
  | { status: "updated"; version: string }
  | { status: "failed"; error: string };

/**
 * Some updaters exit cleanly without installing anything, so success is the
 * version the CLI reports afterwards, not the exit code. Its models are
 * reloaded before the row says so, so the picker is current by then.
 */
export async function runHarnessUpdate(
  update: HarnessUpdate,
): Promise<HarnessUpdateState> {
  try {
    await updateHarnessCli(update.harness);
    const after = await inspectHarnessBinary(update.harness);
    const version = parseOpenCodeVersion(after.version ?? "");
    if (version && compareSemver(version, update.latest) >= 0) {
      await refreshHostModelCatalogs([update.harness], { force: true });
      void announceHarnessUpdated(update.harness).catch(() => undefined);
      return { status: "updated", version };
    }
    return {
      status: "failed",
      error: `Still on ${version ?? update.installed} after updating.`,
    };
  } catch (error) {
    return {
      status: "failed",
      error: harnessUpdateError(error),
    };
  }
}

