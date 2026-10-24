import { confirmNativeAction, showNativeMessage } from "../../platform/tauri/dialogs";
import { nativeAppVersion, relaunchDesktopApp, checkDesktopUpdate, type DesktopDownloadEvent, type DesktopUpdate } from "../../platform/tauri/updater";
import { announceUpdateAvailable } from "../../features/settings/model/sounds";
import { rememberInstalledUpdate } from "./updateNotice";
import { formatBuildVersion } from "../../shared/lib/buildVersion";
import { loadUpdatePreferences } from "./updatePreferences";
import { localizedReleaseNotes } from "../../shared/lib/releaseNotes";

export type UpdaterPhase =
  "idle" | "checking" | "current" | "available" | "downloading" | "error";

export type UpdaterSnapshot = {
  phase: UpdaterPhase;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  progress?: number;
  error?: string;
};

let pendingUpdate: DesktopUpdate | null = null;

type ManualUpdatePresenter = (snapshot: UpdaterSnapshot) => void;
let manualUpdatePresenter: ManualUpdatePresenter | null = null;

/** The workspace shows a manually found update in its own dialog instead of
 * a native prompt, which cannot render release-note Markdown. */
export function presentManualUpdatesWith(presenter: ManualUpdatePresenter) {
  manualUpdatePresenter = presenter;
  return () => {
    if (manualUpdatePresenter === presenter) manualUpdatePresenter = null;
  };
}

function isUpdaterNotConfiguredError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /updater does not have any endpoints set/i.test(text);
}

export async function readAppVersion(): Promise<string> {
  try {
    return await nativeAppVersion();
  } catch {
    return "0.0.0";
  }
}

export async function probeForUpdate(): Promise<DesktopUpdate | null> {
  const update = await checkDesktopUpdate();
  if (update && loadUpdatePreferences().skippedVersion === update.version) {
    pendingUpdate = null;
    return null;
  }
  pendingUpdate = update;
  if (update) announceUpdateAvailable(update.version);
  return update;
}

export async function runUpdateFlow(
  manual: boolean,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const currentVersion = await readAppVersion();
  const base: UpdaterSnapshot = { phase: "checking", currentVersion };
  onProgress?.(base);

  try {
    const update = await checkDesktopUpdate();
    if (!update) {
      pendingUpdate = null;
      const current: UpdaterSnapshot = { phase: "current", currentVersion };
      onProgress?.(current);
      if (manual) {
        await showNativeMessage("You're on the latest version.", { title: "OmniCode" });
      }
      return current;
    }

    pendingUpdate = update;
    announceUpdateAvailable(update.version);
    const available: UpdaterSnapshot = {
      phase: "available",
      currentVersion,
      availableVersion: update.version,
      releaseNotes: update.body,
      releaseDate: update.date,
    };
    onProgress?.(available);

    if (!manual) return available;
    if (manualUpdatePresenter) {
      manualUpdatePresenter(available);
      return available;
    }

    const notes = update.body?.trim()
      ? localizedReleaseNotes(update.body.trim())
      : "";
    const detail = notes ? `\n\n${notes}` : "";
    const yes = await confirmNativeAction(
      `OmniCode ${formatBuildVersion(update.version)} is available (you have ${formatBuildVersion(currentVersion)}).${detail}\n\nInstall now?`,
      { title: "Update available", kind: "info" },
    );
    if (!yes) return available;

    return installPendingUpdate(onProgress);
  } catch (err) {
    if (isUpdaterNotConfiguredError(err)) {
      pendingUpdate = null;
      const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
      onProgress?.(idle);
      if (manual) {
        await showNativeMessage(
          "Automatic updates aren't configured for this build.\n\nDownload releases at https://github.com/haoyw7/OmniCode/releases/latest",
          { title: "OmniCode" },
        );
      }
      return idle;
    }

    const error = err instanceof Error ? err.message : String(err);
    const failed: UpdaterSnapshot = { phase: "error", currentVersion, error };
    onProgress?.(failed);
    if (manual) {
      await showNativeMessage(`Couldn't check for updates.\n\n${error}`, {
        title: "OmniCode",
      });
    }
    return failed;
  }
}

export async function installPendingUpdate(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const currentVersion = await readAppVersion();
  const update = pendingUpdate;
  if (!update) {
    const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
    onProgress?.(idle);
    return idle;
  }

  let downloaded = 0;
  let contentLength = 0;

  const downloading: UpdaterSnapshot = {
    phase: "downloading",
    currentVersion,
    availableVersion: update.version,
    releaseNotes: update.body,
    releaseDate: update.date,
    progress: 0,
  };
  onProgress?.(downloading);

  try {
    await update.download((event: DesktopDownloadEvent) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
        downloaded = 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }

      const progress =
        contentLength > 0
          ? Math.min(100, Math.round((downloaded / contentLength) * 100))
          : undefined;

      onProgress?.({
        ...downloading,
        progress,
      });
    });
    await update.install();

    rememberInstalledUpdate(update.version);
    pendingUpdate = null;
    await relaunchDesktopApp();
    return {
      phase: "current",
      currentVersion: update.version,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const failed: UpdaterSnapshot = {
      ...downloading,
      phase: "error",
      progress: undefined,
      error,
    };
    onProgress?.(failed);
    await showNativeMessage(`Couldn't install the update.\n\n${error}`, {
      title: "OmniCode",
    });
    return failed;
  }
}
