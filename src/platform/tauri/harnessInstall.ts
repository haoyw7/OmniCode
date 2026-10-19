import { invoke } from "@tauri-apps/api/core";

/** Install on this desktop. Remote Host installation is not implied. */
export function installLocalHarness(provider: string): Promise<void> {
  return invoke("harness_install", { provider });
}
