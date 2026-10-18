import { projectPreferencePending } from "../model/projectPreferenceRouting";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { activePreferenceStore, SHARED_PREFERENCES_STATUS } from "../model/sharedPreferences";
import { hostWorkspacePending, HOST_WORKSPACE_STATUS } from "../../connections/model/hostWorkspace";

function subscribe(listener: () => void) {
  window.addEventListener(SHARED_PREFERENCES_STATUS, listener);
  window.addEventListener(HOST_WORKSPACE_STATUS, listener);
  return () => { window.removeEventListener(SHARED_PREFERENCES_STATUS, listener); window.removeEventListener(HOST_WORKSPACE_STATUS, listener); };
}
function status(pending: () => boolean = hostWorkspacePending) {
  const store = activePreferenceStore();
  // This device's sync status belongs to its active Host, not every saved connection.
  return store?.error || (store?.pendingCount || (store && projectPreferencePending(store.hostId)) || pending() ? "Not yet synced" : "");
}
export function SharedStateStatus({ className, pending, pendingDelayMs = 0 }: {
  className?: string;
  pending?: () => boolean;
  /** Routine writes that settle within this window never show; errors always do. */
  pendingDelayMs?: number;
}) {
  const value = useSyncExternalStore(subscribe, () => status(pending), () => "");
  const { t } = useTranslation();
  const waiting = value === "Not yet synced" && pendingDelayMs > 0;
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    setOverdue(false);
    if (!waiting) return;
    const timer = setTimeout(() => setOverdue(true), pendingDelayMs);
    return () => clearTimeout(timer);
  }, [waiting, pendingDelayMs]);
  if (!value || (waiting && !overdue)) return null;
  return <div className={className} role="status" title={t(value)} style={{ fontSize: 12, padding: "4px 10px", color: "var(--color-content-secondary)", background: "var(--color-background)" }}>{t("Not yet synced")}{value !== "Not yet synced" ? ` · ${t(value)}` : ""}</div>;
}
