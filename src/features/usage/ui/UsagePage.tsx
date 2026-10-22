import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Modal } from "../../../shared/ui/Modal";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import type { UsageProvider } from "../../../integrations/harness/core/usage";
import { useRemoteMachines } from "../../connections/model/connections";
import { REMOTE_PROJECTS_CHANGED } from "../../connections/model/remoteProjects";
import {
  providerUsageHost,
  providerUsageSourceKey,
} from "../../providers/model/providerUsageSource";
import { desktopUsageTransport } from "../model/desktopUsageTransport";
import { UsageDashboard } from "./UsageDashboard";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import "../../../styles/desktop-usage.css";
const subscribe = (callback: () => void) => {
  window.addEventListener(REMOTE_PROJECTS_CHANGED, callback);
  return () => window.removeEventListener(REMOTE_PROJECTS_CHANGED, callback);
};
export function UsagePage({
  icon,
  active = true,
}: {
  icon: (provider: UsageProvider) => ReactNode;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const source = useSyncExternalStore(subscribe, providerUsageSourceKey);
  const { machines } = useRemoteMachines(active);
  const environments = useMemo(() => {
    const values = [...machines],
      host = providerUsageHost();
    if (
      host &&
      !values.some((machine) => machine.environmentId === host.environmentId)
    )
      values.unshift({
        id: host.machineId,
        environmentId: host.environmentId,
        name: t("This computer"),
        endpoint: "",
      });
    return values.map(desktopUsageTransport);
  }, [machines, source, t]);
  return (
    <UsageDashboard
      environments={environments}
      active={active}
      icon={icon}
      select={(props) => <SearchableSelect {...props} />}
      dialog={(props) => (
        <PresenceBoundary>
          {props ? <Modal size="sm" {...props} fitViewport /> : null}
        </PresenceBoundary>
      )}
    />
  );
}
