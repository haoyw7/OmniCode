import { IconButton } from "../shared/ui/forms/IconButton";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { mobileSourceKey } from "./mobileQueries";
import type { HostProviderAccounts, HostProviderUsage } from "../features/connections/model/protocol";
import { accountStatus } from "../features/providers/model/accountUsageStatus";
import { fetchingRateLimits, errorRateLimits } from "../features/providers/model/rateLimits";
import { AccountStatusLabel, meterWindows, UsageMeter } from "../features/providers/ui/ProviderAccountUsage";
import { HARNESS_TITLE } from "../features/sessions/model/session";
import { HarnessIcon } from "../features/sessions/ui/HarnessIcon";
import { useNow } from "../shared/hooks/useNow";
import { useTranslation } from "../shared/i18n/useTranslation";
import { Info, RefreshCw } from "../shared/ui/icons";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import type { MobileClient } from "./client";
import "./styles/provider-accounts.css";

const PROVIDERS = ["claude", "codex"] as const;
type State = {
  hostId?: string;
  accounts?: HostProviderAccounts | null;
  usage: Record<string, HostProviderUsage>;
  loading: boolean;
  unsupported: boolean;
  error: string;
};
const empty = (hostId?: string): State => ({ hostId, usage: {}, loading: false, unsupported: false, error: "" });

export function MobileProviderAccounts({ client, hostId, enabled }: {
  client: MobileClient;
  hostId?: string;
  enabled: boolean;
}) {
  const { t, language } = useTranslation();
  const visible = useSurfaceVisibility();
  const clock = useNow(30_000, visible && enabled);
  const connected = !!hostId && enabled;
  const refreshRequested = useRef(false);
  const queryKey = ["mobile", "providerAccounts", mobileSourceKey(client), hostId] as const;
  const accountsRead = useQuery({
    queryKey, enabled: visible && connected,
    queryFn: async ({ signal }): Promise<State> => {
      const force = refreshRequested.current; refreshRequested.current = false;
      const current = () => !signal.aborted && client.connection?.endpoint === hostId;
      const previous = queryClient.getQueryData<State>(queryKey) ?? empty(hostId);
      if (force || !client.hasCapability("providerAccounts.usage.v1")) {
        await client.verify(); signal.throwIfAborted();
        if (!current()) throw new Error("Host connection changed");
      }
      const accounts = await client.providerAccounts();
      signal.throwIfAborted();
      if (!current()) throw new Error("Host connection changed");
      const supported = client.hasCapability("providerAccounts.usage.v1");
      const targets = PROVIDERS.flatMap(provider => (accounts?.[provider] ?? []).map(account => ({ provider, account })));
      let next: State = { ...empty(hostId), accounts, unsupported: !supported, usage: Object.fromEntries(supported ? targets.map(({ provider, account }) => {
        const key = `${provider}:${account.id}`;
        const oldAccount = previous.accounts?.[provider]?.find(old => old.id === account.id);
        const oldUsage = JSON.stringify(oldAccount?.identity) === JSON.stringify(account.identity) ? previous.usage[key] : undefined;
        return [key, fetchingRateLimits(provider, oldUsage)];
      }) : []) };
      queryClient.setQueryData(queryKey, next);
      if (!accounts || !supported) return next;
      let index = 0;
      const worker = async () => {
        while (current() && !next.unsupported && index < targets.length) {
          const { provider, account } = targets[index++];
          let limits: HostProviderUsage | null;
          try { limits = await client.providerAccountUsage({ provider, accountId: account.id, refresh: force }); }
          catch { limits = errorRateLimits(provider, "Unable to refresh account usage."); }
          if (!current()) return;
          if (!limits) { next = { ...next, unsupported: true, usage: {} }; }
          else if (!next.unsupported) {
            const key = `${provider}:${account.id}`, old = next.usage[key];
            const value = limits.status === "error" && old && meterWindows(old).length ? { ...old, status: limits.status, error: limits.error } : limits;
            next = { ...next, usage: { ...next.usage, [key]: value } };
          }
          queryClient.setQueryData(queryKey, next);
        }
      };
      await Promise.all([worker(), worker()]);
      signal.throwIfAborted();
      return next;
    },
  }, queryClient);
  useEffect(() => { if (!visible || !connected) void queryClient.cancelQueries({ queryKey }); }, [visible, connected, hostId, client]);
  const shown = connected ? { ...(accountsRead.data ?? empty(hostId)), loading: accountsRead.isFetching,
    error: accountsRead.error ? accountsRead.error instanceof Error ? accountsRead.error.message : "Unable to load accounts." : "",
  } : empty(hostId);
  const count = PROVIDERS.reduce((total, provider) => total + (shown.accounts?.[provider]?.length ?? 0), 0);
  const now = Math.max(clock, ...Object.values(shown.usage).map(value => value.updatedAt));
  return (
    <div className="mobile-provider-accounts">
      <div className="mobile-account-toolbar">
        <p>{t("Accounts on {host}", { host: client.connection?.name ?? "Host" })}</p>
        <IconButton type="button" label={t("Refresh usage limits")}
          disabled={!connected || shown.loading || !visible} onClick={() => { refreshRequested.current = true; void accountsRead.refetch(); }}>
          <RefreshCw className={shown.loading ? "animate-spin" : undefined} />
        </IconButton>
      </div>
      {!connected ? <p className="mobile-settings-footer">{t("Connect to a Host to view account usage.")}</p> : null}
      {shown.error ? <p className="mobile-form-error" role="alert">{t(shown.error)}</p> : null}
      {shown.accounts === null ? <p className="mobile-settings-footer">{t("Provider accounts are unavailable on this Host.")}</p>
        : shown.unsupported ? <div className="mobile-account-notice" role="status">
          <Info aria-hidden />
          <div><strong>{t("Host update required")}</strong>
            <p>{t("This Host does not support account usage yet. Update and restart it, then refresh.")}</p>
          </div>
        </div> : null}
      {shown.loading && !count ? <p role="status" className="mobile-settings-footer">{t("Loading accounts…")}</p> : null}
      {connected && shown.accounts && !count && !shown.loading ?
        <p className="mobile-settings-footer">{t("No shared accounts are available on this Host.")}</p> : null}
      {PROVIDERS.map(provider => {
        const accounts = shown.accounts?.[provider] ?? [];
        if (!accounts.length) return null;
        const defaults = accounts.find(account => account.id === "default");
        return (
          <section key={provider} className="mobile-settings-group" aria-label={HARNESS_TITLE[provider]}>
            <h2 className="mobile-account-provider"><HarnessIcon harness={provider} className="size-4" />{HARNESS_TITLE[provider]}</h2>
            {defaults?.defaultError ? <p className="mobile-form-error" role="alert">{defaults.defaultError}</p> : null}
            <div className="mobile-account-list">
              {accounts.map(account => {
                const limits = shown.usage[`${provider}:${account.id}`];
                const status = accountStatus(limits, now);
                const windows = meterWindows(limits);
                const label = account.id === "default" && account.label === "Default account"
                  ? t("Built-in CLI profile") : account.label;
                return (
                  <article key={account.id} className="mobile-account-row" aria-label={label}>
                    <div className="mobile-account-heading">
                      <strong>{label}</strong>
                      {account.identity?.plan ? <span className="mobile-account-plan">{account.identity.plan}</span> : null}
                      {!defaults?.defaultError && defaults?.defaultAccountId === account.id ?
                        <span className="mobile-account-badge" aria-label={t("Default for new conversations")}
                          title={t("Default for new conversations")}>{t("Default for new chats")}</span> : null}
                    </div>
                    <p className="mobile-account-identity">
                      {account.identity?.email || account.identity?.name?.trim() || t("Account identity unavailable")}
                    </p>
                    {account.identity?.organization ? <p className="mobile-account-detail">{account.identity.organization}</p> : null}
                    {!shown.unsupported ? <AccountStatusLabel wrap className="mobile-account-status"
                      status={{ ...status, detail: null, label: t(status.label) }} /> : null}
                    {limits?.status === "error" && windows.length > 0 ?
                      <p className="mobile-form-error" role="status">{t(limits.error || "Unable to refresh account usage.")}</p> : null}
                    {windows.length ? <div className="mobile-account-meters">
                      {windows.map(entry => <UsageMeter key={entry.title} {...entry} now={now} showRemaining className="mobile-account-meter" />)}
                    </div> : null}
                    {limits?.updatedAt && windows.length ? <p className="mobile-account-updated">
                      {t("Updated {time}", { time: new Date(limits.updatedAt).toLocaleString(language) })}
                    </p> : null}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
