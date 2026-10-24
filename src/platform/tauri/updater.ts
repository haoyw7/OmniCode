import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export type DesktopDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export interface DesktopUpdate {
  version: string;
  body?: string;
  date?: string;
  download(onProgress: (event: DesktopDownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
}

export function nativeAppVersion(): Promise<string> {
  return getVersion();
}

export function relaunchDesktopApp(): Promise<void> {
  return relaunch();
}

export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    body: update.body,
    date: update.date,
    download: (progress) => update.download(progress),
    async install() {
      // Windows cannot overwrite the bundled Host executable while it runs.
      await invoke("prepare_update_install");
      await update.install();
    },
  };
}
