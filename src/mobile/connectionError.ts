import { translate } from "../shared/i18n/language";

/** Native and browser wordings for "the Host could not be reached at all". */
const UNREACHABLE =
  /failed to connect|timed? ?out|timeout|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|connection refused|no route to host|network is unreachable|unable to resolve host|failed to fetch|network ?error|network request failed/i;

/** Compact header copy; the original diagnostic remains available in the title. */
export function connectionErrorSummary(detail: string): string {
  if (/timed? ?out|timeout/i.test(detail)) return translate("Connection timed out");
  return UNREACHABLE.test(detail) ? translate("Network error") : detail;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return undefined;
  }
}

function isTailscaleHost(host: string): boolean {
  if (host.endsWith(".ts.net")) return true;
  const [a, b] = host.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/** A pairing failure explained in terms of what the user can check. */
export function connectionErrorMessage(error: unknown, url: string): string {
  const raw = error instanceof Error ? error.message : "";
  if (raw && !UNREACHABLE.test(raw)) return translate(raw);
  const host = hostOf(url);
  if (!host) return translate("Unable to reach this Host.");
  const address = new URL(url.trim()).host;
  return isTailscaleHost(host)
    ? translate(
        "Cannot reach {address}. This is a Tailscale address: turn on Tailscale on this phone and sign in to the same tailnet as the computer, or scan a local network address instead.",
        { address },
      )
    : translate(
        "Cannot reach {address}. Make sure this phone is on the same Wi-Fi as the computer, OmniCode is running there, and its firewall allows the connection.",
        { address },
      );
}
