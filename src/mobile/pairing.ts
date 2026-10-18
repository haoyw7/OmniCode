import { normalizeHostUrl } from "./client";

/**
 * Host credentials read from a pairing QR code:
 * `monocode://pair?host=<Host URL>&token=<pairing code>`. The pairing code is
 * exchanged once for a private device credential issued by MonoCode Host.
 */
export type PairingOffer = { host: string; token: string };

/** Accept `xd5j2j3u` or `xd5j-2j3u` for Host pairing codes like `XD5J-2J3U`. */
export function normalizePairingCode(input: string): string {
  const value = input.trim();
  const short = /^([A-Za-z0-9]{4})[\s-]?([A-Za-z0-9]{4})$/.exec(value);
  return short ? `${short[1]}-${short[2]}`.toUpperCase() : value;
}

export function parsePairingOffer(text: string): PairingOffer {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new Error("This QR code is not a OmniCode pairing code.");
  }
  const host = url.searchParams.get("host");
  const token = normalizePairingCode(url.searchParams.get("token") ?? "");
  if (url.protocol !== "monocode:" || url.hostname !== "pair" || !host || !token)
    throw new Error("This QR code is not a OmniCode pairing code.");
  if (!/^[A-Za-z0-9_-]+$/.test(token))
    throw new Error("Enter a valid device token from OmniCode Host.");
  return { host: normalizeHostUrl(host), token };
}
