import { Button } from "../shared/ui/forms/Button";
import { IconButton } from "../shared/ui/forms/IconButton";
import { lightImpact } from "./haptics";
import { MobileSettingsGlyph } from "./MobileSettingsIcon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import { MobileSheet, type MobileSheetPoint } from "./MobileSheet";
import { hostStatusLabel } from "./MobileHostStatus";
import type { HostConnectionStatus } from "./client";
import type { MobilePreferencePanel } from "./mobileSettingsRoutes";
import {
  CONNECTION_ICONS,
  useConnectionAppearance,
  type ConnectionAppearance,
} from "./connectionAppearance";

const iconNames = {
  code: "Code",
  terminal: "Terminal",
  laptop: "Laptop",
  desktop: "Desktop",
};
export type SettingsConnection = {
  name: string;
  endpoint: string;
  environmentId?: string;
  disabled?: boolean;
};

const HOLD_DELAY = 450;

function ConnectionRow({
  connection,
  active,
  hostStatus,
  disabled,
  menuOpen,
  probe,
  onMenu,
  onSwitch,
}: {
  connection: SettingsConnection;
  active: boolean;
  hostStatus: HostConnectionStatus;
  disabled: boolean;
  menuOpen: boolean;
  probe: (connection: SettingsConnection) => Promise<HostConnectionStatus>;
  onMenu: (element: HTMLButtonElement, position?: MobileSheetPoint) => void;
  onSwitch: () => void;
}) {
  const { t } = useTranslation();
  const appearance = useConnectionAppearance(connection.endpoint);
  const name = appearance.displayName || connection.name;
  const [observed, setObserved] = useState<HostConnectionStatus>({ state: "reconnecting" });
  useEffect(() => {
    if (active) return;
    let live = true;
    setObserved({ state: connection.disabled ? "disconnected" : "reconnecting" });
    void probe(connection).then((value) => { if (live) setObserved(value); })
      .catch(() => { if (live) setObserved({ state: "failed" }); });
    return () => { live = false; };
  }, [active, connection, probe]);
  const status = active ? hostStatus : observed;
  const hold = useRef<
    { x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined
  >(undefined);
  // A completed hold opens the menu; the click that follows must not also switch.
  const held = useRef(false);
  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = undefined;
  };
  useEffect(() => {
    cancelHold();
    return cancelHold;
  }, [connection.environmentId, disabled, menuOpen]);
  const openMenu = (element: HTMLButtonElement, position?: MobileSheetPoint) => {
    cancelHold();
    if (!disabled) onMenu(element, position);
  };
  return (
    <li className="mobile-settings-row mobile-connection-row mobile-connection-device">
      <button
        type="button"
        className="mobile-connection-details"
        aria-label={active
          ? t("Connection options for {host}", { host: name })
          : t("Switch to {host}", { host: name })}
        aria-haspopup={active ? "dialog" : undefined}
        aria-expanded={active ? menuOpen : undefined}
        aria-current={active || undefined}
        disabled={disabled}
        onPointerDown={(event) => {
          cancelHold();
          held.current = false;
          if (event.button !== 0) return;
          const element = event.currentTarget;
          const x = event.clientX,
            y = event.clientY;
          hold.current = {
            x,
            y,
            timer: setTimeout(() => {
              held.current = true;
              void lightImpact();
              openMenu(element, { x, y });
            }, HOLD_DELAY),
          };
        }}
        onPointerMove={(event) => {
          if (
            hold.current &&
            Math.hypot(
              event.clientX - hold.current.x,
              event.clientY - hold.current.y,
            ) > 10
          )
            cancelHold();
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(
            event.currentTarget,
            event.clientX || event.clientY
              ? { x: event.clientX, y: event.clientY }
              : undefined,
          );
        }}
        onClick={(event) => {
          if (held.current) {
            held.current = false;
            return;
          }
          if (!active) onSwitch();
          else if (event.detail === 0) openMenu(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            openMenu(event.currentTarget);
          }
        }}
      >
        <MobileSettingsGlyph name={appearance.icon} />
        <span className="mobile-settings-label">
          <span className="mobile-connection-name" title={name}>
            {name}
          </span>
          <small className="mobile-connection-status">
            <span role={active ? "status" : undefined} title={status.detail || undefined}>
              {/* A reachable device that is not the active one is only available. */}
              {t(!active && status.state === "connected" ? "Available" : hostStatusLabel(status))}
            </span>
            <span className="mobile-connection-address">
              {connection.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </span>
          </small>
        </span>
      </button>
    </li>
  );
}

export function MobileConnections({
  connections,
  activeEndpoint,
  hostStatus,
  disabled,
  panel,
  onPanelChange,
  probe,
  onSwitch,
  onSave,
  onReconnect,
  onDelete,
  addConnection,
}: {
  connections: SettingsConnection[];
  activeEndpoint?: string;
  hostStatus: HostConnectionStatus;
  disabled: boolean;
  panel: MobilePreferencePanel;
  onPanelChange: (panel: MobilePreferencePanel) => void;
  probe: (connection: SettingsConnection) => Promise<HostConnectionStatus>;
  onSwitch: (endpoint: string) => void;
  onSave: (endpoint: string, value: ConnectionAppearance) => void;
  onDelete: (endpoint: string) => Promise<void>;
  onReconnect: () => void;
  addConnection: ReactNode;
}) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [target, setTarget] = useState<string>();
  const connection = connections.find((item) => item.endpoint === target);
  // Keep the closing sheets' details after their connection is deleted.
  const lastConnection = useRef(connection);
  if (connection) lastConnection.current = connection;
  const details = connection ?? lastConnection.current;
  const appearance = useConnectionAppearance(details?.endpoint);
  const name = appearance.displayName || details?.name || "";
  const [point, setPoint] = useState<MobileSheetPoint>();
  const [draft, setDraft] = useState<ConnectionAppearance>(appearance);
  const [error, setError] = useState("");
  // Opening the page refreshes it: other rows probe on mount, and the current
  // device reconnects once if it is not connected.
  const entry = useRef({ activeEndpoint, hostStatus, disabled, onReconnect });
  useEffect(() => {
    const { activeEndpoint, hostStatus, disabled, onReconnect } = entry.current;
    if (activeEndpoint && !disabled && hostStatus.state !== "connected") onReconnect();
  }, []);
  const openMenu = (
    endpoint: string,
    element: HTMLButtonElement,
    position?: MobileSheetPoint,
  ) => {
    if (disabled) return;
    trigger.current = element;
    setTarget(endpoint);
    setPoint(position);
    setError("");
    onPanelChange("connection-menu");
  };
  const edit = () => {
    setDraft({ displayName: name, icon: appearance.icon });
    setError("");
    onPanelChange("connection-edit");
  };
  const close = () => {
    if (!disabled) onPanelChange(null);
  };
  const changed =
    draft.displayName.trim() !== name || draft.icon !== appearance.icon;
  const header = (title: string) => (
    <div className="mobile-connection-editor-header">
      <h2>{t(title)}</h2>
      <IconButton
        type="button"

        label={t("Close")}
        disabled={disabled}
        onClick={close}
      >
        <X size={24} />
      </IconButton>
    </div>
  );

  return (
    <>
      <section className="mobile-settings-group" aria-label={t("Connections")}>
        <h2>{t("Connection")}</h2>
        <ul className="mobile-connection-list">
          {connections.map((item) => (
            <ConnectionRow
              key={item.endpoint}
              connection={item}
              active={item.endpoint === activeEndpoint}
              hostStatus={hostStatus}
              disabled={disabled}
              menuOpen={target === item.endpoint && panel === "connection-menu"}
              probe={probe}
              onMenu={(element, position) => openMenu(item.endpoint, element, position)}
              onSwitch={() => onSwitch(item.endpoint)}
            />
          ))}
          <li>{addConnection}</li>
        </ul>
      </section>
      <MobileSheet
        open={!!connection && panel === "connection-menu"}
        title="Connection options"
        placement="anchor"
        anchor={trigger}
        anchorPoint={point}
        width={220}
        onClose={close}
      >
        <div className="mobile-connection-menu">
          <p className="mobile-connection-menu-name">{name}</p>
          <button
            type="button"
            className="mobile-sheet-row"
            disabled={disabled}
            onClick={() => {
              close();
              if (details?.endpoint === activeEndpoint) onReconnect();
              else if (details) onSwitch(details.endpoint);
            }}
          >
            <RefreshCw size={20} />
            <span>{t("Reconnect")}</span>
          </button>
          <button
            type="button"
            className="mobile-sheet-row"
            disabled={disabled}
            onClick={edit}
          >
            <Pencil size={20} />
            <span>{t("Edit")}</span>
          </button>
          <button
            type="button"
            className="mobile-sheet-row mobile-menu-danger"
            disabled={disabled}
            onClick={() => {
              setError("");
              onPanelChange("connection-delete");
            }}
          >
            <Trash2 size={20} />
            <span>{t("Delete")}</span>
          </button>
        </div>
      </MobileSheet>
      <MobileSheet
        open={!!connection && panel === "connection-edit"}
        title="Edit connection"
        anchor={trigger}
        onClose={close}
      >
        <form
          className="mobile-connection-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || !changed || !draft.displayName.trim()) return;
            try {
              onSave(details!.endpoint, { ...draft, displayName: draft.displayName.trim() });
              close();
            } catch {
              setError(t("Could not save connection preferences. Try again."));
            }
          }}
        >
          {header("Edit connection")}
          <label className="mobile-connection-name-field">
            <span>{t("Display name")}</span>
            <input data-ui="input"
              value={draft.displayName}
              maxLength={100}
              required
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, displayName: event.target.value })
              }
            />
          </label>
          <div
            className="mobile-connection-icons"
            role="group"
            aria-label={t("Connection icon")}
          >
            {CONNECTION_ICONS.map((icon) => {
              return (
                <button
                  key={icon}
                  type="button"
                  aria-label={t(iconNames[icon])}
                  aria-pressed={draft.icon === icon}
                  disabled={disabled}
                  onClick={() => setDraft({ ...draft, icon })}
                >
                  <MobileSettingsGlyph name={icon} />
                </button>
              );
            })}
          </div>
          <dl className="mobile-connection-info">
            <div>
              <dt>{t("Host name")}</dt>
              <dd>{details?.name}</dd>
            </div>
            <div>
              <dt>{t("Type")}</dt>
              <dd>OmniCode Host</dd>
            </div>
            <div>
              <dt>{t("Host URL")}</dt>
              <dd>{details?.endpoint}</dd>
            </div>
          </dl>
          {error && (
            <p className="mobile-form-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="primary"
            className="mobile-connection-editor-action"
            type="submit"
            disabled={disabled || !changed || !draft.displayName.trim()}
          >
            {t("Save")}
          </Button>
          <Button variant="danger"
            className="mobile-connection-editor-action mobile-connection-delete"
            type="button"
            disabled={disabled}
            onClick={() => {
              setError("");
              onPanelChange("connection-delete");
            }}
          >
            {t("Delete connection")}
          </Button>
        </form>
      </MobileSheet>
      <MobileSheet
        open={!!connection && panel === "connection-delete"}
        title="Delete connection"
        anchor={trigger}
        onClose={close}
      >
        <div className="mobile-connection-editor">
          {header("Delete connection")}
          <p>
            {t(
              "Remove {host} from this device? Sessions on the Host will keep running.",
              { host: name },
            )}
          </p>
          {error && (
            <p className="mobile-form-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="danger"
            className="mobile-connection-editor-action mobile-connection-delete"
            disabled={disabled}
            onClick={() => {
              void onDelete(details!.endpoint)
                .then(() => onPanelChange(null))
                .catch(() =>
                  setError(t("Could not delete the connection. Try again.")),
                );
            }}
          >
            {t("Delete connection")}
          </Button>
          <Button variant="secondary"
            className="mobile-connection-editor-action"
            disabled={disabled}
            onClick={close}
          >
            {t("Cancel")}
          </Button>
        </div>
      </MobileSheet>
    </>
  );
}
