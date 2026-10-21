import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useEffect, useState } from "react";
import { RefreshCw } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { remoteRequest } from "../model/connections";

type PairingHostCandidate = {
  url: string;
  kind: "tailscale" | "lan";
  reachable: boolean;
};

const PAIRING_HOST_URL_KEY = "omnicode.pairingHostUrl";

function savedHost(): string | null {
  try {
    return localStorage.getItem(PAIRING_HOST_URL_KEY);
  } catch {
    return null;
  }
}

function saveHost(url: string): void {
  try {
    localStorage.setItem(PAIRING_HOST_URL_KEY, url);
  } catch {
    // The QR code still works for this dialog without persistence.
  }
}

/**
 * Picks one of this computer's adapter addresses. The Host verifies each one
 * by reaching itself through it; only a verified URL is reported to `onChange`.
 */
export function PairingHostField({
  machineId,
  onChange,
}: {
  machineId: string;
  onChange: (url: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("");
  const read = useQuery({
    queryKey: ["pairingHosts", machineId],
    queryFn: async ({ signal }) => {
      const result = await remoteRequest<{ hosts?: PairingHostCandidate[] }>(machineId, "devices.pairingHosts");
      signal.throwIfAborted();
      return Array.isArray(result.hosts) ? result.hosts : [];
    },
  }, queryClient);
  const hosts = read.isError ? [] : read.data;
  const checking = read.isFetching;
  const error = read.error ? String(read.error) : "";
  const detect = () => { void read.refetch(); };
  useEffect(() => {
    const found = read.data;
    if (!found) return;
    setSelected(current => [current, savedHost()].find(url => found.some(host => host.url === url && host.reachable))
      ?? found.find(host => host.reachable)?.url ?? found[0]?.url ?? "");
  }, [read.data]);
  const current = hosts?.find((host) => host.url === selected);
  const verified = !checking && current?.reachable ? current.url : undefined;
  useEffect(() => {
    onChange(verified);
    if (verified) saveHost(verified);
  }, [verified, onChange]);

  const kindLabel = { tailscale: t("Tailscale"), lan: t("Local network") };
  let status = "";
  if (checking) status = t("Checking this computer's network addresses…");
  else if (error) status = error;
  else if (hosts && hosts.length === 0) status = t("No network address found on this computer.");
  else if (current && !current.reachable)
    status = t("The Host cannot be reached at this address. Another program may be using the port, or a firewall blocks it. Fix it, then check again.");
  else if (current?.kind === "tailscale")
    status = t("Tailscale address: the phone must have Tailscale turned on and signed in to the same tailnet. Otherwise choose a local network address.");
  else if (current)
    status = t("Local network address: the phone must be on the same Wi-Fi as this computer.");

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-ui-caption text-foreground-subtle">{t("Host URL")}</span>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchableSelect
            label={t("Host URL")}
            value={selected}
            options={(hosts ?? []).map((host) => ({
              value: host.url,
              label: `${host.url} · ${kindLabel[host.kind]}${host.reachable ? "" : ` · ${t("Unreachable")}`}`,
            }))}
            onChange={setSelected}
            placeholder={checking ? t("Checking…") : t("Choose a Host URL…")}
            disabled={checking || !hosts?.length}
            searchable={false}
          />
        </div>
        <button
          type="button"
          onClick={detect}
          disabled={checking}
          aria-label={t("Check again")}
          title={t("Check again")}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} />
        </button>
      </div>
      {status ? (
        <p role={error || (current && !current.reachable) ? "alert" : undefined} className="text-ui-caption leading-5 text-foreground-subtle">
          {status}
        </p>
      ) : null}
    </div>
  );
}
