export const PROVIDER_AUXILIARY_CAPABILITY = "providers.auxiliary.v1";
export const PROVIDER_INSPECT_CAPABILITY = "providers.inspect.v1";

export type ProviderAuxiliaryRequest = {
  requestId: string;
  projectId: string;
  cwd?: string;
  operation: "commit" | "pullRequest" | "branch";
  harness?: string;
  providerAccountId?: string;
  message?: string;
};

export type ProviderAuxiliaryResult =
  | { operation: "commit"; message: string }
  | { operation: "branch"; branch: string | null }
  | {
      operation: "pullRequest";
      title: string;
      body: string;
      base: string;
      head: string;
    };

export type ProviderAuxiliaryView =
  | { status: "running" }
  | { status: "completed"; result: ProviderAuxiliaryResult }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

export type ProviderInspection = {
  path: string;
  version?: string;
  error?: string;
};
