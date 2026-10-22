import { usageLimitLabel } from "../../usage/model/usagePools";
import type { UsageLimitSource } from "../../../integrations/harness/core/usage";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Button } from "../../../shared/ui/forms/Button";
import { X } from "../../../shared/ui/icons";
import { Skeleton } from "../../../shared/ui/primitives/Skeleton";
export function UsageLimitsSnapshot({
  sources,
  loading,
  error,
  onClose,
}: {
  sources: UsageLimitSource[];
  loading: boolean;
  error?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside
      className="usage-limits-snapshot rounded-lg bg-surface p-3 text-ui-base"
      aria-label={t("Usage limits snapshot")}
    >
      <header className="flex items-center justify-between gap-2">
        <strong>{t("Subscription limits")}</strong>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("Close usage limits")}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      {loading ? (
        <Skeleton className="h-8 w-full" />
      ) : error ? (
        <p role="alert">{t(error)}</p>
      ) : sources.length ? (
        <div className="grid gap-2">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              <span className="text-content/60">{source.label}</span>
              {source.windows.map((window) => (
                <span key={window.id}>
                  {usageLimitLabel(window, t)}: {window.usedPercent.toFixed(0)}%{" "}
                  {t("used")}
                </span>
              ))}
              {!source.windows.length ? (
                <span>{t(source.message || "Usage unavailable")}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p>{t("This provider does not report subscription limits.")}</p>
      )}
    </aside>
  );
}
