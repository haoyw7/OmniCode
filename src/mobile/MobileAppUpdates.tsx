import { Button } from "../shared/ui/forms/Button";
import { MobileSpinner } from "./MobileSpinner";
import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { ArrowDownCircle, RefreshCw } from "../shared/ui/icons";
import { MobileSwap } from "./MobileSwap";
import { useTranslation } from "../shared/i18n/useTranslation";
import {
  localizedReleaseNotes,
  presentReleaseNotes,
} from "../app/model/releaseNotes";
import { AgentMarkdown } from "../features/sessions/ui/AgentMarkdown";
import {
  Updates,
  checkMobileUpdate,
  getInstalledBuild,
  hasMobileUpdate,
  updateBaseUrls,
  updateDownloadUrl,
  type InstalledBuild,
  type MobileUpdate,
} from "./updates";

// Keep the loading indicator and duplicate-action guard active together.
const minimumLoading = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 2_000));

export function useMobileAppUpdates() {
  const [installed, setInstalled] = useState<InstalledBuild>();
  const [latest, setLatest] = useState<MobileUpdate>();
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const live = useRef(true);
  const busy = useRef(false);
  const ios = Capacitor.getPlatform() === "ios";
  const available = installed && latest && hasMobileUpdate(installed, latest);

  const check = useCallback(async () => {
    if (busy.current || ios) return;
    busy.current = true;
    const loading = minimumLoading();
    setChecking(true);
    setError("");
    try {
      const build = await getInstalledBuild();
      if (live.current) setInstalled(build);
      const update = await checkMobileUpdate();
      if (live.current) setLatest(update);
    } catch (problem) {
      if (live.current)
        setError(
          problem instanceof Error ? problem.message : "Update check failed.",
        );
    } finally {
      await loading;
      busy.current = false;
      if (live.current) setChecking(false);
    }
  }, [ios]);

  useEffect(() => {
    live.current = true;
    void check();
    const foreground = Capacitor.isNativePlatform()
      ? App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) void check();
        })
      : undefined;
    return () => {
      live.current = false;
      void foreground?.then((handle) => handle.remove());
    };
  }, [check]);

  const install = async () => {
    if (!latest || installing || !available || busy.current) return;
    busy.current = true;
    const loading = minimumLoading();
    setError("");
    setNotice("");
    setInstalling(true);
    setProgress(0);
    let listener;
    try {
      if (Capacitor.getPlatform() !== "android") {
        window.location.assign(updateDownloadUrl(latest));
        return;
      }
      const permission = await Updates.installPermission({ request: true });
      if (!permission.allowed) {
        setNotice(
          "Allow OmniCode to install apps, then return and tap Download and install again.",
        );
        return;
      }
      listener = await Updates.addListener(
        "downloadProgress",
        ({ received, total }) => {
          if (live.current)
            setProgress(Math.min(100, Math.round((received / total) * 100)));
        },
      );
      await Updates.downloadAndInstall({
        url: updateDownloadUrl(latest),
        ...latest,
      });
      if (live.current)
        setNotice("Confirm the update in the Android installer.");
    } catch (problem) {
      if (live.current)
        setError(
          problem instanceof Error
            ? problem.message
            : "Update installation failed.",
        );
    } finally {
      try {
        await listener?.remove();
      } finally {
        await loading;
        busy.current = false;
        if (live.current) setInstalling(false);
      }
    }
  };

  return {
    installed,
    latest,
    checking,
    installing,
    progress,
    error,
    notice,
    ios,
    available,
    check,
    install,
  };
}

export function MobileAppUpdates({
  state,
}: {
  state: ReturnType<typeof useMobileAppUpdates>;
}) {
  const { t, language } = useTranslation();
  const {
    installed,
    latest,
    checking,
    installing,
    progress,
    error,
    notice,
    ios,
    available,
    check,
    install,
  } = state;
  const notesVersion = available ? latest?.versionName : installed?.version;
  const remoteNotes =
    latest?.versionName === notesVersion ? latest?.notes?.trim() : undefined;
  const notes = notesVersion
    ? presentReleaseNotes(notesVersion, remoteNotes || undefined, language)
    : null;
  const markdown =
    notes?.markdown ??
    (remoteNotes ? localizedReleaseNotes(remoteNotes, language) : undefined);
  return (
    <section className="mobile-app-updates" aria-label={t("App updates")}>
      <h2>{t("App updates")}</h2>
      {ios ? (
        <p className="mobile-muted">
          {t("iOS updates require an Apple distribution channel.")}
        </p>
      ) : (
        <>
          <dl>
            <div>
              <dt>{t("Installed version")}</dt>
              <dd>
                {installed
                  ? `${t(installed.version)} (${t("Build {number}", { number: installed.build })})`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("Update source")}</dt>
              <dd className="mobile-update-source">
                {updateBaseUrls.map((source) => (
                  <div key={source}>{source}</div>
                ))}
              </dd>
            </div>
            {latest && (
              <div>
                <dt>{t("Latest version")}</dt>
                <dd>
                  {latest.versionName} (
                  {t("Build {number}", { number: latest.versionCode })})
                </dd>
              </div>
            )}
          </dl>
          {latest && (
            <p className="mobile-muted" role="status">
              {t(
                available
                  ? "A new version is available."
                  : "You are up to date.",
              )}
            </p>
          )}
          <div className="mobile-update-actions">
            <Button variant="secondary"

              disabled={checking || installing}
              aria-busy={checking}
              onClick={() => void check()}
            >
              <MobileSwap swapKey={checking ? "busy" : "idle"}>
                {checking ? (
                  <MobileSpinner size={16} className="mobile-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                {t(checking ? "Checking for updates…" : "Check for updates")}
              </MobileSwap>
            </Button>
            {available && (
              <Button variant="primary"

                disabled={installing || checking}
                aria-busy={installing}
                onClick={() => void install()}
              >
                <MobileSwap swapKey={installing ? "busy" : "idle"}>
                  {installing ? (
                    <MobileSpinner size={16} className="mobile-spin" />
                  ) : (
                    <ArrowDownCircle size={16} />
                  )}
                  {installing
                    ? t("Downloading… {percent}%", { percent: progress })
                    : t("Download and install")}
                </MobileSwap>
              </Button>
            )}
          </div>
          {installing && (
            <progress
              value={progress}
              max={100}
              aria-label={t("Update download progress")}
            />
          )}
          {notice && (
            <p className="mobile-muted" role="status">
              {t(notice)}
            </p>
          )}
          {error && (
            <p className="mobile-form-error" role="alert">
              {t(
                "Unable to update. Make sure your computer is online and connected to the same network.",
              )}{" "}
              {t(error)}
            </p>
          )}
          {markdown ? (
            <section
              aria-label={t("Release notes")}
              className="mt-4 max-h-64 overflow-y-auto overscroll-contain"
            >
              <h3>{t("Release notes")}</h3>
              <AgentMarkdown text={markdown} streaming={false} />
            </section>
          ) : null}
          <p className="mobile-update-hint">
            {t(
              "Checks automatically when you open the app. Your computer publishes each new APK build.",
            )}
          </p>
        </>
      )}
    </section>
  );
}
