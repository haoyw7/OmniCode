import type {
  UsageLimitSource,
  UsageLimitWindow,
  UsageProvider,
} from "../../../integrations/harness/core/usage";
export function effectiveUsageWindow(
  account: UsageLimitSource,
  reported: UsageLimitWindow,
  now: number,
) {
  const weekly =
    reported.id === "session"
      ? account.windows.find(
          (window) => window.id === "weekly" && window.usedPercent >= 100,
        )
      : undefined;
  if (!weekly) return { window: reported, refillPercent: reported.usedPercent };
  let resetsAt: number | undefined,
    refillPercent = 0;
  if (
    weekly.resetsAt &&
    reported.resetsAt &&
    weekly.resetsAt > now &&
    reported.resetsAt > now
  ) {
    if (reported.resetsAt <= weekly.resetsAt) {
      resetsAt = weekly.resetsAt;
      refillPercent = 100;
    } else if (reported.usedPercent >= 100) {
      resetsAt = reported.resetsAt;
      refillPercent = 100;
    } else {
      resetsAt = weekly.resetsAt;
      refillPercent = 100 - reported.usedPercent;
    }
  }
  return {
    window: {
      ...reported,
      usedPercent: 100,
      resetsAt,
      windowDurationMins: undefined,
    },
    refillPercent,
  };
}
export function usagePools(sources: readonly UsageLimitSource[], now: number) {
  const accounts = new Map<string, UsageLimitSource>();
  for (const source of sources) {
    const key = source.accountKey
      ? `${source.provider}:${source.accountKey}`
      : `${source.environmentKey}:${source.id}`;
    const previous = accounts.get(key);
    if (
      !previous ||
      (source.status === "ok" &&
        (previous.status !== "ok" ||
          (source.updatedAt ?? 0) >= (previous.updatedAt ?? 0)))
    )
      accounts.set(key, source);
  }
  const pools = new Map<UsageProvider, UsageLimitSource[]>();
  for (const account of accounts.values()) {
    const group = pools.get(account.provider) ?? [];
    group.push(account);
    pools.set(account.provider, group);
  }
  return [...pools].map(([provider, accounts]) => {
    const nextReset = (account: UsageLimitSource) => {
      const session = account.windows.find((window) => window.id === "session");
      return session
        ? (effectiveUsageWindow(account, session, now).window.resetsAt ??
            Infinity)
        : Infinity;
    };
    accounts.sort(
      (a, b) => nextReset(a) - nextReset(b) || a.label.localeCompare(b.label),
    );
    const windows = new Map<
      string,
      {
        id: string;
        label: string;
        scopeLabel?: string;
        members: {
          account: UsageLimitSource;
          window: UsageLimitWindow;
          refillPercent: number;
        }[];
      }
    >();
    for (const account of accounts)
      for (const reported of account.windows) {
        const group = windows.get(reported.id) ?? {
          id: reported.id,
          label: reported.label,
          scopeLabel: reported.scopeLabel,
          members: [],
        };
        group.members.push({
          account,
          ...effectiveUsageWindow(account, reported, now),
        });
        windows.set(reported.id, group);
      }
    return { provider, accounts, windows: [...windows.values()] };
  });
}
export function usagePace(
  window: UsageLimitWindow,
  now: number,
): number | null {
  if (
    !window.resetsAt ||
    !window.windowDurationMins ||
    window.windowDurationMins <= 0
  )
    return null;
  return Math.max(
    0,
    Math.min(
      100,
      ((window.resetsAt - now) / (window.windowDurationMins * 60_000)) * 100,
    ),
  );
}

export const usageLimitLabel = (
  window: Pick<UsageLimitWindow, "label" | "scopeLabel">,
  translate: (key: string) => string,
) =>
  `${translate(window.label)}${window.scopeLabel ? ` · ${window.scopeLabel}` : ""}`;
