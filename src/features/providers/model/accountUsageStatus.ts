import { clampUsedPercent, exhaustedWindowResetAt, formatResetDuration, type ProviderRateLimits } from "./rateLimits";
import type { ProviderAccount } from "./providerAccounts";

/** At or below this much headroom an account reads as "Running low". */
export const LOW_HEADROOM_PERCENT = 20;

export type AccountStatusTone =
  "ready" | "low" | "exhausted" | "checking" | "unknown";

export type AccountStatus = {
  tone: AccountStatusTone;
  label: string;
  /** Extra context, e.g. "back in 31m" for an exhausted account. */
  detail: string | null;
};

/**
 * Remaining percent of the tightest window, or null without usage data.
 * A window whose reset time has passed counts as fully available.
 */
export function accountHeadroom(
  limits: ProviderRateLimits | undefined,
  now: number,
): number | null {
  const windows = [limits?.session, limits?.weekly, limits?.monthly].filter(
    (window) => window != null,
  );
  if (windows.length === 0) return null;
  return Math.min(
    ...windows.map((window) =>
      window.resetsAt != null && window.resetsAt <= now
        ? 100
        : 100 - clampUsedPercent(window.usedPercent),
    ),
  );
}

/** Ready / Running low / Exhausted for an account, shared by every surface. */
export function accountStatus(
  limits: ProviderRateLimits | undefined,
  now: number,
): AccountStatus {
  const headroom = accountHeadroom(limits, now);
  if (!limits || headroom == null) {
    if (!limits || limits.status === "idle" || limits.status === "fetching") {
      return { tone: "checking", label: "Checking…", detail: null };
    }
    return {
      tone: "unknown",
      label:
        limits.status === "unavailable"
          ? limits.error || "Not signed in"
          : limits.error || "Usage unavailable",
      detail: null,
    };
  }
  if (headroom <= 0) {
    return {
      tone: "exhausted",
      label: "Exhausted",
      detail: backIn(limits, now),
    };
  }
  if (headroom <= LOW_HEADROOM_PERCENT) {
    return {
      tone: "low",
      label: "Running low",
      detail: `${Math.round(headroom)}% left`,
    };
  }
  return { tone: "ready", label: "Ready", detail: null };
}

/** "back in 31m" for the used-up window that stays blocked longest. */
function backIn(limits: ProviderRateLimits, now: number): string | null {
  const resetAt = exhaustedWindowResetAt(limits);
  if (resetAt == null || resetAt <= now) return null;
  return `back in ${formatResetDuration(resetAt - now)}`;
}

/** The account with the most headroom, if it is comfortably above "low". */
export function bestAlternativeAccount(
  accounts: ProviderAccount[],
  usageFor: (account: ProviderAccount) => ProviderRateLimits | undefined,
  now: number,
): ProviderAccount | null {
  let best: { account: ProviderAccount; headroom: number } | null = null;
  for (const account of accounts) {
    const headroom = accountHeadroom(usageFor(account), now);
    if (headroom == null || headroom <= LOW_HEADROOM_PERCENT) continue;
    if (!best || headroom > best.headroom) best = { account, headroom };
  }
  return best?.account ?? null;
}
