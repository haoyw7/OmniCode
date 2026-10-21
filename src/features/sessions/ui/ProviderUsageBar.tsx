import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { RefreshCw } from "../../../shared/ui/icons";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { HarnessIcon } from "./HarnessIcon";
import { Popover, type PopoverDismissReason } from "../../../shared/ui/Popover";
import { consumeCodexRateLimitResetCredit } from "../../providers/model/rateLimitsFetch";
import {
  errorRateLimits,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "../../providers/model/rateLimits";
import {
  getCachedRateLimits,
  loadRateLimits,
  setCachedRateLimits,
} from "../../providers/model/rateLimitsQueries";
import {
  HARNESS_LABEL,
  HARNESS_TITLE,
} from "../model/session";
import {
  loginHarness,
  supportsHarnessLogin,
} from "../../../integrations/harness/core/auth";
import { UsageProviderChip } from "./UsageProviderChip";
import { PiUsage } from "./PiUsage";
import {
  ProviderSignInPanel,
  type ProviderSignInState,
} from "./ProviderSignInPanel";
import {
  newProviderAccount,
  saveProviderAccount,
  selectProviderAccount,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import { useProviderUsage, useUsageClock } from "../../providers/model/useProviderUsage";
import { hasSessionUsage, type UsageSession } from "../../providers/model/sessionUsage";
import { WorkBuddyAccountPicker } from "./WorkBuddyAccountPicker";
import { DeepseekUsage } from "./DeepseekUsage";

function usageProvidersFor(session?: UsageSession): RateLimitProvider[] {
  return session?.harness === "claude" ||
    session?.harness === "codex" ||
    session?.harness === "opencode"
    ? [session.harness]
    : [];
}

/**
 * Provider usage, refresh and sign-in for one conversation's status card.
 */
export function ProviderUsageBar({
  providers: providerList,
  session,
  project,
  onSelectAccount,
  onManageAccounts,
  render,
}: {
  providers?: RateLimitProvider[];
  session?: UsageSession;
  project?: string;
  onSelectAccount?: (
    provider: ProviderAccountProvider,
    accountId: string,
  ) => void;
  onManageAccounts?: (provider: ProviderAccountProvider) => void;
  /** Keeps usage loaded while a containing card hides its controls. */
  render?: (controls: ReactNode, limits?: ProviderRateLimits, summary?: ReactNode) => ReactNode;
}) {
  const { t: uiT } = useTranslation();
  const providers = providerList ?? usageProvidersFor(session);
  const wantClaude = providers.includes("claude");
  const wantCodex = providers.includes("codex");
  const wantOpencode = providers.includes("opencode");
  const now = useUsageClock();
  const actionScope = useId();
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    scope: { id: `provider-usage:${actionScope}` },
    retry: false,
  }, queryClient);
  const execute = useCallback(<T,>(run: () => Promise<T>) => action.mutateAsync(run) as Promise<T>, [action.mutateAsync]);
  const refreshing = action.isPending;
  const inflight = useRef<Promise<void> | null>(null);
  const {
    limits: claude,
    accountId: claudeAccountId,
    accounts: claudeAccounts,
    available: claudeAccountAvailable,
  } = useProviderUsage("claude", session, project, wantClaude);
  const {
    limits: codex,
    accountId: codexAccountId,
    accounts: codexAccounts,
    available: codexAccountAvailable,
    local: codexLocal,
  } = useProviderUsage("codex", session, project, wantCodex);
  const { limits: opencode } = useProviderUsage(
    "opencode",
    session,
    project,
    wantOpencode,
  );

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    const operation = execute(async () => {
      const jobs: Promise<unknown>[] = [];
      if (wantClaude && claudeAccountAvailable) jobs.push(loadRateLimits("claude", claudeAccountId, true));
      if (wantCodex && codexAccountAvailable) jobs.push(loadRateLimits("codex", codexAccountId, true));
      if (wantOpencode) jobs.push(loadRateLimits("opencode", "default", true));
      await Promise.allSettled(jobs);
    }).finally(() => { if (inflight.current === operation) inflight.current = null; });
    inflight.current = operation;
    return operation;
  }, [execute, claudeAccountAvailable, claudeAccountId, codexAccountAvailable, codexAccountId, wantClaude, wantCodex, wantOpencode]);

  const consumeCodexReset = useCallback((creditId?: string) => execute(async () => {
    try {
      const outcome = await consumeCodexRateLimitResetCredit(creditId, codexAccountId);
      await loadRateLimits("codex", codexAccountId, true);
      return outcome;
    } catch (error) {
      setCachedRateLimits("codex", codexAccountId, errorRateLimits("codex",
        errorMessage(error) ?? "Could not use Codex reset", getCachedRateLimits("codex", codexAccountId)));
      throw error;
    }
  }), [execute, codexAccountId]);

  const reconnectProvider = useCallback((provider: RateLimitProvider, accountId: string) => execute(async () => {
    try {
      await (accountId === "default" ? loginHarness(provider) : loginHarness(provider, accountId));
      const value = await loadRateLimits(provider, accountId, true);
      if (value.status !== "ok") throw new Error(value.error || `${HARNESS_TITLE[provider]} sign-in could not be verified`);
    } catch (error) {
      setCachedRateLimits(provider, accountId, errorRateLimits(provider,
        errorMessage(error) ?? "Could not complete sign-in", getCachedRateLimits(provider, accountId)));
      throw error;
    }
  }), [execute]);

  const reconnectClaude = useCallback(
    () => reconnectProvider("claude", claudeAccountId),
    [claudeAccountId, reconnectProvider],
  );

  const reconnectCodex = useCallback(
    () => reconnectProvider("codex", codexAccountId),
    [codexAccountId, reconnectProvider],
  );

  const selectAccount = useCallback(
    (provider: ProviderAccountProvider, accountId: string) => {
      // A started conversation switches itself; drafts change this project's
      // default for new conversations.
      if (!(session?.harness === provider && session.providerAccountId))
        selectProviderAccount(provider, project, accountId);
      onSelectAccount?.(provider, accountId);
    },
    [onSelectAccount, project, session?.harness, session?.providerAccountId],
  );

  const addAccount = useCallback(
    (provider: ProviderAccountProvider, label: string) => execute(async () => {
      const account = newProviderAccount(provider, label);
      await loginHarness(provider, account.id);
      saveProviderAccount(account);
      selectAccount(provider, account.id);
      return account;
    }),
    [selectAccount, execute],
  );

  const showOpencodeChip = wantOpencode && opencode.status !== "unavailable";
  const showUsage = wantClaude || wantCodex || showOpencodeChip;
  if (session?.harness === "deepseek")
    return hasSessionUsage(session)
      ? <DeepseekUsage key={session.id} project={project} render={render} />
      : null;
  if (session?.harness === "workbuddy") return present(<WorkBuddyAccountPicker session={session} onChange={id => selectAccount("workbuddy", id)} />);

  if (session?.harness === "pi")
    return (
      <PiUsage
        key={`${session.id}:${session.model}`}
        model={session.model}
        now={now}
        render={render}
      />
    );
  if (!showUsage)
    return present(session ? (
      <SessionChip
        key={session.id ?? session.harness}
        session={session}
      />
    ) : null);
  return present(
    <>
      {wantClaude ? (
        <UsageProviderChip
          key={`claude:${session?.id ?? ""}`}
          limits={claude}
          now={now}
          accounts={claudeAccounts}
          identitySource={session?.nativeSession ? "local" : "host"}
          accountId={claudeAccountId}
          onSelectAccount={(accountId) => selectAccount("claude", accountId)}
          onAddAccount={(label) => addAccount("claude", label)}
          onManageAccounts={
            onManageAccounts ? () => onManageAccounts("claude") : undefined
          }
          onReconnect={reconnectClaude}
        />
      ) : null}
      {wantCodex ? (
        <UsageProviderChip
          key={`codex:${session?.id ?? ""}`}
          limits={codex}
          now={now}
          project={project}
          accounts={codexAccounts}
          identitySource={session?.nativeSession ? "local" : "host"}
          accountId={codexAccountId}
          onSelectAccount={(accountId) => selectAccount("codex", accountId)}
          onAddAccount={(label) => addAccount("codex", label)}
          onManageAccounts={
            onManageAccounts ? () => onManageAccounts("codex") : undefined
          }
          onConsumeReset={codexLocal ? consumeCodexReset : undefined}
          onReconnect={reconnectCodex}
        />
      ) : null}
      {showOpencodeChip ? (
        <UsageProviderChip
          key={`opencode:${session?.id ?? ""}`}
          limits={opencode}
          now={now}
          project={project}
        />
      ) : null}
      <Button variant="ghost" size="content"
        type="button"
        className="grid size-7 shrink-0 place-items-center rounded-lg text-content/40 hover:bg-content/6 hover:text-content disabled:opacity-50"
        aria-label={uiT("Refresh usage")}
        title={uiT("Refresh usage")}
        disabled={refreshing}
        onClick={() => void refresh()}
      >
        <RefreshCw
          className={cn("size-2.5", refreshing ? "motion-safe:animate-spin" : "")}
          aria-hidden
        />
      </Button>
    </>,
    wantClaude ? claude : wantCodex ? codex : opencode,
  );

  function present(controls: ReactNode, limits?: ProviderRateLimits) {
    return render ? render(controls, limits) : controls;
  }
}

function SessionChip({
  session,
}: {
  session: UsageSession;
}) {
  const { t: uiT } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const login = useMutation({ mutationFn: () => loginHarness(session.harness), onSuccess: () => setOpen(false) }, queryClient);
  const loginState: ProviderSignInState = login.isPending ? "running" : login.isSuccess ? "complete" : login.isError ? "error" : "idle";
  const loginError = errorMessage(login.error) ?? null;
  const authRequired = Boolean(
    session.authRequired && loginState !== "complete",
  );
  const canLogin = authRequired && supportsHarnessLogin(session.harness);

  useEffect(() => {
    if (!session.authRequired && loginState === "complete") {
      login.reset();
    }
  }, [loginState, session.authRequired, login.reset]);

  const dismiss = (reason: PopoverDismissReason) => {
    setOpen(false);
    if (reason === "escape") {
      requestAnimationFrame(() => trigger.current?.focus());
    }
  };

  const signIn = () => login.mutate();

  if (!canLogin) {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
        title={HARNESS_TITLE[session.harness]}
      >
        <HarnessIcon harness={session.harness} className="size-3 shrink-0" />
        <span>{HARNESS_LABEL[session.harness]}</span>
      </span>
    );
  }

  const signInPanel = (
    <ProviderSignInPanel
      harness={session.harness}
      state={loginState}
      error={loginError}
      onSignIn={() => void signIn()}
    />
  );

  return (
    <>
      <Button variant="ghost" size="content"
      ref={trigger}
      type="button"
      className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 whitespace-nowrap text-content/55 hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
      aria-label={uiT("{value0} sign-in required", {
        value0: String(HARNESS_TITLE[session.harness]),
      })}
      aria-expanded={open}
      aria-haspopup="dialog"
      title={uiT("{value0} sign-in required", {
        value0: String(HARNESS_TITLE[session.harness]),
      })}
      onClick={() => setOpen((value) => !value)}
    >
      <HarnessIcon harness={session.harness} className="size-3 shrink-0" />
      <span>{HARNESS_LABEL[session.harness]}</span>
      {authRequired ? (
        <span className="text-[10px] text-amber-600 dark:text-amber-300">
          {uiT("sign in")}
        </span>
      ) : null}
      </Button>
      <Popover
        open={open}
        anchor={trigger}
        side="top"
        align="start"
        gap={7}
        width={300}
        autoFocus
        onDismiss={dismiss}
        role="dialog"
        aria-label={uiT("{value0} sign-in", {
          value0: String(HARNESS_TITLE[session.harness]),
        })}
        tabIndex={-1}
        className="text-content"
      >
        {signInPanel}
      </Popover>
    </>
  );
}
