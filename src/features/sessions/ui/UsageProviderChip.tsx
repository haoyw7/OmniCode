import { Omi } from "../../../shared/ui/branding/Omi";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { clampUsedPercent, formatResetDuration, formatUsagePercent, formatWindowLabel, rateLimitWindowTooltip } from "../../../domain/rateLimits";
import type { ProviderRateLimits, RateLimitResetCredit, RateLimitWindow, HarnessId } from "../../../contracts/session";
import type { CodexRateLimitResetOutcome } from "../../../contracts/providerUsage";
import { projectMascot } from "../../projects/model/projectMascots";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { HARNESS_TITLE } from "../../../contracts/session";

import { loadTabGroupColors, loadTabGroupCustomColors, loadTabGroupMascots, resolveTabGroupColor, resolveTabGroupMascot } from "../../workspace/model/tabGroups";
import { HarnessIcon } from "../../../shared/ui/HarnessIcon";
import { ArrowLeft, Check, ChevronRight, Plus, RefreshCw } from "../../../shared/ui/icons";
import { Popover, type PopoverDismissReason } from "../../../shared/ui/Popover";
import { ProviderSignInPanel, type ProviderSignInState } from "./ProviderSignInPanel";
import { supportsProviderAccounts, type ProviderAccount } from "../../providers/model/providerAccounts";
import { accountStatus, accountUsageKey, bestAlternativeAccount, useProviderAccountUsage } from "../../providers/model/accountUsage";
import { AccountStatusLabel, barClass, meterWindows, UsageMeter } from "../../../shared/ui/ProviderAccountUsage";
import { ProviderAccountSubtitle } from "../../../shared/ui/ProviderAccountSubtitle";
import { identityKey, identityOrganizationTag, useProviderAccountIdentities, type ProviderAccountIdentity } from "../../providers/model/providerAccountIdentity";
import { useMaskEmails, useShowRemainingUsage } from "../../settings/model/displayPrefs";

type Translate = ReturnType<typeof useTranslation>["t"];

type UsageWindowEntry = {
  key: "session" | "weekly" | "monthly";
  window: RateLimitWindow;
};

type ResetActionState =
  "idle" | "confirming" | "using" | CodexRateLimitResetOutcome | "error";

export function UsageProviderChip({
  limits,
  now,
  project,
  accounts = [],
  accountId,
  onSelectAccount,
  onAddAccount,
  onManageAccounts,
  onConsumeReset,
  onReconnect,
  presentation,
}: {
  limits: ProviderRateLimits;
  now: number;
  presentation?: { harness: HarnessId; label: string; sourceLabel?: string };
  project?: string;
  accounts?: ProviderAccount[];
  accountId?: string;
  onSelectAccount?: (accountId: string) => void;
  onAddAccount?: (label: string) => Promise<ProviderAccount>;
  onManageAccounts?: () => void;
  onConsumeReset?: (creditId?: string) => Promise<CodexRateLimitResetOutcome>;
  onReconnect?: () => Promise<void>;
}) {
  const masked = useMaskEmails();

  const { t: uiT } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [accountView, setAccountView] = useState<"usage" | "accounts" | "add">(
    "usage",
  );
  const [resetAction, setResetAction] = useState<ResetActionState>("idle");
  const [activeResetKey, setActiveResetKey] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [reconnectState, setReconnectState] =
    useState<ProviderSignInState>("idle");
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const loading =
    limits.status === "idle" ||
    (limits.status === "fetching" &&
      !limits.session &&
      !limits.weekly &&
      !limits.monthly);
  const disconnected = limits.status === "unavailable" && needsProviderLogin(limits);
  const windows = usageWindows(limits);
  const loginView = Boolean(
    onReconnect &&
    windows.length === 0 &&
    (needsProviderLogin(limits) || reconnectState !== "idle"),
  );
  const tooltip = windows
    .map((entry) => rateLimitWindowTooltip(entry.window, now, true))
    .join(" · ");
  const providerLabel = presentation?.label ?? HARNESS_TITLE[limits.provider];
  const iconHarness = presentation?.harness ?? limits.provider;
  const activeAccount = accounts.find((account) => account.id === accountId);
  const canManageAccounts = Boolean(onSelectAccount && onAddAccount);
  const activeAccountLabel = activeAccount?.label ?? "Removed account";
  const identities = useProviderAccountIdentities(
    accounts,
    `${open}:${limits.updatedAt}:${reconnectState}`,
  );
  const activeIdentity = activeAccount
    ? identities[identityKey(activeAccount)]
    : null;
  const accountProvider = supportsProviderAccounts(limits.provider)
    ? limits.provider
    : undefined;
  const otherAccounts = accounts.filter((account) => account.id !== accountId);
  const accountUsage = useProviderAccountUsage(
    accounts.map((account) => account.id).join("|"),
    {
      provider: accountProvider,
      enabled: open && Boolean(accountProvider) && otherAccounts.length > 0,
    },
  );
  // The conversation's snapshot is fresher for the active account.
  const usageFor = (account: ProviderAccount) =>
    account.id === accountId
      ? limits
      : accountUsage.usage[accountUsageKey(account)];
  const activeStatus = accountStatus(limits, now);
  const suggestion =
    activeStatus.tone === "exhausted" || activeStatus.tone === "low"
      ? bestAlternativeAccount(otherAccounts, usageFor, now)
      : null;
  const mascotProject = project ? projectName(project) : providerLabel;
  const appearanceKey = project ? projectKey(project) : mascotProject;
  const mascotName = resolveTabGroupMascot(
    appearanceKey,
    loadTabGroupMascots(),
  );
  const mascotColor = resolveTabGroupColor(
    appearanceKey,
    loadTabGroupColors(),
    loadTabGroupCustomColors(),
    mascotProject,
  );

  const resetPopup = () => {
    setResetAction("idle");
    setActiveResetKey(null);
    setResetError(null);
    setReconnectState("idle");
    setReconnectError(null);
    setAccountView("usage");
  };

  const dismiss = (reason: PopoverDismissReason) => {
    setOpen(false);
    if (reason === "escape") {
      requestAnimationFrame(() => trigger.current?.focus());
    }
  };

  const useReset = async (
    credit: RateLimitResetCredit | undefined,
    rowKey: string,
  ) => {
    if (!onConsumeReset) return;
    setActiveResetKey(rowKey);
    setResetAction("using");
    setResetError(null);
    try {
      setResetAction(await onConsumeReset(credit?.id));
    } catch (error) {
      setResetError(
        error instanceof Error ? error.message : "Could not use this reset",
      );
      setResetAction("error");
    }
  };

  const reconnect = async () => {
    if (!onReconnect) return;
    setReconnectState("running");
    setReconnectError(null);
    try {
      await onReconnect();
      setReconnectState("complete");
    } catch (error) {
      setReconnectError(
        error instanceof Error ? error.message : "Could not complete sign-in",
      );
      setReconnectState("error");
    }
  };

  const detailsLabel = uiT("{value0} usage details", {
    value0: String(providerLabel),
  });
  const panelPadding = accountView === "usage" && loginView ? "" : "p-2.5";
  const panel = (
    <>
      {accountView === "accounts" ? (
        <ProviderAccountPicker
          providerLabel={providerLabel}
          accounts={accounts}
          identities={identities}
          accountId={accountId ?? ""}
          usageFor={usageFor}
          now={now}
          onBack={() => setAccountView("usage")}
          onAdd={() => setAccountView("add")}
          onManage={
            onManageAccounts
              ? () => {
                  setOpen(false);
                  onManageAccounts();
                }
              : undefined
          }
          onSelect={(nextAccountId) => {
            onSelectAccount?.(nextAccountId);
            setOpen(false);
          }}
        />
      ) : accountView === "add" ? (
        <AddProviderAccount
          providerLabel={providerLabel}
          onBack={() => setAccountView("accounts")}
          onAdd={onAddAccount}
          onComplete={() => setOpen(false)}
        />
      ) : loginView ? (
        <>
          {canManageAccounts ? (
            <AccountSwitchRow
              accountLabel={activeAccountLabel}
              onClick={() => setAccountView("accounts")}
            />
          ) : null}
          <ProviderSignInPanel
            harness={limits.provider}
            state={reconnectState}
            error={reconnectError}
            onSignIn={() => void reconnect()}
          />
        </>
      ) : (
        <>
          {/* The way out of an exhausted account comes before the numbers. */}
          {suggestion && onSelectAccount ? (
            <SwitchSuggestion
              account={suggestion}
              limits={usageFor(suggestion)}
              exhausted={activeStatus.tone === "exhausted"}
              now={now}
              onSwitch={() => {
                onSelectAccount(suggestion.id);
                setOpen(false);
              }}
            />
          ) : null}

          <div className="flex items-center gap-2 px-1 pb-2 pt-0.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-content/[0.06] ring-1 ring-inset ring-content/[0.07]">
              <HarnessIcon harness={iconHarness} className="size-3.5" />
            </span>
            <h2 className="desktop-pane-heading min-w-0 flex-1 truncate text-[13px] font-medium leading-4">
              {providerLabel} {uiT("usage")}
            </h2>
            {limits.status === "fetching" ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-content/40">
                <RefreshCw
                  className="size-2.5 motion-safe:animate-spin"
                  aria-hidden
                />
                {uiT("Updating")}
              </span>
            ) : (
              <span className="shrink-0 text-[10px] text-content/40">
                {updatedLabel(limits, now, uiT)}
              </span>
            )}
          </div>
          {presentation?.sourceLabel ? (
            <p className="-mt-1 px-1 pb-2 text-[10px] leading-4 text-content/55">
              {presentation.sourceLabel}
            </p>
          ) : null}

          {canManageAccounts ? (
            <div className="pointer-events-none relative mb-3 flex h-8 w-full items-center gap-1.5 rounded-lg bg-content/[0.045] px-2.5 text-[11px] ring-1 ring-inset ring-content/[0.06]">
              {/* Keep account switching separate from email revelation. */}
              <button
                type="button"
                className="pointer-events-auto absolute inset-0 rounded-lg hover:bg-content/[0.05] focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={uiT("Switch {value0} account", {
                  value0: String(providerLabel),
                })}
                onClick={() => setAccountView("accounts")}
              />
              <span className="max-w-[45%] shrink-0 truncate font-medium">
                {activeAccountLabel}
              </span>
              <ProviderAccountSubtitle masked={masked}
                key={activeAccount && identityKey(activeAccount)}
                identity={activeIdentity}
                className="text-[10px] text-content/40"
              />
              <ChevronRight
                className="ml-auto size-3 shrink-0 text-content/35"
                aria-hidden
              />
            </div>
          ) : null}

          {limits.status === "error" && windows.length > 0 ? (
            <p className="mb-2 rounded-lg bg-amber-400/10 px-2.5 py-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
              {uiT("Couldn’t refresh. Showing the last available snapshot.")}
            </p>
          ) : null}

          {windows.length > 0 ? (
            <div className="flex flex-col gap-3 px-1 pb-1">
              {windows.map((entry) => (
                <UsageWindowRow
                  key={entry.key}
                  kind={entry.key}
                  window={entry.window}
                  now={now}
                />
              ))}
            </div>
          ) : (
            <EmptyUsageState limits={limits} loading={loading} />
          )}

          {limits.provider === "codex" ? (
            <BankedResets
              limits={limits}
              now={now}
              action={resetAction}
              activeResetKey={activeResetKey}
              error={resetError}
              mascotProject={mascotProject}
              mascotName={mascotName}
              mascotColor={mascotColor}
              onConfirm={(creditId) => {
                setActiveResetKey(creditId);
                setResetAction("confirming");
              }}
              onCancel={() => {
                setActiveResetKey(null);
                setResetAction("idle");
              }}
              onUse={useReset}
              canUse={Boolean(onConsumeReset)}
            />
          ) : null}
        </>
      )}
    </>
  );

  const harnessIcon = <HarnessIcon harness={iconHarness} className="size-3 shrink-0" />;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-ui="session-usage-trigger"
        className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 whitespace-nowrap text-content/55 hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={uiT("{value0} usage details", {
          value0: String(providerLabel),
        })}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          tooltip ||
          limits.error ||
          (disconnected
            ? uiT("Not connected")
            : loading
              ? uiT("Loading usage…")
              : uiT("Usage details"))
        }
        onClick={() => setOpen((value) => !value)}
      >
        {loading || disconnected || windows.length === 0 ? harnessIcon : null}
        {loading ? (
          <span className="animate-pulse text-content/35">···</span>
        ) : disconnected ? (
          <span className="text-content/35">{uiT("not connected")}</span>
        ) : windows.length === 0 ? (
          <span className="min-w-0 truncate text-content/35">
            {limits.status === "unavailable" ? uiT("Usage unavailable") : emptyUsageLabel(limits)}
          </span>
        ) : (
          <span className="grid min-w-0 flex-1 grid-cols-[max-content_max-content_minmax(0,1fr)_max-content] items-center gap-x-1.5 gap-y-1 py-1 text-left tabular-nums">
            {accounts.length > 1 && activeAccount ? (
              <span className="col-span-3 col-start-2 min-w-0 truncate text-content/45">
                {activeAccount.label}
              </span>
            ) : null}
            {windows.map((entry, index) => (
              <UsageWindowSummary key={entry.key} entry={entry} now={now} icon={index === 0 ? harnessIcon : null} />
            ))}
          </span>
        )}
      </button>
      <Popover
        open={open}
        onExitComplete={resetPopup}
        anchor={trigger}
        side="top"
        align="start"
        gap={7}
        width={accountView === "accounts" ? 340 : 300}
        maxHeight={460}
        autoFocus
        onDismiss={dismiss}
        role="dialog"
        aria-label={detailsLabel}
        tabIndex={-1}
        className={`overflow-y-auto text-content ${panelPadding}`}
      >
        {panel}
      </Popover>
    </>
  );
}

function AccountSwitchRow({
  accountLabel,
  onClick,
}: {
  accountLabel: string;
  onClick: () => void;
}) {
  const { t: uiT } = useTranslation();
  return (
    <div className="px-2.5 pt-2.5">
      <button
      type="button"
      className="flex h-8 w-full items-center gap-2 rounded-lg bg-content/[0.045] px-2.5 text-left text-[11px] ring-1 ring-inset ring-content/[0.06] hover:bg-content/[0.08]"
      aria-label={uiT("Switch account from {value0}", {
        value0: String(accountLabel),
      })}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate">{accountLabel}</span>
      <span className="text-[10px] text-content/40">{uiT("Switch")}</span>
      <ChevronRight
        className="size-3 shrink-0 text-content/35"
        aria-hidden
      />
      </button>
    </div>
  );
}

function ProviderAccountPicker({
  providerLabel,
  accounts,
  identities,
  accountId,
  usageFor,
  now,
  onBack,
  onAdd,
  onManage,
  onSelect,
}: {
  providerLabel: string;
  accounts: ProviderAccount[];
  identities: Record<string, ProviderAccountIdentity | null>;
  accountId: string;
  usageFor: (account: ProviderAccount) => ProviderRateLimits | undefined;
  now: number;
  onBack: () => void;
  onAdd: () => void;
  onManage?: () => void;
  onSelect: (accountId: string) => void;
}) {
  const masked = useMaskEmails();
  const showRemaining = useShowRemainingUsage();

  const { t: uiT } = useTranslation();
  const statusId = useId();
  return (
    <div>
      <div className="flex h-7 items-center gap-1">
        <button
          type="button"
          className="grid size-6 place-items-center rounded-md text-content/45 hover:bg-content/6 hover:text-content"
          aria-label={uiT("Back to usage")}
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
        </button>
        <h2 className="desktop-pane-heading text-[13px] font-medium">
          {providerLabel} {uiT("accounts")}
        </h2>
      </div>
      <p className="mt-1 px-1 text-[10px] leading-4 text-content/40">
        {uiT("Each conversation stays pinned to the account that started it.")}
      </p>
      <div
        className="mt-2 flex flex-col gap-1"
        role="group"
        aria-label={uiT("{value0} accounts", { value0: String(providerLabel) })}
      >
        {accounts.map((account) => {
          const selected = account.id === accountId;
          const identity = identities[identityKey(account)];
          const orgTag = identityOrganizationTag(identity);
          const usage = usageFor(account);
          const meters = meterWindows(usage);
          return (
            <div
              key={account.id}
              className={`pointer-events-none relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[11px] ring-1 ring-inset transition-colors ${
                selected
                  ? "bg-accent/10 text-content ring-accent/20"
                  : "bg-content/[0.035] text-content/70 ring-content/[0.06]"
              }`}
            >
              {/* A sibling target keeps the email button out of the selection button. */}
              <button
                type="button"
                aria-pressed={selected}
                aria-label={account.label}
                aria-describedby={`${statusId}-${account.id}`}
                className="pointer-events-auto absolute inset-0 rounded-lg hover:bg-content/[0.04] focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => onSelect(account.id)}
              />
              <span className="min-w-0 flex-1 py-0.5">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="shrink-0 truncate">{account.label}</span>
                  <ProviderAccountSubtitle masked={masked}
                    identity={identity}
                    className="text-[10px] text-content/35"
                  />
                  {orgTag ? (
                    <span className="max-w-[6rem] shrink-0 truncate rounded bg-content/[0.07] px-1 text-[9px] leading-4 text-content/50">
                      {orgTag}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-3 text-[10px]">
                  <span
                    id={`${statusId}-${account.id}`}
                    // Without meters, a long "unknown" reason truncates.
                    className={meters.length > 0 ? "shrink-0" : "min-w-0"}
                  >
                    <AccountStatusLabel
                      status={accountStatus(usage, now)}
                      className="min-w-0"
                    />
                  </span>
                  {meters.length > 0 ? (
                    <span className="flex min-w-0 flex-1 gap-2.5">
                      {meters.map((entry) => (
                        // Short "5h" / "wk" titles, as on the footer chip.
                        <UsageMeter showRemaining={showRemaining}
                          key={entry.title}
                          title={formatWindowLabel(entry.window.windowMinutes)}
                          window={entry.window}
                          now={now}
                          className="min-w-0 flex-1"
                        />
                      ))}
                    </span>
                  ) : null}
                </span>
              </span>
              {selected ? (
                <Check
                  className="size-3.5 shrink-0 text-accent"
                  strokeWidth={1.9}
                  aria-hidden
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <button
      type="button"
      className="mt-2 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11px] text-content/55 hover:bg-content/[0.07] hover:text-content"
      onClick={onAdd}
    >
      <Plus className="size-3.5" aria-hidden />
      {uiT("Add account")}
      </button>
      {onManage ? (
        <button
          type="button"
          className="mt-0.5 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11px] text-content/45 hover:bg-content/[0.07] hover:text-content"
          onClick={() => {
            onManage();
          }}
        >
          {uiT("Manage accounts…")}
        </button>
      ) : null}
    </div>
  );
}

function SwitchSuggestion({
  account,
  limits,
  exhausted,
  now,
  onSwitch,
}: {
  account: ProviderAccount;
  limits: ProviderRateLimits | undefined;
  exhausted: boolean;
  now: number;
  onSwitch: () => void;
}) {
  const { t: uiT } = useTranslation();
  return (
    <section
      data-usage-switch-suggestion
      className={`mb-2.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 ring-inset ${
        exhausted
          ? "bg-red-500/[0.07] ring-red-500/15"
          : "bg-amber-400/10 ring-amber-400/20"
      }`}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${exhausted ? "bg-red-500" : "bg-amber-500"}`}
        aria-hidden
      />
      <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] leading-4">
        <span className="shrink-0 text-content/55">
          {exhausted ? uiT("Out of usage") : uiT("Running low")}{" "}
          {uiT("· switch to")}
        </span>
        <span className="min-w-0 truncate font-medium">{account.label}</span>
        <AccountStatusLabel
          status={accountStatus(limits, now)}
          className="shrink-0 text-[10px]"
        />
      </p>
      <button
      type="button"
      className="h-6 shrink-0 rounded-md bg-content px-2.5 text-[11px] font-medium text-background-base transition-transform duration-150 hover:bg-content/85 active:scale-[0.97]"
      onClick={onSwitch}
    >
      {uiT("Switch")}
      </button>
    </section>
  );
}

function AddProviderAccount({
  providerLabel,
  onBack,
  onAdd,
  onComplete,
}: {
  providerLabel: string;
  onBack: () => void;
  onAdd?: (label: string) => Promise<ProviderAccount>;
  onComplete: () => void;
}) {
  const { t: uiT } = useTranslation();
  const [label, setLabel] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!onAdd || !label.trim() || running) return;
    setRunning(true);
    setError(null);
    try {
      await onAdd(label);
      onComplete();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not add this account",
      );
      setRunning(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="flex h-7 items-center gap-1">
        <button
          type="button"
          className="grid size-6 place-items-center rounded-md text-content/45 hover:bg-content/6 hover:text-content disabled:opacity-40"
          aria-label={uiT("Back to accounts")}
          disabled={running}
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
        </button>
        <h2 className="desktop-pane-heading text-[13px] font-medium">
          {uiT("Add ")}
          {providerLabel} {uiT("account")}
        </h2>
      </div>
      <p className="mt-1 px-1 text-[10px] leading-4 text-content/40">
        {uiT(
          "Give this account a local name, then finish sign-in in your browser.",
        )}
      </p>
      <label className="mt-3 block text-[10px] font-medium text-content/55">
        {uiT("Account name")}
        <input data-ui="input"
          autoFocus
          type="text"
          maxLength={48}
          value={label}
          disabled={running}
          placeholder={uiT("Work or Personal")}
          className="mt-1.5 h-8 w-full rounded-lg border border-content/10 bg-content/[0.04] px-2.5 text-[11px] text-content outline-none placeholder:text-content/25 focus:border-input-border-hover disabled:opacity-55"
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <button
      type="submit"
      className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-content px-3 text-[11px] font-medium text-background-base hover:bg-content/85 disabled:cursor-default disabled:opacity-45"
      disabled={running || !label.trim()}
    >
      {running ? (
        <RefreshCw className="size-3.5 animate-spin" aria-hidden />
      ) : null}
      {running ? uiT("Waiting for browser…") : uiT("Sign in and add account")}
      </button>
      {error ? (
        <p className="mt-2 text-[10px] leading-4 text-red-500" role="status">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function usageWindows(limits: ProviderRateLimits): UsageWindowEntry[] {
  return [
    limits.session
      ? ({ key: "session", window: limits.session } as const)
      : null,
    limits.weekly ? ({ key: "weekly", window: limits.weekly } as const) : null,
    limits.monthly
      ? ({ key: "monthly", window: limits.monthly } as const)
      : null,
  ].filter((entry): entry is UsageWindowEntry => entry != null);
}

function UsageWindowSummary({ entry, now, icon }: { entry: UsageWindowEntry; now: number; icon: ReactNode }) {
  const { t: uiT } = useTranslation();
  const { window } = entry;
  const pct = window.resetsAt != null && window.resetsAt <= now
    ? 0
    : clampUsedPercent(window.usedPercent);
  const remaining = 100 - pct;
  const duration = formatWindowLabel(window.windowMinutes);
  const label = duration === "wk" ? uiT("Week") : duration === "mo" ? uiT("Month") : duration;
  return (
    <span data-ui="session-usage-window" data-window={entry.key} className="contents">
      <span aria-hidden>{icon}</span>
      <span className="text-content/45">{label}</span>
      <span
        role="progressbar"
        aria-label={uiT("{value0} limit {value1}", { value0: label, value1: uiT("remaining") })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(remaining)}
        className="h-1 min-w-0 overflow-hidden rounded-full bg-content/10"
      >
        <span className={`block h-full rounded-full ${barClass(pct)}`} style={{ width: `${remaining}%` }} />
      </span>
      <span className="text-content/60">
        {uiT("{value0} left", { value0: formatUsagePercent(remaining) })}
      </span>
    </span>
  );
}

function UsageWindowRow({
  kind,
  window,
  now,
}: {
  kind: UsageWindowEntry["key"];
  window: RateLimitWindow;
  now: number;
}) {
  const { t: uiT } = useTranslation();
  const showRemaining = useShowRemainingUsage();
  const pct = clampUsedPercent(window.usedPercent);
  const remaining = 100 - pct;
  const shown = showRemaining ? remaining : pct;
  const title =
    kind === "session"
      ? "5-hour limit"
      : kind === "weekly"
        ? "Weekly limit"
        : kind === "monthly"
          ? "Monthly limit"
          : `${formatWindowLabel(window.windowMinutes)} limit`;
  const reset =
    window.resetsAt == null
      ? uiT("{value0} window", {
          value0: String(formatWindowLabel(window.windowMinutes)),
        })
      : resetLabel(window.resetsAt - now, uiT);
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h3 className="desktop-section-heading shrink-0 text-[11px] font-medium text-content/70">
          {uiT(title)}
        </h3>
        <span
          className="min-w-0 flex-1 truncate text-[10px] tabular-nums text-content/40"
          title={
            window.resetsAt == null
              ? undefined
              : new Date(window.resetsAt).toLocaleString()
          }
        >
          {reset}
        </span>
        <span className="shrink-0 text-[11px] font-medium tabular-nums">
          {formatUsagePercent(shown)}{" "}
          {showRemaining ? uiT("remaining") : uiT("used")}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-content/10"
        role="progressbar"
        aria-label={`${title} ${showRemaining ? "remaining" : "used"}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown)}
      >
        <span
          className={`block h-full rounded-full ${barClass(pct)}`}
          style={{ width: `${shown}%` }}
        />
      </div>
    </section>
  );
}

function resetLabel(ms: number, uiT: Translate): string {
  const duration = formatResetDuration(ms);
  return duration === "now"
    ? uiT("Resets now")
    : uiT("Resets in {value0}", { value0: duration });
}

function BankedResets({
  limits,
  now,
  action,
  activeResetKey,
  error,
  mascotProject,
  mascotName,
  mascotColor,
  onConfirm,
  onCancel,
  onUse,
  canUse,
}: {
  limits: ProviderRateLimits;
  now: number;
  action: ResetActionState;
  activeResetKey: string | null;
  error: string | null;
  mascotProject: string;
  mascotName: string | null;
  mascotColor: string;
  onConfirm: (rowKey: string) => void;
  onCancel: () => void;
  onUse: (credit: RateLimitResetCredit | undefined, rowKey: string) => void;
  canUse: boolean;
}) {
  const { t: uiT } = useTranslation();
  const count = limits.resetCredits?.availableCount ?? 0;
  if (count <= 0) return null;

  const detailedCredits = (limits.resetCredits?.credits ?? []).filter(
    (credit) => credit.status === "available" || credit.status === "unknown",
  );
  const unlistedCount = Math.max(0, count - detailedCredits.length);
  const rows: Array<RateLimitResetCredit | null> = [
    ...detailedCredits,
    ...Array.from({ length: unlistedCount }, () => null),
  ];
  return (
    <section className="mt-2.5 border-t border-content/[0.08] pt-2.5">
      <div className="relative min-h-[78px] overflow-hidden rounded-lg bg-content/[0.04] px-3 py-3 pr-[84px] ring-1 ring-inset ring-content/[0.06]">
        <div className="relative z-10 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="desktop-section-heading text-[11px] font-medium">{uiT("Banked resets")}</h3>
            <span className="rounded-full bg-content/[0.07] px-1.5 py-px text-[9px] font-medium tabular-nums text-content/65 ring-1 ring-inset ring-content/[0.07]">
              {count}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] leading-4 text-content/40">
            {uiT("{count} reset{plural} available", {
              count,
              plural: count === 1 ? "" : "s",
            })}
          </p>
        </div>
        <BankedResetMascot
          project={mascotProject}
          name={mascotName}
          color={mascotColor}
        />
      </div>

      <div
        className="mt-2 max-h-56 overflow-y-auto overscroll-contain"
        aria-label={uiT("Available banked resets")}
      >
        <div className="flex flex-col gap-1.5">
          {rows.map((credit, index) => {
            const rowKey = credit?.id ?? `unlisted-${index}`;
            const selected = activeResetKey === rowKey;
            return (
              <BankedResetRow
                key={rowKey}
                credit={credit}
                index={index}
                now={now}
                action={selected ? action : "idle"}
                error={selected ? error : null}
                disabled={action === "using" && !selected}
                canUse={canUse}
                onConfirm={() => onConfirm(rowKey)}
                onCancel={onCancel}
                onUse={() => onUse(credit ?? undefined, rowKey)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BankedResetMascot({
  project,
  name,
  color,
}: {
  project: string;
  name: string | null;
  color: string;
}) {
  const mascot = projectMascot(project, name);
  return (
    <div
      className="reset-mascot-scene"
      data-reset-mascot-mood="happy"
      data-mascot-name={mascot.name}
      style={{ color }}
      aria-hidden
    >
      <span className="reset-mascot-glow" />
      <span className="reset-mascot-spark reset-mascot-spark-a" />
      <span className="reset-mascot-spark reset-mascot-spark-b" />
      <Omi expression="joyful" compact className="reset-mascot-sprite" />
    </div>
  );
}

function BankedResetRow({
  credit,
  index,
  now,
  action,
  error,
  disabled,
  canUse,
  onConfirm,
  onCancel,
  onUse,
}: {
  credit: RateLimitResetCredit | null;
  index: number;
  now: number;
  action: ResetActionState;
  error: string | null;
  disabled: boolean;
  canUse: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUse: () => void;
}) {
  const { t: uiT } = useTranslation();
  return (
    <article className="rounded-lg bg-content/[0.04] px-2.5 py-2 ring-1 ring-inset ring-content/[0.06]">
      <h4 className="text-[10px] font-medium leading-4 text-content/70">
        {credit?.title ??
          uiT("Banked reset {value0}", { value0: String(index + 1) })}
      </h4>
      {credit?.description ? (
        <p className="mt-0.5 text-[10px] leading-4 text-content/45">
          {credit.description}
        </p>
      ) : null}
      <div className="mt-1.5 flex min-h-6 items-center justify-between gap-2">
        <p
          className="min-w-0 truncate text-[10px] tabular-nums text-content/40"
          title={
            credit?.expiresAt == null
              ? undefined
              : new Date(credit.expiresAt).toLocaleString()
          }
        >
          {credit?.expiresAt == null
            ? uiT("Expiry not provided")
            : credit.expiresAt <= now
              ? uiT("Expires now")
              : uiT("Expires in {value0}", {
                  value0: String(formatResetDuration(credit.expiresAt - now)),
                })}
        </p>
        {action === "using" ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-content/45">
            <RefreshCw
              className="size-3 animate-spin"
              aria-hidden
            />
            {uiT("Applying…")}
          </span>
        ) : isResetOutcome(action) || action === "error" ? (
          <span
            className={`shrink-0 text-[10px] ${
              action === "reset"
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-content/50"
            }`}
            role="status"
          >
            {action === "error" ? error : resetOutcomeLabel(action)}
          </span>
        ) : canUse && action !== "confirming" ? (
          <button
            type="button"
            className="h-6 shrink-0 rounded-md bg-content/[0.07] px-2.5 text-[10px] font-medium text-content/70 ring-1 ring-inset ring-content/[0.08] transition-[background-color,color,transform] duration-150 ease-out hover:bg-content/[0.11] hover:text-content active:scale-[0.97] disabled:pointer-events-none disabled:opacity-35"
            disabled={disabled}
            onClick={onConfirm}
          >
            {uiT("Use reset")}
          </button>
        ) : null}
      </div>
      {action === "confirming" ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-content/[0.07] pt-2">
          <p className="text-[10px] leading-4 text-content/50">
            {uiT("Spend this reset now?")}
          </p>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="h-6 rounded-md px-2 text-[10px] text-content/50 hover:bg-content/6 hover:text-content"
              onClick={onCancel}
            >
              {uiT("Cancel")}
            </button>
            <button
              type="button"
              className="h-6 rounded-md bg-content px-2.5 text-[10px] font-medium text-background-base transition-transform duration-150 ease-out active:scale-[0.97]"
              onClick={onUse}
            >
              {uiT("Confirm")}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function EmptyUsageState({
  limits,
  loading,
}: {
  limits: ProviderRateLimits;
  loading: boolean;
}) {
  const { t: uiT } = useTranslation();
  return (
    <div className="rounded-lg bg-content/[0.04] px-3 py-4 text-center ring-1 ring-inset ring-content/[0.06]">
      <p className="text-[11px] font-medium text-content/65">
        {loading
          ? uiT("Loading usage…")
          : needsProviderLogin(limits)
            ? uiT("Not connected")
            : uiT("Usage unavailable")}
      </p>
      {limits.error ? (
        <p className="mx-auto mt-1 max-w-[15rem] text-[10px] leading-4 text-content/40">
          {uiT(limits.error)}
        </p>
      ) : null}
    </div>
  );
}

export function needsProviderLogin(limits: ProviderRateLimits): boolean {
  if (limits.status !== "error" && limits.status !== "unavailable") return false;
  const text = limits.error?.toLowerCase() ?? "";
  return (
    text.includes("expired") ||
    text.includes("sign-in") ||
    text.includes("not signed in") ||
    text.includes("not connected") ||
    text.includes("not authenticated") ||
    text.includes("authentication required") ||
    text.includes("not logged in")
  );
}

function updatedLabel(
  limits: ProviderRateLimits,
  now: number,
  uiT: Translate,
): string {
  if (limits.updatedAt <= 0) return uiT("Rate-limit details");
  const elapsedMinutes = Math.max(
    0,
    Math.floor((now - limits.updatedAt) / 60_000),
  );
  if (elapsedMinutes === 0) return uiT("Updated just now");
  if (elapsedMinutes < 60)
    return uiT("Updated {value0}m ago", { value0: String(elapsedMinutes) });
  return uiT("Updated {value0}h ago", {
    value0: String(Math.floor(elapsedMinutes / 60)),
  });
}

function resetOutcomeLabel(outcome: CodexRateLimitResetOutcome): string {
  if (outcome === "reset") return "Codex usage was reset.";
  if (outcome === "nothingToReset") return "There’s no active usage to reset.";
  if (outcome === "noCredit") return "No banked resets are available.";
  return "That reset was already used.";
}

function isResetOutcome(
  value: ResetActionState,
): value is CodexRateLimitResetOutcome {
  return (
    value === "reset" ||
    value === "nothingToReset" ||
    value === "noCredit" ||
    value === "alreadyRedeemed"
  );
}

function emptyUsageLabel(limits: ProviderRateLimits): string {
  if (limits.status !== "error") return "—";
  const text = limits.error?.toLowerCase() ?? "";
  if (text.includes("expired") || text.includes("sign-in")) return "expired";
  return "—";
}
