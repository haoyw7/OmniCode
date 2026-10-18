import { useTranslation } from "../../shared/i18n/useTranslation";
import {
  formatUpdateReleaseDate,
  presentReleaseNotes,
  releaseNotesTitle,
} from "../model/releaseNotes";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { Modal } from "../../shared/ui/Modal";
import { formatBuildVersion } from "../../shared/lib/buildVersion";

type Props = {
  version: string;
  onClose: () => void;
};

export function WhatsNewBody({ version }: { version: string }) {
  const { t: uiT, language } = useTranslation();
  const notes = presentReleaseNotes(version, undefined, language);
  const title = releaseNotesTitle(version);

  return (
    <article aria-label={title} className="px-5 py-4">
      {notes?.markdown ? (
        <AgentMarkdown
          className="whats-new-md"
          text={notes.markdown}
          streaming={false}
        />
      ) : (
        <p className="text-[13px] text-content/60">
          {uiT(
            "Release notes for this version are not available in this build.",
          )}
        </p>
      )}
    </article>
  );
}

export function WhatsNewDialog({ version, onClose }: Props) {
  const { t: uiT, language } = useTranslation();
  const notes = presentReleaseNotes(version, undefined, language);
  const date = notes?.date
    ? formatUpdateReleaseDate(notes.date, language)
    : null;

  return (
    <Modal
      onClose={onClose}
      title={uiT("What's new")}
      description={`OmniCode ${formatBuildVersion(version)}${date ? ` · ${date}` : ""}`}
      size="md"
      className="h-[min(72vh,640px)]"
    >
      <WhatsNewBody version={version} />
    </Modal>
  );
}
