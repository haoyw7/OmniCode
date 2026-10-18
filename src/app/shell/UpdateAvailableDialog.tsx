import { Omi } from "../../shared/ui/branding/Omi";
import { useRef, useState } from "react";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { formatBuildVersion } from "../../shared/lib/buildVersion";
import { Modal } from "../../shared/ui/Modal";
import { CalendarDays, Loader } from "../../shared/ui/icons";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import {
  formatUpdateReleaseDate,
  localizedReleaseNotes,
  presentReleaseNotes,
} from "../model/releaseNotes";
import {
  loadUpdatePreferences,
  saveUpdatePreferences,
} from "../model/updatePreferences";
import type { UpdaterSnapshot } from "../model/updater";

export function UpdateAvailableDialog({
  snapshot,
  onInstall,
  onSkip,
  onClose,
}: {
  snapshot: UpdaterSnapshot;
  onInstall: () => void | Promise<void>;
  onSkip: () => void;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const [autoInstall, setAutoInstall] = useState(
    () => loadUpdatePreferences().autoInstall,
  );
  const installing = useRef(false);
  const [starting, setStarting] = useState(false);
  const busy = starting || snapshot.phase === "downloading";
  const version = snapshot.availableVersion ?? "";
  const remoteNotes = snapshot.releaseNotes?.trim();
  const notes = presentReleaseNotes(
    version,
    remoteNotes || undefined,
    language,
  );
  const markdown =
    notes?.markdown ??
    (remoteNotes ? localizedReleaseNotes(remoteNotes, language) : undefined);
  const date = snapshot.releaseDate || notes?.date;
  const formattedDate = date ? formatUpdateReleaseDate(date, language) : null;
  const downloadLabel = busy
    ? snapshot.progress != null
      ? t("Downloading {progress}%", { progress: snapshot.progress })
      : t("Downloading…")
    : t("Download update");

  const install = async () => {
    if (busy || installing.current) return;
    installing.current = true;
    setStarting(true);
    try {
      await onInstall();
    } finally {
      installing.current = false;
      setStarting(false);
    }
  };

  return (
    <Modal
      title={t("Update available")}
      minimalHeader
      fitViewport
      onClose={onClose}
      className="panel-card"
    >
      <div className="px-6 pb-6 pt-12 text-content">
        <div className="flex items-center gap-4">
          <Omi compact
            aria-hidden
            className="size-12 shrink-0 rounded-xl bg-neutral-900 text-white object-contain p-1.5"
          />
          <div className="min-w-0">
            <h3 className="desktop-pane-heading text-[16px] font-medium">
              {t("New version available  v{version}", {
                version: formatBuildVersion(version),
              })}
            </h3>
            {formattedDate ? (
              <div className="mt-2 flex items-center gap-1.5 text-[12px] text-content/55">
                <CalendarDays className="size-3.5" aria-hidden />
                <time dateTime={date ?? undefined}>{formattedDate}</time>
              </div>
            ) : null}
          </div>
        </div>
        {markdown ? (
          <section
            aria-label={t("Release notes")}
            className="mt-6 max-h-64 overflow-y-auto overscroll-contain"
          >
            <AgentMarkdown
              className="update-notes-md"
              text={markdown}
              streaming={false}
            />
          </section>
        ) : null}
        <label className="mt-8 flex cursor-pointer items-center gap-2.5 text-[14px]">
          <input data-ui="checkbox"
            type="checkbox"
            checked={autoInstall}
            onChange={(event) => {
              setAutoInstall(event.target.checked);
              saveUpdatePreferences({ autoInstall: event.target.checked });
            }}
            className="size-4 accent-accent"
          />
          {t("Automatically download and install future updates")}
        </label>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="mr-auto rounded-lg bg-content/8 px-4 py-2.5 text-[14px] transition-colors hover:bg-content/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
          >
            {t("Skip this version")}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-lg bg-content/8 px-4 py-2.5 text-[14px] transition-colors hover:bg-content/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t("Later")}
          </button>
          <button
            type="button"
            onClick={() => void install()}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[14px] text-primary-foreground transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-60"
          >
            {busy ? (
              <Loader className="size-4 animate-spin" aria-hidden />
            ) : null}
            {downloadLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
