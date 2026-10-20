import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Desktop uses the system browser; the web preview uses a separate tab. */
export async function openBrowser(url: string): Promise<void> {
  if (isTauri()) return openUrl(url);
  const tab = window.open(url, "_blank");
  if (!tab) throw new Error("Browser popup was blocked");
  tab.opener = null;
}
