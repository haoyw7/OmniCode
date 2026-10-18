export const REMOTE_PROVIDERS = ["codex", "claude", "cursor", "grok", "opencode", "pi", "omp", "fx", "hermes", "antigravity"] as const;
export type RemoteProvider = (typeof REMOTE_PROVIDERS)[number];
export function isRemoteProvider(value: unknown): value is RemoteProvider {
  return typeof value === "string" && REMOTE_PROVIDERS.some(provider => provider === value);
}
