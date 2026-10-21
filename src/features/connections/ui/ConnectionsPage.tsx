import { cn } from "../../../shared/lib/cn";
import { Input } from "../../../shared/ui/forms/Input";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { hostDevicesQuery, type HostDevice } from "../model/deviceQueries";
import { Check, Computer, Copy, RefreshCw, Smartphone } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";
import { remoteRequest } from "../model/connections";
import { pairingLink } from "../model/pairingLink";
import { PairingQrCode } from "./PairingQrCode";
import { PairingHostField } from "./PairingHostField";
import { sharedHostMachineId } from "../model/remoteProjects";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { ConnectionStatusIcon, type ConnectionState } from "./ConnectionStatusDot";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

type ConnectionsTab = "control" | "ssh";

const DEVICE_REFRESH_MS = 10_000;
const PAIRING_REFRESH_MS = 1_000;

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
          <Button variant="ghost" size="sm"
            key={option.value}
            type="button"
            role="tab"
            aria-selected={tab === option.value}
            onClick={() => setTab(option.value)}
            data-active={tab === option.value || undefined}
          >
            {option.label}
          </Button>
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
  const devicesQuery = useQuery({
    ...hostDevicesQuery(machineId ?? ""),
    enabled: !!machineId,
    refetchInterval: DEVICE_REFRESH_MS,
  }, queryClient);
  const devices = devicesQuery.data?.devices.filter((device) => !device.admin);
  const loading = devicesQuery.isFetching;
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string>();
  const refresh = useCallback(() => invalidateAfterChange(hostDevicesQuery(machineId ?? "").queryKey), [machineId]);
  const revokeMutation = useMutation({
    mutationFn: async (input: { machineId: string; deviceId: string }) => {
      await remoteRequest(input.machineId, "devices.revoke", { deviceId: input.deviceId });
      // A list started before the revoke must not put the credential back.
      await queryClient.cancelQueries({ queryKey: hostDevicesQuery(input.machineId).queryKey });
    },
    onSuccess: (_, input) => {
      const queryKey = hostDevicesQuery(input.machineId).queryKey;
      queryClient.setQueryData(queryKey, (current) => current && ({ devices: current.devices.filter((device) => device.id !== input.deviceId) }));
      void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    },
    onError: (reason) => toast.error(errorMessage(reason)),
  }, queryClient);
  const revoking = revokeMutation.isPending ? revokeMutation.variables.deviceId : undefined;
  const error = errorMessage(revokeMutation.error ?? (!loading ? devicesQuery.error : null));
  const revoke = (device: HostDevice) => {
    if (machineId && !revokeMutation.isPending) revokeMutation.mutate({ machineId, deviceId: device.id }, {
      onSuccess: () => setConfirming(undefined),
    });
  };

  return (
    <section data-setting-id="controlling-devices" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="desktop-pane-heading min-w-0 flex-1 text-ui-lg font-semibold text-foreground">
          {t("Devices that can control this computer")}
        </h2>
        <Button variant="ghost" size="icon-sm"
          type="button"
          aria-label={t("Refresh")}
          title={t("Refresh")}
          disabled={!machineId || loading}
          onClick={() => { revokeMutation.reset(); void refresh(); }}
        >
          <RefreshCw className={cn("size-4", loading ? "animate-spin" : "")} />
        </Button>
        <Button size="sm"
          type="button"
          disabled={!machineId}
          onClick={() => setAdding(true)}
          variant="primary"
        >
          {t("Add")}
        </Button>
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
            <Spinner className="size-4" />
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
                  <Button variant="ghost" size="sm"
                    type="button"
                    disabled={!!revoking}
                    onClick={() => setConfirming(undefined)}
                  >
                    {t("Cancel")}
                  </Button>
                  <Button size="sm"
                    type="button"
                    disabled={!!revoking}
                    onClick={() => void revoke(device)}
                    variant="danger"
                  >
                    {revoking === device.id ? t("Revoking…") : t("Confirm revoke")}
                  </Button>
                </div>
              ) : (
                <Button size="sm"
                  type="button"
                  disabled={!!revoking}
                  onClick={() => setConfirming(device.id)}
                  variant="secondary"
                >
                  {t("Revoke access")}
                </Button>
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
          key={machineId}
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
  const form = useForm({
    resolver: zodResolver(z.object({ name: z.string().trim().min(1, t("Enter a name")).max(80, t("Use at most {count} characters", { count: 80 })) })),
    defaultValues: { name: "" },
  });
  const name = useWatch({ control: form.control, name: "name" });
  const issueMutation = useMutation({
    mutationFn: (name: string) => withToast(
      () => remoteRequest<{ id: string; token: string }>(machineId, "devices.issue", { name }),
      { loading: t("Creating…"), success: false },
    ),
    gcTime: 0,
  }, queryClient);
  const busy = issueMutation.isPending;
  const issued = issueMutation.data;
  const [paired, setPaired] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hostUrl, setHostUrl] = useState<string>();
  const token = issued?.token;
  const link = token && hostUrl ? pairingLink(hostUrl, token) : undefined;
  const pairingQuery = useQuery({
    ...hostDevicesQuery(machineId),
    enabled: !!issued,
    refetchInterval: PAIRING_REFRESH_MS,
  }, queryClient);
  const error = errorMessage(issueMutation.error ?? (issued ? pairingQuery.error : null));

  useEffect(() => {
    if (!issued) return;
    if (pairingQuery.data?.devices.some((device) =>
      (device.id === issued.id || device.connectionIds?.includes(issued.id)) && device.pairedAt !== undefined)) {
      setPaired(true);
      issueMutation.reset();
      onAdded();
    }
  }, [issued, pairingQuery.data, issueMutation.reset, onAdded]);

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
              <Button size="sm"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(token).then(() => setCopied(true));
                }}
                variant="secondary"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t(copied ? "Copied" : "Copy")}
              </Button>
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
          noValidate
          onSubmit={form.handleSubmit(({ name }) => {
            if (!busy) issueMutation.mutate(name, { onSuccess: onAdded });
          })}
        >
          <label className="flex flex-col gap-1.5 text-ui-caption text-foreground-subtle">
            {t("Device name")}
            <Input data-ui="input"
              autoFocus
              maxLength={80}
              disabled={busy}
              {...form.register("name")}
              aria-invalid={!!form.formState.errors.name}
              placeholder={t("e.g. My phone")}
              autoComplete="off"
              spellCheck={false}
            />
            <FieldError errors={[form.formState.errors.name]} />
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
