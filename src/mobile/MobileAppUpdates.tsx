import { Button } from "../shared/ui/forms/Button";
import { MobileSpinner } from "./MobileSpinner";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { withToast } from "../shared/ui/primitives/Sonner";
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
  type MobileUpdate,
} from "./updates";

export function useMobileAppUpdates() {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const live = useRef(true);
  const busy = useRef(false);
  const ios = Capacitor.getPlatform() === "ios";
  // This is only the minimum indicator duration; Query publishes results immediately.
  const [indicator, setIndicator] = useState<"check" | "install" | null>(ios ? null : "check");
  useEffect(() => {
    if (!indicator) return;
    const timer = setTimeout(() => setIndicator(null), 2000);
    return () => clearTimeout(timer);
  }, [indicator]);
  const installedRead = useQuery({ queryKey: ["mobile", "installedBuild"], queryFn: getInstalledBuild, enabled: !ios }, queryClient);
  const latestRead = useQuery({
    queryKey: ["mobile", "update"], enabled: !ios,
    queryFn: checkMobileUpdate,
  }, queryClient);
  const installed = installedRead.data, latest = latestRead.data;
  const checking = installedRead.isFetching || latestRead.isFetching || indicator === "check";
  const available = installed && latest && hasMobileUpdate(installed, latest);
  const check = useCallback(async () => {
    if (busy.current || ios || queryClient.isFetching({ queryKey: ["mobile", "update"] })) return;
    busy.current = true; setIndicator("check");
    await Promise.all([installedRead.refetch(), latestRead.refetch()]);
  }, [ios, installedRead.refetch, latestRead.refetch]);

  useEffect(() => {
    live.current = true;
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

  const mutation = useMutation({ mutationFn: (update: MobileUpdate) => withToast(async () => {
    setNotice(""); setProgress(0);
    let listener;
    try {
      if (Capacitor.getPlatform() !== "android") { window.location.assign(updateDownloadUrl(update)); return; }
      const permission = await Updates.installPermission({ request: true });
      if (!permission.allowed) {
        if (live.current) setNotice("Allow OmniCode to install apps, then return and tap Download and install again.");
        return;
      }
      listener = await Updates.addListener("downloadProgress", ({ received, total }) => {
        if (live.current) setProgress(Math.min(100, Math.round((received / total) * 100)));
      });
      await Updates.downloadAndInstall({ url: updateDownloadUrl(update), ...update });
      if (live.current) setNotice("Confirm the update in the Android installer.");
    } finally {
      await listener?.remove();
    }
  }, { loading: t("Downloading…"), success: false, error: false }) }, queryClient);
  const installing = mutation.isPending || indicator === "install";
  busy.current = checking || installing;
  const problem = mutation.error ?? installedRead.error ?? latestRead.error;
  const error = problem ? problem instanceof Error ? problem.message : mutation.error ? "Update installation failed." : "Update check failed." : "";
  const install = async () => {
    if (!latest || installing || checking || !available || busy.current) return;
    busy.current = true; setIndicator("install");
    try { await mutation.mutateAsync(latest); } catch { /* The page shows the failure. */ }
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
                  <RefreshCw />
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
                    <ArrowDownCircle />
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
        </>
      )}
    </section>
  );
}
