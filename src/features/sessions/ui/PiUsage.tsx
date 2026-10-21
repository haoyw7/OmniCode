import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { piUsageQuery } from "../../providers/model/piUsageQueries";
import { rateLimitsSnapshot } from "../../providers/model/rateLimitsQueries";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { RefreshCw } from "../../../shared/ui/icons";
import { HarnessIcon } from "./HarnessIcon";
import {
  piBillingProvider,
  piUsageProvider,
  type PiUsageProvider,
} from "../../providers/model/piUsage";
import {
  type ProviderRateLimits,
} from "../../providers/model/rateLimits";
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
      <Button variant="ghost" size="content"
        type="button"
        aria-label={uiT("Refresh Pi usage")}
        title={uiT("Refresh Pi usage")}
        disabled={fetching}
        onClick={() => refresh()}
        className="grid size-6 shrink-0 place-items-center rounded text-content/40 hover:bg-content/6 hover:text-content disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <RefreshCw
          className={cn("size-2.5", fetching ? "motion-safe:animate-spin" : "")}
          aria-hidden
        />
      </Button>
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
  const view = useId();
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const query = useQuery({ ...piUsageQuery(provider, view), enabled: visible }, queryClient);
  return {
    limits: rateLimitsSnapshot(piBillingProvider(provider), query.data, query.isFetching),
    refresh: () => { void query.refetch(); },
  };
}
