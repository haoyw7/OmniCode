import { useTranslation } from "../shared/i18n/useTranslation";
import type { HostConnectionStatus } from "./client";

/** Untranslated status label; pass it through `t`. */
export function hostStatusLabel(status: HostConnectionStatus): string {
  return status.state === "connected"
      ? "Connected"
      : status.state === "reconnecting"
        ? "Reconnecting…"
        : status.state === "disconnected"
          ? "Disconnected"
          : status.reason === "authentication"
            ? "Authentication failed"
            : status.reason === "timeout"
              ? "Connection timed out"
              : status.reason === "identity"
                ? "Host identity changed"
                : "Connection failed";
}

export function MobileHostStatus({ status, dotOnly = false }: { status: HostConnectionStatus; dotOnly?: boolean }) {
  const { t } = useTranslation();
  const label = hostStatusLabel(status);
  return (
    <span
      className="mobile-host-status"
      data-state={status.state}
      role="status"
      aria-label={t(label)}
      title={status.detail || t(label)}
    >
      <span className="mobile-host-status-dot" aria-hidden="true" />
      {!dotOnly && status.state !== "connected" && (
        <span className="mobile-host-status-label">{t(label)}</span>
      )}
    </span>
  );
}
