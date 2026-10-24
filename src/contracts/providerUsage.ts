export const HOST_OPENCODE_USAGE_CAPABILITY = "providerAccounts.opencodeUsage.v1";
export const HOST_USAGE_RESET_CAPABILITY = "providerAccounts.reset.v1";
export type CodexRateLimitResetOutcome = "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";
export const HOST_PI_USAGE_CAPABILITY = "providerAccounts.piUsage.v1";
export type PiUsageProvider = "anthropic" | "openai-codex";
export type PiUsageWindow = { usedPercent: number; windowMinutes: number; resetsAt: number | null };
export type PiUsageResult =
  | { status: "ok"; windows: { session: PiUsageWindow | null; weekly: PiUsageWindow | null } }
  | { status: "unavailable" | "error"; message: string };
