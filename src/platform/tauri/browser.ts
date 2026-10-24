import { isTauri } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

/** Hand an external URL to the user's registered OS application. */
export function openExternalUrl(url: string): Promise<void> {
  return openUrl(url);
}

export function revealLocalItem(path: string): Promise<void> {
  return revealItemInDir(path);
}

/** Desktop uses the system browser; the web preview uses a separate tab. */
export async function openBrowser(url: string): Promise<void> {
  if (isTauri()) return openUrl(url);
  const tab = window.open(url, "_blank");
  if (!tab) throw new Error("Browser popup was blocked");
  tab.opener = null;
}
