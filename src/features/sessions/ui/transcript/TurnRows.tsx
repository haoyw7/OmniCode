import { DisclosureChevron } from "../../../../shared/ui/DisclosureChevron";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { ChevronRight } from "../../../../shared/ui/icons";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatedCollapse } from "../../../../shared/ui/AnimatedCollapse";
import { type HarnessId } from "../../model/session";
import { HarnessIcon } from "../HarnessIcon";
import { type ActivityPhaseKind, type TurnItem } from "../../model/transcriptActivity";
import { ActivityPhaseIcon } from "./activity/ActivityPhaseIcon";



/**
 * Animate one fold, then release its contents. Closed work must not retain
 * a component and DOM tree for every tool; only expansion builds those rows.
 * Visible rows stay out of Grid so they rewrap when their pane changes width.
 */
export function TurnRow({
  folded,
  children,
}: {
  folded: boolean;
  children: ReactNode | (() => ReactNode);
}) {
  return (
    <AnimatedCollapse expanded={!folded}>
      {() => (
        <div className="pb-1">
          {typeof children === "function" ? children() : children}
        </div>
      )}
    </AnimatedCollapse>
  );
}

/** Rows that just joined a closed fold: shown where they stood, then closed. */
export function FoldingRow({ children }: { children: () => ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    setExpanded(false);
  }, []);
  return <AnimatedCollapse expanded={expanded}>{children}</AnimatedCollapse>;
}

/** A turn item's identity, stable as the group it names grows. */
export function turnItemKey(item: TurnItem): string {
  return item.type === "block" ? item.block.id : item.blocks[0].id;
}

/**
 * The line a turn's work folds behind: the harness mark, and the clock —
 * ticking while the agent works, how long it took once it is done. Everything
 * the fold holds stays one click away, so the settled transcript reads as
 * prompt, answer, and a receipt for the work in between.
 */
export function WorkFoldLine({
  title,
  kind,
  harness,
  live = false,
  expandable,
  open,
  sheet,
  onToggle,
}: {
  title: ReactNode;
  kind: ActivityPhaseKind;
  harness?: HarnessId;
  live?: boolean;
  expandable: boolean;
  open: boolean;
  /** Set when tapping lists the work in a sheet; carries the edit totals. */
  sheet?: { additions: number; deletions: number };
  onToggle: () => void;
}) {
  const { t: uiT } = useTranslation();
  const iconTone = expandable && !sheet
    ? "group-hover/activity-disclosure:opacity-0 group-focus-visible/activity-disclosure:opacity-0"
    : "";
  const icon = (
    <span className="relative flex size-3.5 shrink-0 items-center justify-center">
      {harness ? (
        <HarnessIcon
          harness={harness}
          className={`size-3.5 shrink-0 ${iconTone}`}
        />
      ) : (
        <ActivityPhaseIcon kind={kind} className={iconTone} />
      )}
      {expandable && !sheet ? (
        <DisclosureChevron expanded={open} className="absolute size-3.5 opacity-0 group-hover/activity-disclosure:opacity-100 group-focus-visible/activity-disclosure:opacity-100" />
      ) : null}
    </span>
  );
  // While the agent runs, its status shimmers on the fold line.
  const label = live ? (
    title
  ) : (
    <span className="min-w-0 flex-1 truncate font-sans text-sm text-foreground-subtlest transition-colors duration-200 group-hover:text-content/80">
      {title}
    </span>
  );
  const row = `desktop-work-fold-line flex w-full min-w-0 items-center gap-1.5 px-4 @md:px-6 py-1 text-left${
    open ? " zen-fold-drop" : ""
  }`;

  // Keep one host element as work becomes collapsible. Switching div/button
  // remounts the live title, resetting its clock and desktop shimmer.
  return (
    <button
      type="button"
      role={!expandable ? (live ? "status" : "presentation") : undefined}
      tabIndex={expandable ? undefined : -1}
      aria-haspopup={sheet ? "dialog" : undefined}
      aria-expanded={expandable && !sheet ? open : undefined}
      aria-label={expandable ? (open && !sheet ? uiT("Hide the work") : uiT("Show the work")) : undefined}
      aria-live={live ? "polite" : undefined}
      onClick={expandable ? onToggle : undefined}
      className={`group group/activity-disclosure ${row}${expandable ? "" : " cursor-default"}`}
      data-activity-sheet={sheet ? true : undefined}
    >
      {icon}
      {label}
      {sheet && (sheet.additions > 0 || sheet.deletions > 0) ? (
        <span className="shrink-0 font-mono text-xs">
          <span className="text-emerald-400">+{sheet.additions}</span>
          <span className="ms-1 text-red-400">−{sheet.deletions}</span>
        </span>
      ) : null}
      {sheet ? <ChevronRight className="size-3.5 shrink-0 text-foreground-subtlest" /> : null}
    </button>
  );
}
