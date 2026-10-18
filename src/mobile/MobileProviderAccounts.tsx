import { IconButton } from "../shared/ui/forms/IconButton";
import { useEffect, useState } from "react";
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
  const [state, setState] = useState<State>(() => empty(hostId));
  const [refresh, setRefresh] = useState(0);
  const clock = useNow(30_000, visible && enabled);
  const connected = !!hostId && enabled;
  useEffect(() => {
    if (!visible) return;
    if (!hostId || !enabled) {
      setState(empty(hostId));
      return;
    }
    let live = true;
    const current = () => live && client.connection?.endpoint === hostId;
    setState(previous => ({ ...(previous.hostId === hostId ? previous : empty(hostId)), loading: true, error: "" }));
    void (async () => {
      try {
        // A running Host can be upgraded without reconnecting the phone.
        // Recheck its descriptor before treating cached capabilities as final.
        if (refresh > 0 || !client.hasCapability("providerAccounts.usage.v1")) {
          await client.verify();
          if (!current()) return;
        }
        const accounts = await client.providerAccounts();
        if (!current()) return;
        const supported = client.hasCapability("providerAccounts.usage.v1");
        const targets = PROVIDERS.flatMap(provider => (accounts?.[provider] ?? []).map(account => ({ provider, account })));
        setState(previous => ({ ...previous, accounts, unsupported: !supported, usage: Object.fromEntries(
          supported ? targets.map(({ provider, account }) => {
            const key = `${provider}:${account.id}`;
            const oldAccount = previous.accounts?.[provider]?.find(old => old.id === account.id);
            const oldUsage = JSON.stringify(oldAccount?.identity) === JSON.stringify(account.identity) ? previous.usage[key] : undefined;
            return [key, fetchingRateLimits(provider, oldUsage)];
          }) : [],
        ) }));
        if (!accounts || !supported) return;
        // Limit process starts without making one RPC wait behind all accounts.
        let index = 0;
        const worker = async () => {
          while (current() && index < targets.length) {
            const { provider, account } = targets[index++];
            let limits: HostProviderUsage | null;
            try {
              limits = await client.providerAccountUsage({ provider, accountId: account.id, refresh: refresh > 0 });
            } catch {
              limits = errorRateLimits(provider, "Unable to refresh account usage.");
            }
            if (!current()) return;
            if (!limits) {
              setState(previous => ({ ...previous, unsupported: true, usage: {} }));
              index = targets.length;
              return;
            }
            const result = limits;
            const key = `${provider}:${account.id}`;
            setState(previous => {
              if (previous.unsupported) return previous;
              const old = previous.usage[key];
              // Keep the last successful timestamp when a refresh fails.
              const value = result.status === "error" && old && meterWindows(old).length
                ? { ...old, status: result.status, error: result.error } : result;
              return { ...previous, usage: { ...previous.usage, [key]: value } };
            });
          }
        };
        await Promise.all([worker(), worker()]);
      } catch (error) {
        if (current()) setState(previous => ({ ...previous,
          error: error instanceof Error ? error.message : "Unable to load accounts." }));
      } finally {
        if (current()) setState(previous => ({ ...previous, loading: false }));
      }
    })();
    return () => { live = false; };
  }, [client, hostId, enabled, visible, refresh]);

  const shown = connected && state.hostId === hostId ? state : empty(hostId);
  const count = PROVIDERS.reduce((total, provider) => total + (shown.accounts?.[provider]?.length ?? 0), 0);
  const now = Math.max(clock, ...Object.values(shown.usage).map(value => value.updatedAt));
  return (
    <div className="mobile-provider-accounts">
      <div className="mobile-account-toolbar">
        <p>{t("Accounts on {host}", { host: client.connection?.name ?? "Host" })}</p>
        <IconButton type="button" label={t("Refresh usage limits")}
          disabled={!connected || shown.loading || !visible} onClick={() => setRefresh(value => value + 1)}>
          <RefreshCw size={19} className={shown.loading ? "animate-spin" : undefined} />
        </IconButton>
      </div>
      {!connected ? <p className="mobile-settings-footer">{t("Connect to a Host to view account usage.")}</p> : null}
      {shown.error ? <p className="mobile-form-error" role="alert">{t(shown.error)}</p> : null}
      {shown.accounts === null ? <p className="mobile-settings-footer">{t("Provider accounts are unavailable on this Host.")}</p>
        : shown.unsupported ? <div className="mobile-account-notice" role="status">
          <Info size={18} aria-hidden />
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
