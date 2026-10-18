import { useTranslation } from "../../shared/i18n/useTranslation";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "../../shared/ui/icons";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import {
  fetchPiUsage,
  piBillingProvider,
  piUsageProvider,
  type PiUsageProvider,
} from "../../features/providers/model/piUsage";
import {
  idleRateLimits,
  RATE_LIMIT_MIN_REFETCH_MS,
  RATE_LIMIT_POLL_MS,
} from "../../features/providers/model/rateLimits";
import { UsageProviderChip, type UsageInline } from "./UsageProviderChip";

export function PiUsage({
  model,
  now,
  inline,
}: {
  model?: string;
  now: number;
  inline?: UsageInline;
}) {
  const { t: uiT } = useTranslation();
  const provider = piUsageProvider(model);
  if (!provider) {
    return (
      <span
        className={`${inline ? "flex h-7 flex-1 px-2" : "inline-flex"} items-center gap-1.5 whitespace-nowrap`}
        title={
          !model || model === "pi:default"
            ? uiT("Send a message so Pi can report its configured provider.")
            : uiT("Subscription usage is not supported for this Pi provider.")
        }
      >
        <HarnessIcon harness="pi" className="size-3 shrink-0" />
        <span>{uiT("pi · Usage unavailable")}</span>
      </span>
    );
  }
  return (
    <PiProviderUsage
      key={provider}
      provider={provider}
      now={now}
      inline={inline}
    />
  );
}

function PiProviderUsage({
  provider,
  now,
  inline,
}: {
  provider: PiUsageProvider;
  now: number;
  inline?: UsageInline;
}) {
  const { t: uiT } = useTranslation();
  const { limits, refresh } = usePiUsage(provider);
  const fetching = limits.status === "fetching";
  return (
    <>
      <UsageProviderChip
        limits={limits}
        now={now}
        presentation={piUsagePresentation(provider)}
        inline={inline}
      />
      {inline?.expanded ? null : (
        <button
          type="button"
          aria-label={uiT("Refresh Pi usage")}
          title={uiT("Refresh Pi usage")}
          disabled={fetching}
          onClick={() => refresh()}
          className="grid size-6 shrink-0 place-items-center rounded text-content/40 hover:bg-content/6 hover:text-content disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <RefreshCw
            className={`size-2.5 ${fetching ? "motion-safe:animate-spin" : ""}`}
            aria-hidden
          />
        </button>
      )}
    </>
  );
}

function piUsagePresentation(provider: PiUsageProvider) {
  return {
    sourceLabel: "Pi's saved OAuth account",
    harness: "pi" as const,
    label: provider === "anthropic" ? "Pi · Anthropic" : "Pi · OpenAI Codex",
  };
}

/** Pi uses its own saved OAuth account rather than a Claude/Codex profile. */
function usePiUsage(provider: PiUsageProvider) {
  const [limits, setLimits] = useState(() =>
    idleRateLimits(piBillingProvider(provider)),
  );
  const refreshRef = useRef<(force?: boolean) => void>(() => undefined);
  useEffect(() => {
    let disposed = false;
    let inflight = false;
    let lastFetchAt = 0;
    const refresh = (force = false) => {
      if (disposed || inflight) return;
      if (
        !force &&
        (document.visibilityState !== "visible" ||
          Date.now() - lastFetchAt < RATE_LIMIT_MIN_REFETCH_MS)
      )
        return;
      inflight = true;
      setLimits({
        ...idleRateLimits(piBillingProvider(provider)),
        status: "fetching",
      });
      void fetchPiUsage(provider)
        .then((result) => {
          if (!disposed) setLimits(result);
        })
        .finally(() => {
          inflight = false;
          lastFetchAt = Date.now();
        });
    };
    refreshRef.current = refresh;
    refresh();
    const timer = window.setInterval(refresh, RATE_LIMIT_POLL_MS);
    const onVisible = () => refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [provider]);
  return { limits, refresh: () => refreshRef.current(true) };
}
