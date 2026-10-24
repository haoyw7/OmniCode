import { remoteRequest } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { providerUsageHost, providerUsageSourceKey } from "./providerUsageSource";
import { errorRateLimits, unavailableRateLimits } from "../../../domain/rateLimits";
import type { ProviderRateLimits, RateLimitProvider } from "../../../contracts/session";
import { HOST_OPENCODE_USAGE_CAPABILITY, HOST_USAGE_RESET_CAPABILITY, type CodexRateLimitResetOutcome } from "../../../contracts/providerUsage";

async function fetchHostUsage(
  provider: RateLimitProvider,
  accountId: string,
  refresh: boolean,
): Promise<ProviderRateLimits> {
  const host = providerUsageHost();
  if (!host) return unavailableRateLimits(provider, "Connect to the shared Host to read provider usage.");
  const source = providerUsageSourceKey();
  const requireSameHost = () => {
    if (source !== providerUsageSourceKey()) throw new Error("Host connection changed.");
  };
  try {
    const descriptor = await loadRemoteHostDescriptor(host.machineId, host.environmentId);
    requireSameHost();
    if (!descriptor.capabilities.includes(provider === "opencode" ? HOST_OPENCODE_USAGE_CAPABILITY : "providerAccounts.usage.v1"))
      return unavailableRateLimits(provider, "This Host does not support account usage yet. Update and restart it, then refresh.");
    const value = await remoteRequest<ProviderRateLimits>(host.machineId, provider === "opencode" ? "providerAccounts.opencodeUsage" : "providerAccounts.usage", {
      provider, accountId, refresh,
    });
    requireSameHost();
    if (!value || value.provider !== provider) return errorRateLimits(provider, "Usage unavailable");
    return value;
  } catch (error) {
    return errorRateLimits(provider, error instanceof Error ? error.message : "Usage unavailable");
  }
}


export function fetchClaudeRateLimits(accountId = "default", refresh = false): Promise<ProviderRateLimits> {
  return fetchHostUsage("claude", accountId, refresh);
}
export function fetchCodexRateLimits(accountId = "default", refresh = false): Promise<ProviderRateLimits> {
  return fetchHostUsage("codex", accountId, refresh);
}
export function fetchOpencodeGoRateLimits(): Promise<ProviderRateLimits> {
  return fetchHostUsage("opencode", "default", false);
}
export async function consumeCodexRateLimitResetCredit(creditId?: string, accountId = "default"): Promise<CodexRateLimitResetOutcome> {
  const host = providerUsageHost();
  if (!host) throw new Error("Connect to the shared Host to reset provider usage.");
  const source = providerUsageSourceKey();
  const descriptor = await loadRemoteHostDescriptor(host.machineId, host.environmentId);
  if (source !== providerUsageSourceKey()) throw new Error("Host connection changed.");
  if (!descriptor.capabilities.includes(HOST_USAGE_RESET_CAPABILITY)) throw new Error("This Host does not support Codex usage resets.");
  return remoteRequest<CodexRateLimitResetOutcome>(host.machineId, "providerAccounts.consumeReset", {
    accountId, operationId: crypto.randomUUID(), ...(creditId ? { creditId } : {}),
  });
}
