import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../../shared/ui/HarnessIcon";
import { fetchPiUsage, piBillingProvider, piUsageProvider, type PiUsageProvider } from "../../providers/model/piUsage";
import { idleRateLimits, RATE_LIMIT_MIN_REFETCH_MS, RATE_LIMIT_POLL_MS } from "../../../domain/rateLimits";
import { type ProviderRateLimits } from "../../../contracts/session";
import { UsageProviderChip } from "./UsageProviderChip";

export function PiUsage({
  model,
  now,
  render,
}: {
  model?: string;
  now: number;
  render?: (controls: ReactNode, limits?: ProviderRateLimits) => ReactNode;
}) {
  const { t: uiT } = useTranslation();
  const provider = piUsageProvider(model);
  if (!provider) {
    const controls = (
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
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
    return render ? render(controls) : controls;
  }
  return (
    <PiProviderUsage
      key={provider}
      provider={provider}
      now={now}
      render={render}
    />
  );
}

function PiProviderUsage({
  provider,
  now,
  render,
}: {
  provider: PiUsageProvider;
  now: number;
  render?: (controls: ReactNode, limits?: ProviderRateLimits) => ReactNode;
}) {
  const { t: uiT } = useTranslation();
  const { limits, refresh } = usePiUsage(provider);
  const fetching = limits.status === "fetching";
  const controls = (
    <>
      <UsageProviderChip
        limits={limits}
        now={now}
        presentation={piUsagePresentation(provider)}
      />
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
    </>
  );
  return render ? render(controls, limits) : controls;
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
