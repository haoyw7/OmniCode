import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { formatBuildVersion } from "../../shared/lib/buildVersion";
import type { PopoverSide } from "../../shared/lib/popover";
import type { useHoverSummary } from "../../shared/ui/HoverSummary";
import { Popover } from "../../shared/ui/Popover";
import {
  formatUpdateReleaseDate,
  localizedReleaseNotes,
  presentReleaseNotes,
} from "../model/releaseNotes";

export function UpdateNotesPopover({
  hover,
  version,
  releaseNotes,
  releaseDate,
  side = "right",
}: {
  hover: ReturnType<typeof useHoverSummary>;
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
  side?: PopoverSide;
}) {
  const { t, language } = useTranslation();
  // Available versions usually aren't in the installed build's changelog yet.
  // Prefer the update feed, with an exact-version bundled fallback.
  const remoteNotes = releaseNotes?.trim();
  const notes = presentReleaseNotes(
    version,
    remoteNotes || undefined,
    language,
  );
  const markdown =
    notes?.markdown ??
    (remoteNotes ? localizedReleaseNotes(remoteNotes, language) : undefined);
  const date = releaseDate || notes?.date;
  const formattedDate = date ? formatUpdateReleaseDate(date, language) : null;
  const title = t("v{version} Release notes", {
    version: formatBuildVersion(version),
  });

  return (
    <Popover
      open={hover.open}
      {...hover.surfaceProps}
      frameProps={{
        ref: hover.pointerSurfaceRef,
        onPointerEnter: hover.surfaceProps.onPointerEnter,
        onPointerLeave: hover.surfaceProps.onPointerLeave,
      }}
      ref={hover.surfaceRef}
      anchor={hover.anchorRef}
      side={side}
      align="end"
      gap={-1}
      width={460}
      maxHeight={420}
      role="tooltip"
      id={hover.id}
      aria-label={title}
      onDismiss={(reason) => hover.close(reason === "escape")}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      data-no-drag
      className="overflow-y-auto overscroll-contain panel-card p-3 text-content select-text"
    >
      <header className="mb-3 border-b border-stroke pb-2 text-[14px] leading-6">
        <div>{title}</div>
        {formattedDate ? (
          <time dateTime={date ?? undefined} className="block text-content/55">
            {formattedDate}
          </time>
        ) : null}
      </header>
      {markdown ? (
        <AgentMarkdown
          className="update-notes-md"
          text={markdown}
          streaming={false}
        />
      ) : (
        <p className="text-[13px] leading-relaxed text-content/60">
          {t("Release notes for this version are not available in this build.")}
        </p>
      )}
    </Popover>
  );
}
