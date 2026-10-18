import { useTranslation } from "../../shared/i18n/useTranslation";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import {
  releaseNotesMarkdown,
  type ReleaseNotesTabSource,
} from "../model/releaseNotes";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";

export function ReleaseNotesSurface({
  source,
}: {
  source: ReleaseNotesTabSource;
}) {
  const { t: uiT, language } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const markdown = releaseNotesMarkdown(source, undefined, language);

  return (
    <div
      ref={lockOverscroll}
      className="h-full overflow-y-auto overscroll-none"
    >
      <article
        aria-label={uiT("Release notes")}
        className="mx-auto w-full max-w-3xl px-8 py-10"
      >
        {markdown ? (
          <AgentMarkdown text={markdown} streaming={false} />
        ) : (
          <p className="text-[13px] text-content/60">
            {uiT(
              "Release notes for this version are not available in this build.",
            )}
          </p>
        )}
      </article>
    </div>
  );
}
