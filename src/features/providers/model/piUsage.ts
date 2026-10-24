import { remoteRequest } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { providerUsageHost, providerUsageSourceKey } from "./providerUsageSource";
import { HOST_PI_USAGE_CAPABILITY, type PiUsageProvider } from "../../../contracts/providerUsage";
import { asRecord } from "../../../domain/records";
import { parsePiModelRef } from "../../../integrations/harness/providers/pi/piProtocol";
import { errorRateLimits, idleRateLimits, unavailableRateLimits } from "../../../domain/rateLimits";
import { type ProviderRateLimits, type RateLimitWindow } from "../../../contracts/session";

export type { PiUsageProvider };

export function piUsageProvider(
  model: string | undefined,
): PiUsageProvider | null {
  if (!model?.startsWith("pi:")) return null;
  const provider = parsePiModelRef(model.slice(3))?.provider;
  return provider === "anthropic" || provider === "openai-codex"
    ? provider
    : null;
}

export function piBillingProvider(
  provider: PiUsageProvider,
): "claude" | "codex" {
  return provider === "anthropic" ? "claude" : "codex";
}

export async function fetchPiUsage(
  provider: PiUsageProvider,
): Promise<ProviderRateLimits> {
  const billingProvider = piBillingProvider(provider);
  const host = providerUsageHost();
  if (!host)
    return unavailableRateLimits(billingProvider, "Connect to the shared Host to read provider usage.");
  try {
    // Pi's credentials live with the Host that runs Pi; never read them here.
    const source = providerUsageSourceKey();
    const descriptor = await loadRemoteHostDescriptor(host.machineId, host.environmentId);
    if (source !== providerUsageSourceKey()) throw new Error("Host connection changed.");
    if (!descriptor.capabilities.includes(HOST_PI_USAGE_CAPABILITY))
      return unavailableRateLimits(billingProvider, "This Host does not support account usage yet. Update and restart it, then refresh.");
    const result = asRecord(
      await remoteRequest<unknown>(host.machineId, "providerAccounts.piUsage", { provider }),
    );
    if (source !== providerUsageSourceKey()) throw new Error("Host connection changed.");
    if (
      result?.status === "unavailable" &&
      typeof result.message === "string"
    ) {
      return unavailableRateLimits(billingProvider, result.message);
    }
    if (result?.status === "error" && typeof result.message === "string") {
      return errorRateLimits(billingProvider, result.message);
    }
    const windows = asRecord(result?.windows);
    const session = parseWindow(windows?.session);
    const weekly = parseWindow(windows?.weekly);
    if (
      result?.status !== "ok" ||
      session === undefined ||
      weekly === undefined ||
      (!session && !weekly)
    ) {
      return errorRateLimits(
        billingProvider,
        "Pi usage response was unexpected. Try refreshing.",
      );
    }
    return {
      ...idleRateLimits(billingProvider),
      status: "ok",
      session,
      weekly,
      updatedAt: Date.now(),
    };
  } catch {
    return errorRateLimits(
      billingProvider,
      "Could not fetch Pi usage. Try refreshing.",
    );
  }
}

function parseWindow(value: unknown): RateLimitWindow | null | undefined {
  if (value === null) return null;
  const rec = asRecord(value);
  if (!rec) return undefined;
  const { usedPercent, windowMinutes, resetsAt } = rec;
  if (
    typeof usedPercent !== "number" ||
    !Number.isFinite(usedPercent) ||
    usedPercent < 0 ||
    usedPercent > 100 ||
    typeof windowMinutes !== "number" ||
    !Number.isSafeInteger(windowMinutes) ||
    windowMinutes <= 0 ||
    (resetsAt !== null &&
      (typeof resetsAt !== "number" ||
        !Number.isSafeInteger(resetsAt) ||
        resetsAt < 0))
  )
    return undefined;
  return { usedPercent, windowMinutes, resetsAt };
}
