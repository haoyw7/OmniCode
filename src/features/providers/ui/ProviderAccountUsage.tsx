import { motion } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  clampUsedPercent,
  formatResetDuration,
  formatUsagePercent,
  formatWindowLabel,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../model/rateLimits";
import type {
  AccountStatus,
  AccountStatusTone,
  AccountUsage,
} from "../model/accountUsage";
import { RefreshCw } from "../../../shared/ui/icons";
import { useShowRemainingUsage } from "../../settings/model/displayPrefs";

const STATUS_DOT: Record<AccountStatusTone, string> = {
  ready: "bg-emerald-400",
  low: "bg-amber-400",
  exhausted: "bg-red-400",
  checking: "animate-pulse bg-content/25",
  unknown: "bg-content/25",
};

const STATUS_TEXT: Record<AccountStatusTone, string> = {
  ready: "text-content/60",
  low: "text-amber-400/90",
  exhausted: "text-red-400/90",
  checking: "text-content/35",
  unknown: "text-content/35",
};

/** Dot + word, e.g. "● Ready" or "● Exhausted back in 31m". */
export function AccountStatusLabel({
  status,
  wrap = false,
  className = "",
}: {
  status: AccountStatus;
  /** Lets a long reason wrap instead of truncating, for roomy rows. */
  wrap?: boolean;
  className?: string;
}) {
  const fit = wrap ? "min-w-0 break-words" : "min-w-0 truncate";
  return (
    <span
      className={`inline-flex min-w-0 gap-1.5 ${wrap ? "items-baseline" : "items-center"} ${className}`}
      title={
        status.detail ? `${status.label} · ${status.detail}` : status.label
      }
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${wrap ? "translate-y-[-1px]" : ""} ${STATUS_DOT[status.tone]}`}
        aria-hidden
      />
      <span
        className={`${status.tone === "unknown" ? fit : "shrink-0"} ${STATUS_TEXT[status.tone]}`}
      >
        {status.label}
      </span>
      {status.detail ? (
        <span className={`${fit} text-content/40`}>
          {status.detail}
        </span>
      ) : null}
    </span>
  );
}

export function AccountUsageRefresh({ usage }: { usage: AccountUsage }) {
  const { t: uiT } = useTranslation();
  return (
    <button
      type="button"
      disabled={usage.refreshing}
      onClick={usage.refresh}
      aria-label={uiT("Refresh usage limits")}
      title={uiT("Refresh usage limits")}
      className="grid size-7 place-items-center rounded-md text-content/40 transition-transform duration-150 hover:bg-content/6 hover:text-content active:scale-[0.96] disabled:opacity-40"
    >
      <RefreshCw
        className={`size-3.5 ${usage.refreshing ? "animate-spin" : ""}`}
      />
    </button>
  );
}

/** Titled 5h / weekly / monthly windows an account has data for. */
export function meterWindows(
  limits: ProviderRateLimits | undefined,
): { title: string; window: RateLimitWindow }[] {
  return [
    limits?.session ? { title: "5h", window: limits.session } : null,
    limits?.weekly ? { title: "Weekly", window: limits.weekly } : null,
    limits?.monthly ? { title: "Monthly", window: limits.monthly } : null,
  ].filter((entry) => entry != null);
}

export function UsageMeter({
  title,
  window,
  now,
  className = "w-36",
  showRemaining: remainingOverride,
}: {
  title: string;
  window: RateLimitWindow;
  now: number;
  className?: string;
  /** Mobile explicitly shows remaining quota; desktop retains its preference. */
  showRemaining?: boolean;
}) {
  const { t: uiT } = useTranslation();
  const reduced = useMotionPreference();
  const preferredRemaining = useShowRemainingUsage();
  const showRemaining = remainingOverride ?? preferredRemaining;
  const pct = clampUsedPercent(window.usedPercent);
  const remaining = 100 - pct;
  const shown = showRemaining ? remaining : pct;
  const full = pct >= 100 && (window.resetsAt == null || window.resetsAt > now);
  const reset =
    window.resetsAt == null
      ? formatWindowLabel(window.windowMinutes)
      : window.resetsAt <= now
        ? "reset due"
        : formatResetDuration(window.resetsAt - now);
  return (
    <div
      className={className}
      title={
        window.resetsAt == null
          ? undefined
          : uiT("Resets {value0}", {
              value0: String(new Date(window.resetsAt).toLocaleString()),
            })
      }
    >
      <div className="flex items-baseline justify-between gap-2 text-[10px] leading-3">
        <span className="min-w-0 truncate text-content/40">
          {uiT(title)} · <span className="tabular-nums">{uiT(reset)}</span>
        </span>
        <span
          className={`shrink-0 tabular-nums ${full ? "font-medium text-red-400" : "text-content/60"}`}
        >
          {showRemaining
            ? uiT("{value0} left", {
                value0: String(formatUsagePercent(remaining)),
              })
            : full
              ? uiT("Full")
              : formatUsagePercent(pct)}
        </span>
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-content/10"
        role="progressbar"
        aria-label={uiT("{value0} limit {value1}", {
          value0: uiT(title),
          value1: uiT(showRemaining ? "remaining" : "used"),
        })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown)}
      >
        <motion.span initial={false}
          className={`block h-full rounded-full ${barClass(pct)}`}
          animate={{ width: `${shown}%` }} transition={reduced ? immediateTransition : panelTransition}
        />
      </div>
    </div>
  );
}

export function barClass(pct: number): string {
  if (pct >= 90) return "bg-red-400";
  if (pct >= 80) return "bg-amber-400";
  return "bg-content/45";
}
