import { invoke } from "@tauri-apps/api/core";

/** What installing or removing a CLI on this desktop would run and touch. */
export type HarnessCliPlan = {
  installCommand: string | null;
  /** The CLI OmniCode currently runs, when one is found. */
  path: string | null;
  removes: string[];
  uninstallCommand: string | null;
  /** Why OmniCode leaves the found CLI to the tool that installed it. */
  uninstallBlocker: string | null;
};

/** Install on this desktop. Remote Host installation is not implied. */
export function installLocalHarness(provider: string): Promise<void> {
  return invoke("harness_install", { provider });
}

export function localHarnessCliPlan(
  provider: string,
  binaryPath: string | null,
): Promise<HarnessCliPlan> {
  return invoke("harness_cli_plan", { provider, binaryPath });
}

/** Remove the CLI OmniCode runs on this desktop, as `localHarnessCliPlan` describes. */
export function uninstallLocalHarness(
  provider: string,
  binaryPath: string | null,
): Promise<void> {
  return invoke("harness_uninstall", { provider, binaryPath });
}
