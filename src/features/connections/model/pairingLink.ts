/** The QR text read by the mobile app: `monocode://pair?host=<Host URL>&token=<pairing code>`. */
export function pairingLink(hostUrl: string, token: string): string {
  return `monocode://pair?${new URLSearchParams({ host: hostUrl, token })}`;
}

/** The Host URL as the phone reaches it, or undefined if it has a path, query or credentials. */
export function pairingHostUrl(input: string): string | undefined {
  try {
    const url = new URL(input.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username || url.password || url.search || url.hash ||
      !["", "/"].includes(url.pathname)
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
