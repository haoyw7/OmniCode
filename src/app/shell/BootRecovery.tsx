import { useEffect } from "react";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { Omi } from "../../shared/ui/branding/Omi";
import { dismissToast, toast } from "../../shared/ui/primitives/Toast";
import { WindowDragBar } from "./WindowChrome";

/** Keep the startup surface until a verified Host can open the workspace. */
export function BootRecovery({ error, onRetry }: {
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const detail = error instanceof Error ? error.message : String(error);
    const id = toast(`${t("Could not connect to shared conversations.")}\n${detail}`, {
      position: "top-right",
      variant: "warning",
      durationMs: 0,
      actionLabel: t("Retry"),
      onAction: onRetry,
      dedupeKey: "desktop-host-startup",
    });
    return () => dismissToast(id);
  }, [error, onRetry, t]);

  return (
    <div className="relative flex h-screen items-center justify-center bg-background-base text-content">
      <div className="absolute inset-x-0 top-0"><WindowDragBar /></div>
      <Omi animated className="size-27" aria-label="OmniCode" />
    </div>
  );
}
