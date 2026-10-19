import { useSyncExternalStore } from "react";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { inspectHarnessBinary } from "../../../integrations/harness/core/child";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import { installLocalHarness } from "../../../platform/tauri/harnessInstall";
import { IS_WIN } from "../../../platform/tauri/platform";
import { translate } from "../../../shared/i18n/language";
import type { HarnessId } from "../../sessions/model/session";
import { announceHarnessesRefreshed } from "./harnessUpdates";

type InstallState =
  | { status: "idle" }
  | { status: "installing" }
  | { status: "installed" }
  | { status: "failed"; error: string };

const idle: InstallState = { status: "idle" };
let states: Partial<Record<HarnessId, InstallState>> = {};
const listeners = new Set<() => void>();
let pending: Promise<void> | undefined;

function setState(harness: HarnessId, state: InstallState): void {
  states = { ...states, [harness]: state };
  for (const listener of listeners) listener();
}

export function harnessInstallUnavailableReason(harness: HarnessId): string | null {
  if (harness === "antigravity") {
    return IS_WIN
      ? "The Antigravity ACP server is not available on Windows."
      : "Install the Antigravity app to use its bundled ACP server.";
  }
  if (harness === "fx" && IS_WIN) {
    return "Automatic installation of fx is available on macOS and Linux only.";
  }
  return null;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getSnapshot = () => states;

/** Keep progress across settings navigation and prevent overlapping installs. */
export function useHarnessInstall(harness: HarnessId) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    state: snapshot[harness] ?? idle,
    busy: Object.values(snapshot).some((state) => state.status === "installing"),
  };
}

export function runHarnessInstall(harness: HarnessId): Promise<void> {
  if (pending) return pending;
  setState(harness, { status: "installing" });
  pending = (async () => {
    try {
      const reason = harnessInstallUnavailableReason(harness);
      if (reason) throw new Error(reason);
      await installLocalHarness(harness);
      // An installer exiting zero is insufficient: validate the selected CLI,
      // including any configured path, before claiming it is usable.
      const inspection = await inspectHarnessBinary(harness);
      if (inspection.error) throw new Error(inspection.error);
      if (!inspection.version) throw new Error("CLI returned no valid version.");
      // Finish any probe that began before installation, then force a new one.
      // The availability store coalesces even forced calls while one is running.
      await probeHarnessAvailability();
      await probeHarnessAvailability({ force: true });
      if (!isHarnessAvailable(harness)) {
        throw new Error("The installed CLI could not be detected. Check its CLI path and retry.");
      }
      await refreshHarnessCatalogs([harness], { force: true });
      void announceHarnessesRefreshed([harness]).catch(() => undefined);
      setState(harness, { status: "installed" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setState(harness, { status: "failed", error: translate(message) });
    }
  })().finally(() => { pending = undefined; });
  return pending;
}
