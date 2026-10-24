export const HOST_PROVIDER_RUNTIME_CAPABILITY = "providers.runtime.v1";
export type ProviderMutationStatus = { id: string; status: "running" | "succeeded" | "failed"; error?: string };
export type HarnessBinaryInspection = { path: string; version?: string; error?: string };
export type HarnessCliPlan = {
  installCommand: string | null;
  path: string | null;
  removes: string[];
  uninstallCommand: string | null;
  uninstallBlocker: string | null;
};
export type HarnessInstall = {
  path: string;
  realPath: string;
  source: "npm" | "homebrew" | "bundled" | "other";
  bundledBy: string | null;
  alternatives: { path: string; version: string }[];
};
