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
  if (connections.length < 2) return null;
  return (
    <div className="mobile-device-chips" role="radiogroup" aria-label={t("Devices")}>
      <button type="button" className="mobile-device-chip" role="radio"
        aria-checked={scope === "all"} onClick={() => onScope("all")}>
        {t("All")}
      </button>
      {connections.map((connection) => (
        <Chip key={connection.endpoint} connection={connection}
          active={connection.endpoint === activeId}
          selected={scope === "device" && connection.endpoint === activeId}
          status={status} probing={probing} disabled={disabled} probe={probe}
          onSelect={() => {
            onScope("device");
            if (connection.endpoint !== activeId) onSwitch(connection.endpoint);
          }} />
      ))}
    </div>
  );
}

function Chip({ connection, active, selected, status, probing, disabled, probe, onSelect }: {
  connection: Connection;
  active: boolean;
  selected: boolean;
  status: HostConnectionStatus;
  probing: boolean;
  disabled: boolean;
  probe: (connection: Connection) => Promise<HostConnectionStatus>;
  onSelect: () => void;
}) {
  const name = useConnectionAppearance(connection.endpoint).displayName || connection.name;
  const observed = useProbedHostStatus(connection, probing && !active, probe);
  return (
    <button type="button" className="mobile-device-chip" role="radio" aria-checked={selected}
      disabled={disabled && !active} onClick={onSelect}>
      <MobileHostStatus status={active ? status : observed} dotOnly />
      <Computer size={18} aria-hidden="true" />
      <span>{name}</span>
    </button>
  );
}
