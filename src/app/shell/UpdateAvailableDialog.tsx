import { Omi } from "../../shared/ui/branding/Omi";
import { useRef, useState } from "react";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { formatBuildVersion } from "../../shared/lib/buildVersion";
import { Button } from "../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../shared/ui/Modal";
import { CalendarDays } from "../../shared/ui/icons";
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
import { Spinner } from "../../shared/ui/primitives/Spinner";

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
            className="size-12 shrink-0 rounded-xl bg-content text-white object-contain p-1.5"
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
        <ModalFooter className="mt-6">
          <Button variant="secondary" className="mr-auto" onClick={onSkip} disabled={busy}>
            {t("Skip this version")}
          </Button>
          <Button variant="secondary" autoFocus onClick={onClose}>
            {t("Later")}
          </Button>
          <Button variant="primary" onClick={() => void install()} disabled={busy}>
            {busy ? (
              <Spinner className="size-4" aria-hidden />
            ) : null}
            {downloadLabel}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
