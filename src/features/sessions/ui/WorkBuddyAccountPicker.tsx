import { useEffect, useState } from "react";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { HarnessIcon } from "./HarnessIcon";
import { providerAccounts, subscribeProviderAccounts, workBuddyAccountIdForModel } from "../../providers/model/providerAccounts";
import type { UsageSession } from "../../providers/model/sessionUsage";

/** External logins are selected here, and managed by the original desktop app. */
export function WorkBuddyAccountPicker({ session, onChange }: { session: UsageSession; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState(() => providerAccounts("workbuddy"));
  useEffect(() => subscribeProviderAccounts(() => setAccounts(providerAccounts("workbuddy"))), []);
  const edition = session.model?.startsWith("workbuddy:global:") ? "global" : "cn";
  const value = session.providerAccountId ?? workBuddyAccountIdForModel(session.model ?? "");
  return <SearchableSelect
    label={t("WorkBuddy account")}
    value={value ?? ""}
    variant="transparent"
    searchable={false}
    disabled={!!session.providerAccountId}
    placeholder={t("Sign in to WorkBuddy on the execution machine")}
    options={accounts.map(account => ({ value: account.id, label: t(account.label),
      icon: <HarnessIcon harness="workbuddy" />, disabled: account.edition !== edition,
      description: account.edition !== edition ? t("Switch regions in the model picker") : t("Login managed by WorkBuddy") }))}
    onChange={onChange}
  />;
}
