import { PresenceBoundary } from "../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { RefreshCw } from "../../shared/ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import { Popover, type PopoverDismissReason } from "../../shared/ui/Popover";
import { consumeCodexRateLimitResetCredit } from "../../features/providers/model/rateLimitsFetch";
import {
  errorRateLimits,
  type RateLimitProvider,
} from "../../features/providers/model/rateLimits";
import {
  getCachedRateLimits,
  loadRateLimits,
  setCachedRateLimits,
} from "../../features/providers/model/rateLimitsCache";
import {
  HARNESS_LABEL,
  HARNESS_TITLE,
  type HarnessId,
  type Session,
} from "../../features/sessions/model/session";
import {
  loginHarness,
  supportsHarnessLogin,
} from "../../integrations/harness/core/auth";
import { latestTurnNeedsHarnessLogin } from "../../integrations/harness/core/authSupport";
import { UsageProviderChip, type UsageInline } from "./UsageProviderChip";
import { PiUsage } from "./PiUsage";
import {
  ProviderSignInPanel,
  type ProviderSignInState,
} from "../../features/sessions/ui/ProviderSignInPanel";
import {
  conversationProviderAccountId,
  newProviderAccount,
  saveProviderAccount,
  selectProviderAccount,
  type ProviderAccountProvider,
} from "../../features/providers/model/providerAccounts";
import { useProviderUsage, useUsageClock } from "./useProviderUsage";

export type UsageSession = {
  id?: string;
  harness: HarnessId;
  model?: string;
  authRequired?: boolean;
  nativeSession?: boolean;
  /** Pinned account of a started conversation; absent for a draft. */
  providerAccountId?: string;
};

/** The usage identity of a conversation: its harness, model and account. */
export function usageSessionFor(session: Session): UsageSession {
  return {
    id: session.id,
    harness: session.harness,
    model: session.model,
    authRequired: latestTurnNeedsHarnessLogin(session.blocks),
    nativeSession: !!session.nativeSession,
    providerAccountId: conversationProviderAccountId(session),
  };
}

function usageProvidersFor(session?: UsageSession): RateLimitProvider[] {
  return session?.harness === "claude" ||
    session?.harness === "codex" ||
    session?.harness === "opencode"
    ? [session.harness]
    : [];
}

/**
 * Provider usage chips, refresh and sign-in for one conversation. `inline`
 * renders them inside another menu, expanding the details in place.
 */
export function ProviderUsageBar({
  providers: providerList,
  session,
  project,
  onSelectAccount,
  onManageAccounts,
  inline,
}: {
  providers?: RateLimitProvider[];
  session?: UsageSession;
  project?: string;
  onSelectAccount?: (
    provider: ProviderAccountProvider,
    accountId: string,
  ) => void;
  onManageAccounts?: (provider: ProviderAccountProvider) => void;
  inline?: UsageInline;
}) {
  const { t: uiT } = useTranslation();
  const providers = providerList ?? usageProvidersFor(session);
  const wantClaude = providers.includes("claude");
  const wantCodex = providers.includes("codex");
  const wantOpencode = providers.includes("opencode");
  const now = useUsageClock();
  const [refreshing, setRefreshing] = useState(false);
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
  } = useProviderUsage("codex", session, project, wantCodex);
  const { limits: opencode } = useProviderUsage(
    "opencode",
    session,
    project,
    wantOpencode,
  );

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    setRefreshing(true);
    const jobs: Promise<unknown>[] = [];
    if (wantClaude && claudeAccountAvailable)
      jobs.push(loadRateLimits("claude", claudeAccountId, true));
    if (wantCodex && codexAccountAvailable)
      jobs.push(loadRateLimits("codex", codexAccountId, true));
    if (wantOpencode) jobs.push(loadRateLimits("opencode", "default", true));
    const run = Promise.allSettled(jobs)
      .then(() => undefined)
      .finally(() => {
        inflight.current = null;
        setRefreshing(false);
      });
    inflight.current = run;
    return run;
  }, [
    claudeAccountAvailable,
    claudeAccountId,
    codexAccountAvailable,
    codexAccountId,
    wantClaude,
    wantCodex,
    wantOpencode,
  ]);

  const consumeCodexReset = useCallback(
    async (creditId?: string) => {
      while (inflight.current) await inflight.current;
      setRefreshing(true);
      let outcome: Awaited<ReturnType<typeof consumeCodexRateLimitResetCredit>>;
      const operation = (async () => {
        try {
          outcome = await consumeCodexRateLimitResetCredit(
            creditId,
            codexAccountId,
          );
          await loadRateLimits("codex", codexAccountId, true);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Could not use Codex reset";
          setCachedRateLimits(
            "codex",
            codexAccountId,
            errorRateLimits(
              "codex",
              message,
              getCachedRateLimits("codex", codexAccountId),
            ),
          );
          throw error;
        }
      })();
      const tracked = operation.finally(() => {
        inflight.current = null;
        setRefreshing(false);
      });
      inflight.current = tracked.catch(() => undefined);
      await tracked;
      return outcome!;
    },
    [codexAccountId],
  );

  const reconnectProvider = useCallback(
    async (provider: RateLimitProvider, accountId: string) => {
      while (inflight.current) await inflight.current;
      setRefreshing(true);
      const operation = (async () => {
        try {
          await (accountId === "default"
            ? loginHarness(provider)
            : loginHarness(provider, accountId));
          const value = await loadRateLimits(provider, accountId, true);
          if (value.status !== "ok") {
            throw new Error(
              value.error ||
                `${HARNESS_TITLE[provider]} sign-in could not be verified`,
            );
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Could not complete sign-in";
          setCachedRateLimits(
            provider,
            accountId,
            errorRateLimits(
              provider,
              message,
              getCachedRateLimits(provider, accountId),
            ),
          );
          throw error;
        }
      })();
      const tracked = operation.finally(() => {
        inflight.current = null;
        setRefreshing(false);
      });
      inflight.current = tracked.catch(() => undefined);
      await tracked;
    },
    [],
  );

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
      // A started conversation switches itself; only drafts and the footer
      // change this project's default for new conversations.
      if (!(session?.harness === provider && session.providerAccountId))
        selectProviderAccount(provider, project, accountId);
      onSelectAccount?.(provider, accountId);
    },
    [onSelectAccount, project, session?.harness, session?.providerAccountId],
  );

  const addAccount = useCallback(
    async (provider: ProviderAccountProvider, label: string) => {
      const account = newProviderAccount(provider, label);
      await loginHarness(provider, account.id);
      saveProviderAccount(account);
      selectAccount(provider, account.id);
      return account;
    },
    [selectAccount],
  );

  const showOpencodeChip = wantOpencode && opencode.status !== "unavailable";
  const showUsage = wantClaude || wantCodex || showOpencodeChip;

  if (session?.harness === "pi")
    return (
      <PiUsage
        key={`${session.id}:${session.model}`}
        model={session.model}
        now={now}
        inline={inline}
      />
    );
  if (!showUsage)
    return session ? (
      <SessionChip
        key={session.id ?? session.harness}
        session={session}
        inline={inline}
      />
    ) : null;
  return (
    <>
      {wantClaude ? (
        <UsageProviderChip
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
          inline={inline}
        />
      ) : null}
      {wantCodex ? (
        <UsageProviderChip
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
          onConsumeReset={consumeCodexReset}
          onReconnect={reconnectCodex}
          inline={inline}
        />
      ) : null}
      {showOpencodeChip ? (
        <UsageProviderChip
          limits={opencode}
          now={now}
          project={project}
          inline={inline}
        />
      ) : null}
      {inline?.expanded ? null : (
        <button
          type="button"
          className={`grid ${inline ? "size-7 rounded-lg" : "size-4.5 rounded"} shrink-0 place-items-center text-content/40 hover:bg-content/6 hover:text-content disabled:opacity-50`}
          aria-label={uiT("Refresh usage")}
          title={uiT("Refresh usage")}
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={`size-2.5 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden
          />
        </button>
      )}
    </>
  );
}

function SessionChip({
  session,
  inline,
}: {
  session: UsageSession;
  inline?: UsageInline;
}) {
  const { t: uiT } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const [chipOpen, setChipOpen] = useState(false);
  const open = inline ? inline.expanded : chipOpen;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (!inline) setChipOpen(value);
    else if (value) inline.onExpand();
    else inline.onCollapse();
  };
  const [loginState, setLoginState] = useState<ProviderSignInState>("idle");
  const [loginError, setLoginError] = useState<string | null>(null);
  const authRequired = Boolean(
    session.authRequired && loginState !== "complete",
  );
  const canLogin = authRequired && supportsHarnessLogin(session.harness);

  useEffect(() => {
    if (!session.authRequired && loginState === "complete") {
      setLoginState("idle");
    }
  }, [loginState, session.authRequired]);

  const dismiss = (reason: PopoverDismissReason) => {
    setOpen(false);
    if (reason === "escape") {
      requestAnimationFrame(() => trigger.current?.focus());
    }
  };

  const signIn = async () => {
    setLoginState("running");
    setLoginError(null);
    try {
      await loginHarness(session.harness);
      setOpen(false);
      setLoginState("complete");
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Could not complete sign-in",
      );
      setLoginState("error");
    }
  };

  if (!canLogin) {
    return (
      <span
        className={`${inline ? "flex h-7 flex-1 px-2" : "inline-flex"} min-w-0 items-center gap-1.5 whitespace-nowrap`}
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
  if (inline?.expanded)
    return (
      <div
        role="group"
        aria-label={uiT("{value0} sign-in", {
          value0: String(HARNESS_TITLE[session.harness]),
        })}
        className="text-content"
      >
        {signInPanel}
      </div>
    );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`${inline ? "flex h-7 flex-1 rounded-lg px-2" : "-mx-1 inline-flex h-5 shrink-0 rounded px-1"} min-w-0 items-center gap-1.5 whitespace-nowrap text-content/55 transition-[background-color,color,transform] duration-150 ease-out hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.97]`}
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
      </button>
      <PresenceBoundary propagate>{open && !inline ? (
        <Popover
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
      ) : null}</PresenceBoundary>
    </>
  );
}
