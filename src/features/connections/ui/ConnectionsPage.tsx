import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withStatusToast } from "../../../shared/ui/StatusToast";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Computer, Copy, Loader, RefreshCw, Smartphone } from "../../../shared/ui/icons";
import type { HostDeviceInfo } from "../model/protocol";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";
import { remoteRequest } from "../model/connections";
import { pairingLink } from "../model/pairingLink";
import { PairingQrCode } from "./PairingQrCode";
import { PairingHostField } from "./PairingHostField";
import { sharedHostMachineId } from "../model/remoteProjects";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { ConnectionStatusIcon, type ConnectionState } from "./ConnectionStatusDot";

type ConnectionsTab = "control" | "ssh";

export type HostDevice = Omit<HostDeviceInfo, "installationId"> & {
  id: string;
  name: string;
  admin: boolean;
  createdAt?: number;
  pairedAt?: number;
  lastSeen?: number;
  online?: boolean;
  identityId?: string;
  connectionIds?: string[];
};

const DEVICE_REFRESH_MS = 10_000;
const PAIRING_REFRESH_MS = 1_000;

const pill =
  "h-7 rounded-full px-3 text-ui-base font-medium transition-colors disabled:opacity-40";

/** Settings → Connections: devices controlling this computer, and SSH machines. */
export function ConnectionsPage({ revealed }: { revealed?: string | null }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ConnectionsTab>(
    revealed === "remote-machines" ? "ssh" : "control",
  );
  useEffect(() => {
    // Search results open the tab holding the revealed setting.
    if (revealed === "remote-machines") setTab("ssh");
    else if (revealed === "controlling-devices") setTab("control");
  }, [revealed]);
  const tabs: { value: ConnectionsTab; label: string }[] = [
    { value: "control", label: t("Control this computer") },
    { value: "ssh", label: "SSH" },
  ];
  return (
    <div className="flex flex-col gap-8">
      <div role="tablist" aria-label={t("Connections")} className="flex gap-1">
        {tabs.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={tab === option.value}
            onClick={() => setTab(option.value)}
            className={`${pill} ${
              tab === option.value
                ? "bg-selection text-foreground"
                : "text-foreground-subtle hover:bg-surface-hover hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {tab === "control" ? <ControlThisComputer /> : <ConnectionsSettings />}
    </div>
  );
}

export function formatLastSeen(
  t: ReturnType<typeof useTranslation>["t"],
  lastSeen: number | undefined,
  now = Date.now(),
): string {
  if (!lastSeen) return t("Never connected");
  const minutes = Math.max(0, Math.floor((now - lastSeen) / 60_000));
  const ago =
    minutes < 1
      ? t("just now")
      : minutes < 60
        ? t("{count}m ago", { count: minutes })
        : minutes < 1440
          ? t("{count}h ago", { count: Math.floor(minutes / 60) })
          : t("{count}d ago", { count: Math.floor(minutes / 1440) });
  return t("Last connected {value0}", { value0: ago });
}

function ControlThisComputer() {
  const { t } = useTranslation();
  const machineId = sharedHostMachineId();
  const [devices, setDevices] = useState<HostDevice[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string>();
  const [revoking, setRevoking] = useState<string>();
  const alive = useRef(true);
  useEffect(() => {
    // StrictMode replays setup after cleanup; responses must be accepted again.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!machineId) return;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await remoteRequest<{ devices: HostDevice[] }>(
        machineId,
        "devices.list",
      );
      if (!alive.current) return;
      setDevices(result.devices.filter((device) => !device.admin));
      setError("");
    } catch (reason) {
      if (alive.current) setError(String(reason));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [machineId]);
  useEffect(() => {
    void refresh();
    // Presence changes as phones open and close the app.
    const timer = setInterval(() => void refresh(true), DEVICE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const revoke = async (device: HostDevice) => {
    if (!machineId) return;
    setRevoking(device.id);
    setError("");
    try {
      await remoteRequest(machineId, "devices.revoke", { deviceId: device.id });
      if (!alive.current) return;
      setConfirming(undefined);
      setDevices((current) => current?.filter((value) => value.id !== device.id));
    } catch (reason) {
      if (alive.current) setError(String(reason));
    } finally {
      if (alive.current) setRevoking(undefined);
    }
  };

  return (
    <section data-setting-id="controlling-devices" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="desktop-pane-heading min-w-0 flex-1 text-ui-lg font-semibold text-foreground">
          {t("Devices that can control this computer")}
        </h2>
        <button
          type="button"
          aria-label={t("Refresh")}
          title={t("Refresh")}
          disabled={!machineId || loading}
          onClick={() => void refresh()}
          className="grid size-7 place-items-center rounded-full text-foreground-subtle hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          disabled={!machineId}
          onClick={() => setAdding(true)}
          className={`${pill} bg-foreground text-background hover:opacity-85`}
        >
          {t("Add")}
        </button>
      </div>
      <div className="desktop-card overflow-hidden rounded-xl border border-border panel-card">
        {!machineId ? (
          <p className="px-4 py-4 text-ui-base text-foreground-subtle">
            {t("The conversation service on this computer is not running.")}
          </p>
        ) : !devices && error ? (
          <p role="alert" className="whitespace-pre-wrap break-words px-4 py-4 text-ui-base text-red-400">
            {error}
          </p>
        ) : !devices ? (
          <div className="flex items-center gap-2 px-4 py-4 text-ui-base text-foreground-subtle">
            <Loader className="size-4 animate-spin" />
            {t("Loading devices…")}
          </div>
        ) : devices.length === 0 ? (
          <p className="px-4 py-4 text-ui-base text-foreground-subtle">
            {t("No devices yet. Add one to control this computer from your phone.")}
          </p>
        ) : (
          devices.map((device) => {
            const state: ConnectionState = error ? "error" : device.online ? "online" : "offline";
            const desktop = device.deviceType === "desktop";
            const hardware = desktop ? device.hostname : device.model ? [device.manufacturer, device.model].filter(Boolean).join(" ") : undefined;
            return (
            <div
              key={device.id}
              className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0"
            >
              <ConnectionStatusIcon
                state={state}
                label={state === "error" ? t("Connection error") : state === "online" ? t("Online") : t("Offline")}
              >
                {desktop ? <Computer className="size-5" /> : <Smartphone className="size-5" />}
              </ConnectionStatusIcon>
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui-base font-medium text-foreground">
                  {device.name}
                </div>
                <div className="mt-0.5 truncate text-ui-caption text-foreground-subtle">
                  {hardware ? `${hardware} · ` : ""}
                  {device.online && !error ? t("Online") : formatLastSeen(t, device.lastSeen)}
                </div>
              </div>
              {confirming === device.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={!!revoking}
                    onClick={() => setConfirming(undefined)}
                    className={`${pill} text-foreground-subtle hover:bg-surface-hover hover:text-foreground`}
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={!!revoking}
                    onClick={() => void revoke(device)}
                    className={`${pill} bg-red-500/10 text-red-500 hover:bg-red-500/15`}
                  >
                    {revoking === device.id ? t("Revoking…") : t("Confirm revoke")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!!revoking}
                  onClick={() => setConfirming(device.id)}
                  className={`${pill} shrink-0 bg-selection text-foreground hover:bg-selection-hover`}
                >
                  {t("Revoke access")}
                </button>
              )}
            </div>
            );
          })
        )}
      </div>
      {error && devices ? (
        <p role="alert" className="whitespace-pre-wrap break-words text-ui-caption text-red-400">
          {error}
        </p>
      ) : null}
      <PresenceBoundary>{adding && machineId ? (
        <AddDeviceDialog
          machineId={machineId}
          onClose={() => setAdding(false)}
          onAdded={refresh}
        />
      ) : null}</PresenceBoundary>
    </section>
  );
}

function AddDeviceDialog({
  machineId,
  onClose,
  onAdded,
}: {
  machineId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ id: string; token: string }>();
  const [paired, setPaired] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hostUrl, setHostUrl] = useState<string>();
  const token = issued?.token;
  const link = token && hostUrl ? pairingLink(hostUrl, token) : undefined;

  useEffect(() => {
    if (!issued) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await remoteRequest<{ devices: HostDevice[] }>(machineId, "devices.list");
        if (!active) return;
        setError("");
        if (result.devices.some((device) =>
          (device.id === issued.id || device.connectionIds?.includes(issued.id)) && device.pairedAt !== undefined)) {
          setPaired(true);
          setIssued(undefined);
          onAdded();
          return;
        }
      } catch (reason) {
        if (!active) return;
        setError(String(reason));
      }
      if (active) timer = setTimeout(() => void poll(), PAIRING_REFRESH_MS);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [issued, machineId, onAdded]);

  const input =
    "w-full rounded-lg border border-border bg-transparent px-3 py-2 text-ui-base outline-none focus:border-content/35";
  return (
    <Modal
      title={t("Add device")}
      description={
        token || paired ? undefined : t("Create a credential that lets another device control this computer.")
      }
      size="sm"
      onClose={onClose}
    >
      {paired ? (
        <div className="flex flex-col gap-4 p-4">
          <div role="status" className="flex items-start gap-3 rounded-lg border border-border bg-content/3 p-3">
            <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-foreground" />
            <div className="min-w-0">
              <p className="text-ui-base font-medium text-foreground">{t("Pairing successful")}</p>
              <p className="mt-1 text-ui-caption leading-5 text-foreground-subtle">
                {t("This pairing code has been used and cannot pair another device.")}
              </p>
            </div>
          </div>
          <ModalFooter>
            <Button variant="primary" onClick={onClose}>
              {t("Done")}
            </Button>
          </ModalFooter>
        </div>
      ) : token ? (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-ui-base leading-6 text-foreground">
            {t("Scan this QR code in the OmniCode mobile app, or enter this computer's Host URL and the pairing code. The code is shown only once.")}
          </p>
          <p className="text-ui-caption leading-5 text-foreground-subtle">{t("Each code can pair only one device.")}</p>
          <PairingHostField machineId={machineId} onChange={setHostUrl} />
          <div className="flex items-center gap-4 rounded-lg border border-border bg-content/3 p-3">
            {link ? (
              <PairingQrCode value={link} label={t("Pairing QR code")} />
            ) : (
              <div className="grid size-48 shrink-0 place-items-center rounded-lg border border-dashed border-border p-4 text-center text-ui-caption leading-5 text-foreground-subtle">
                {t("Choose a verified Host URL to show a QR code.")}
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="text-ui-caption text-foreground-subtle">{t("Pairing code")}</span>
              <code className="select-all font-mono text-[22px] font-semibold tracking-[0.12em] text-foreground">{token}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(token).then(() => setCopied(true));
                }}
                className={`${pill} flex items-center gap-1.5 bg-selection text-foreground hover:bg-selection-hover`}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t(copied ? "Copied" : "Copy")}
              </button>
            </div>
          </div>
          {error ? <p role="alert" className="break-words text-ui-caption text-red-400">{error}</p> : null}
          <ModalFooter>
            <Button variant="primary" onClick={onClose}>
              {t("Done")}
            </Button>
          </ModalFooter>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !name.trim()) return;
            setBusy(true);
            setError("");
            void withStatusToast(
              () =>
                remoteRequest<{ id: string; token: string }>(machineId, "devices.issue", {
                  name: name.trim(),
                }),
              { loading: t("Creating…"), success: false, error: false },
            )
              .then((device) => {
                setIssued(device);
                onAdded();
              })
              .catch((reason) => setError(String(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <label className="flex flex-col gap-1.5 text-ui-caption text-foreground-subtle">
            {t("Device name")}
            <input data-ui="input"
              autoFocus
              required
              maxLength={80}
              disabled={busy}
              className={input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("e.g. My phone")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error ? (
            <p role="alert" className="break-words text-ui-caption text-red-400">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
              {busy ? t("Creating…") : t("Create")}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}
