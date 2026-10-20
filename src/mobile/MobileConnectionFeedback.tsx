import { useEffect, useState, useSyncExternalStore } from "react";
import { activePreferenceStore, SHARED_PREFERENCES_STATUS } from "../features/settings/model/sharedPreferences";
import { useTranslation } from "../shared/i18n/useTranslation";
import { IconButton } from "../shared/ui/forms/IconButton";
import { RefreshCw, X } from "../shared/ui/icons";
import type { HostConnectionStatus } from "./client";
import { connectionErrorSummary } from "./connectionError";
import { hostStatusLabel } from "./MobileHostStatus";
import { MobileSpinner } from "./MobileSpinner";

function subscribeSyncError(listener: () => void) {
  window.addEventListener(SHARED_PREFERENCES_STATUS, listener);
  return () => window.removeEventListener(SHARED_PREFERENCES_STATUS, listener);
}

export function useMobileSyncError() {
  return useSyncExternalStore(subscribeSyncError, () => activePreferenceStore()?.error || "", () => "");
}

/** Operation errors expire once; background retries cannot keep the same notice open. */
export function MobileErrorNotice({ message, onRetry, retrying }: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    if (!message) { setDismissed(""); return; }
    const timer = setTimeout(() => setDismissed(message), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  if (!message || dismissed === message) return null;
  return (
    <div className="mobile-error" role="alert">
      <span>{message}</span>
      {onRetry && <IconButton label={t("Reconnect")} disabled={retrying} onClick={onRetry}>
        <RefreshCw size={20} />
      </IconButton>}
      <IconButton label={t("Dismiss")} onClick={() => setDismissed(message)}>
        <X size={20} />
      </IconButton>
    </div>
  );
}

/** Fits in the existing header subtitle, so connection failures never cover messages. */
export function MobileReloadStatus({ status, loading, error }: {
  status: HostConnectionStatus;
  loading: boolean;
  error: string;
}) {
  const { t } = useTranslation();
  const [lastFailure, setLastFailure] = useState("");
  const failure = status.state === "failed"
    ? t(status.reason ? hostStatusLabel(status) : "Network error") : "";
  useEffect(() => {
    if (status.state !== "reconnecting") setLastFailure(failure);
  }, [status.state, failure]);
  const retrying = loading || status.state === "reconnecting" || status.state === "failed";
  const reason = failure || (status.state === "disconnected" ? t("Disconnected")
    : status.state === "reconnecting" ? lastFailure || connectionErrorSummary(error)
      : connectionErrorSummary(error));
  const text = [retrying ? t("Reloading…") : "", reason].filter(Boolean).join(" · ");
  return (
    <span className="mobile-reload-status" role="status" title={status.detail || error || text}>
      {retrying && <MobileSpinner className="mobile-spin" size={12} aria-hidden="true" />}
      <span>{text}</span>
    </span>
  );
}
