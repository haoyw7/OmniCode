import { useCallback, useEffect, useState } from "react";
import { ListMotion, ListMotionButton } from "../shared/ui/ListMotion";
import { useTranslation } from "../shared/i18n/useTranslation";
import { Computer } from "../shared/ui/icons";
import type { Connection, HostConnectionStatus } from "./client";
import { useConnectionAppearance } from "./connectionAppearance";
import { MobileHostStatus } from "./MobileHostStatus";
import { useProbedHostStatus } from "./useProbedHostStatus";

export type MobileHomeScope = "all" | "device";

/** Home's device row: every paired device, or just the active one. */
export function MobileDeviceChips({
  connections, activeId, status, scope, probing, disabled, probe, onScope, onSwitch,
}: {
  connections: readonly Connection[];
  activeId?: string;
  status: HostConnectionStatus;
  scope: MobileHomeScope;
  /** Probe inactive devices only while Home is in front. */
  probing: boolean;
  disabled: boolean;
  probe: (connection: Connection) => Promise<HostConnectionStatus>;
  onScope: (scope: MobileHomeScope) => void;
  onSwitch: (endpoint: string) => void;
}) {
  const { t } = useTranslation();
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const onObserved = useCallback((endpoint: string, connected: boolean) => {
    setOnline((previous) => previous[endpoint] === connected
      ? previous : { ...previous, [endpoint]: connected });
  }, []);
  const isOnline = (connection: Connection) => connection.endpoint === activeId
    ? status.state === "connected" : online[connection.endpoint] === true;
  const ordered = [...connections].sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)));
  if (connections.length < 2) return null;
  return (
    <div className="mobile-device-chips" role="radiogroup" aria-label={t("Devices")}>
      <button type="button" className="hover:opacity-80 focus-visible:focus-fill active:opacity-70 mobile-device-chip" role="radio"
        aria-checked={scope === "all"} onClick={() => onScope("all")}>
        {t("All")}
      </button>
      <ListMotion>{ordered.map((connection) => (
        <Chip key={connection.endpoint} connection={connection}
          active={connection.endpoint === activeId}
          selected={scope === "device" && connection.endpoint === activeId}
          status={status} probing={probing} disabled={disabled} probe={probe}
          onObserved={onObserved}
          onSelect={() => {
            onScope("device");
            if (connection.endpoint !== activeId) onSwitch(connection.endpoint);
          }} />
      ))}</ListMotion>
    </div>
  );
}

function Chip({ connection, active, selected, status, probing, disabled, probe, onObserved, onSelect }: {
  connection: Connection;
  active: boolean;
  selected: boolean;
  status: HostConnectionStatus;
  probing: boolean;
  disabled: boolean;
  probe: (connection: Connection) => Promise<HostConnectionStatus>;
  onObserved: (endpoint: string, connected: boolean) => void;
  onSelect: () => void;
}) {
  const name = useConnectionAppearance(connection.endpoint).displayName || connection.name;
  const observed = useProbedHostStatus(connection, probing && !active, probe);
  useEffect(() => {
    onObserved(connection.endpoint, observed.state === "connected");
  }, [connection.endpoint, observed.state, onObserved]);
  return (
    <ListMotionButton type="button" className="mobile-device-chip" role="radio" aria-checked={selected}
      data-device-endpoint={connection.endpoint}
      disabled={disabled && !active} onClick={onSelect}>
      <MobileHostStatus status={active ? status : observed} dotOnly />
      <Computer aria-hidden="true" />
      <span>{name}</span>
    </ListMotionButton>
  );
}
