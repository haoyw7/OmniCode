import { useState, type ReactNode } from "react";
import { useDeepseekAccount } from "../../providers/model/deepseekAccount";
import type { ProviderRateLimits } from "../../../contracts/session";
import { useMaskEmails } from "../../settings/model/displayPrefs";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { RefreshCw } from "../../../shared/ui/icons";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { HarnessIcon } from "../../../shared/ui/HarnessIcon";

/** DSH's signed-in account wallets; API routes never mount this component. */
export function DeepseekUsage({ project, render }: {
  project?: string;
  render?: (controls: ReactNode, limits?: ProviderRateLimits, summary?: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation();
  const masked = useMaskEmails();
  const [refreshKey, setRefreshKey] = useState(0);
  const { account, loading, error } = useDeepseekAccount(refreshKey, { project, autoRefresh: true });
  const stored = account?.status === "credential-stored";
  const profile = account?.profile;
  const status = loading ? "Checking…"
    : account?.status === "signed-out" ? "Not signed in"
      : stored ? "DeepSeek balance unavailable." : "Account information unavailable";
  const wallets = stored && account.balanceStatus === "ready" ? account.wallets ?? [] : [];
  const bonuses = stored && account.balanceStatus === "ready" ? account.bonusWallets ?? [] : [];
  const balances = <>
    {wallets.map((wallet, index) => <span key={`wallet:${index}`}>
      {t("Balance: {amount} {currency}", { amount: wallet.balance, currency: wallet.currency })}
    </span>)}
    {bonuses.map((wallet, index) => <span key={`bonus:${index}`}>
      {t("Bonus balance: {amount} {currency}", { amount: wallet.balance, currency: wallet.currency })}
    </span>)}
  </>;
  const controls = (
    <div className="min-w-0 w-full" aria-busy={loading}>
      <div className="flex min-w-0 items-center gap-1.5">
        <HarnessIcon harness="deepseek" className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={profile?.name || t("DeepSeek account")}>
          {profile?.name || t("DeepSeek account")}
        </span>
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-content/40 hover:bg-content/6 hover:text-content disabled:opacity-50"
          aria-label={t("Refresh usage")}
          title={t("Refresh usage")}
          disabled={loading}
          onClick={() => setRefreshKey(key => key + 1)}
        >
          <RefreshCw className={`size-2.5 ${loading ? "motion-safe:animate-spin" : ""}`} aria-hidden />
        </button>
      </div>
      {profile?.contact ? <div className="mb-1 min-w-0 truncate">
        {profile.contact.includes("@")
          ? <PrivateEmail masked={masked} email={profile.contact} />
          : profile.contact}
      </div> : null}
      <div className="flex min-w-0 flex-col gap-1 tabular-nums [overflow-wrap:anywhere]" role="status">
        {wallets.length || bonuses.length ? balances : t(status)}
        {error ? <span>{t(error)}</span> : null}
      </div>
    </div>
  );
  const summary = <span data-session-usage-remaining className="min-w-0 truncate text-[11px] tabular-nums text-content/55">
    {wallets[0]
      ? t("Balance: {amount} {currency}", { amount: wallets[0].balance, currency: wallets[0].currency })
      : bonuses[0]
        ? t("Bonus balance: {amount} {currency}", { amount: bonuses[0].balance, currency: bonuses[0].currency })
        : t(status)}
  </span>;
  return render ? render(controls, undefined, summary) : controls;
}
