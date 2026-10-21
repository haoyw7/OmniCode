import type { RefObject } from "react";
import { Check, Computer, Plus, RefreshCw, Settings } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import type { Connection, HostConnectionStatus } from "./client";
import { useConnectionAppearance } from "./connectionAppearance";
import { MobileHostStatus } from "./MobileHostStatus";
import { MobileSheet, SHEET_WIDTH } from "./MobileSheet";
import { useProbedHostStatus } from "./useProbedHostStatus";

export function MobileHostPicker({
  open = true, onExited, anchor, connections, activeId, status, switching,
  probe, onSwitch, onReconnect, onAdd, onManage, onClose,
}: {
  open?: boolean;
  onExited?: () => void;
  anchor: RefObject<HTMLButtonElement | null>;
  connections: Connection[];
  activeId?: string;
  status: HostConnectionStatus;
  switching: boolean;
  probe: (connection: Connection) => Promise<HostConnectionStatus>;
  onSwitch: (id: string) => void;
  onReconnect: () => void;
  onAdd: () => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <MobileSheet open={open} onExited={onExited} title="Devices"
      placement="anchor" anchor={anchor} align="start" side="bottom"
      width={SHEET_WIDTH.list} constrainWidthToAnchor onClose={onClose}>
      {connections.map((connection) => (
        <Device key={connection.endpoint} connection={connection}
          active={connection.endpoint === activeId} status={status}
          open={open} disabled={switching} probe={probe} onSwitch={onSwitch} />
      ))}
      {status.state !== "connected" && activeId && (
        <button type="button" className="hover:opacity-80 focus-visible:focus-fill active:opacity-70 mobile-sheet-row" disabled={switching || status.state === "reconnecting"}
          onClick={onReconnect}>
          <RefreshCw /><span>{t("Reconnect")}</span>
        </button>
      )}
      <button type="button" className="hover:opacity-80 focus-visible:focus-fill active:opacity-70 mobile-sheet-row" data-separated onClick={onAdd}>
        <Plus /><span>{t("Add connection")}</span>
      </button>
      <button type="button" className="hover:opacity-80 focus-visible:focus-fill active:opacity-70 mobile-sheet-row" onClick={onManage}>
        <Settings /><span>{t("Manage devices")}</span>
      </button>
    </MobileSheet>
  );
}

function Device({ connection, active, status, open, disabled, probe, onSwitch }: {
  connection: Connection;
  active: boolean;
  status: HostConnectionStatus;
  open: boolean;
  disabled: boolean;
  probe: (connection: Connection) => Promise<HostConnectionStatus>;
  onSwitch: (id: string) => void;
}) {
  const { t } = useTranslation();
  const name = useConnectionAppearance(connection.endpoint).displayName || connection.name;
  const observed = useProbedHostStatus(connection, open && !active, probe);
  return (
    <button type="button" className="hover:opacity-80 focus-visible:focus-fill active:opacity-70 mobile-sheet-row mobile-device-option"
      aria-label={t("Switch to {host}", { host: name })} aria-pressed={active}
      disabled={disabled} onClick={() => onSwitch(connection.endpoint)}>
      <MobileHostStatus status={active ? status : observed} dotOnly />
      <Computer />
      <span className="mobile-device-option-name">
        {name}
        <small>{connection.endpoint.replace(/^https?:\/\//, "")}</small>
      </span>
      {active && <Check />}
    </button>
  );
}
