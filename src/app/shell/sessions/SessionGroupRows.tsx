import { useSidebarListPreview } from "../useSidebarListPreview";
import { SidebarEntryReorderContext } from "../SidebarEntryReorder";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import type { SortableItemState } from "../../../shared/ui/primitives/Sortable";
import { ListMotionLi, ListMotionItem } from "../../../shared/ui/ListMotion";
import { CollapsingVirtualRows } from "../../../shared/ui/CollapsingVirtualRows";
import { ChevronDown, ChevronRight, CircleAlert } from "../../../shared/ui/icons";
import {
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import type { SessionSummary } from "../../../features/sessions/data/sessionStore";
import { TerminalSpinner } from "../../../features/sessions/ui/TerminalSpinner";



export function SessionGroupRow({
  label,
  accent,
  sessions,
  expanded,
  busy,
  done,
  needsApproval,
  groupIcon,
  dense = false,
  onToggle,
}: {
  label: string;
  accent?: string;
  sessions: SessionSummary[];
  expanded: boolean;
  busy: boolean;
  done: boolean;
  needsApproval: boolean;
  groupIcon: ReactNode;
  /** Project-tree rows indent their icon to the project name. */
  dense?: boolean;
  onToggle: () => void;
}) {
  const count = sessions.length;
  return (
    <button
      type="button"
      title={label}
      aria-expanded={expanded}
      data-session-group-row={dense ? "" : undefined}
      data-tauri-drag-region="false"
      onClick={onToggle}
      className={`focus-visible:focus-fill active:opacity-70 group relative flex w-full touch-none items-center gap-1.5 ${dense ? "pl-8 pr-2" : "px-2"} h-8 text-left ${
        expanded ? "rounded-lg" : ""
      } ${
        expanded
          ? "text-content hover:bg-surface-hover"
          : "text-content/80 hover:bg-surface-hover hover:text-content"
      }`}
    >
      <span
        className={`relative grid size-4 shrink-0 place-items-center ${
          accent ? "" : "text-foreground-subtle"
        }`}
        style={accent ? { color: accent } : undefined}
      >
        {expanded ? (
          groupIcon ? (
            <>
              <span className="group-hover:hidden group-focus-visible:hidden">
                {groupIcon}
              </span>
              <ChevronDown
                className="hidden size-3.5 text-content group-hover:block group-focus-visible:block"
              />
            </>
          ) : (
            <ChevronDown className="size-3.5 text-content" />
          )
        ) : (
          <>
            <span className="group-hover:hidden group-focus-visible:hidden">
              {groupIcon}
            </span>
            <ChevronRight
              className="hidden size-3.5 group-hover:block group-focus-visible:block text-content"
            />
          </>
        )}
      </span>
      <span className="relative min-w-0 flex-1 truncate text-ui-caption font-semibold leading-snug text-content">
        {label}
      </span>
      <span className="relative flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-content/45">
        {!expanded && needsApproval ? (
          <CircleAlert className="size-3 text-warning" />
        ) : !expanded && busy ? (
          <TerminalSpinner className="inline-flex size-4 shrink-0 select-none items-center justify-center text-[16px] leading-none text-accent" />
        ) : !expanded && done ? (
          <span className="size-1.5 rounded-full bg-accent" />
        ) : null}
        <span>{count}</span>
      </span>
    </button>
  );
}
/** Rows created this recently slide in; older ones are just being listed. */

export type SessionInsertMotion = { cwd: string; seen: Set<string> };

export function SessionGroupPreview({
  activeId,
  sessions,
  resetKey,
  searchActive,
  cwd,
  motion,
  renderCard,
}: {
  activeId?: string;
  sessions: SessionSummary[];
  resetKey: string;
  searchActive: boolean;
  cwd: string;
  motion: RefObject<SessionInsertMotion>;
  renderCard: (session: SessionSummary) => ReactNode;
}) {
  const preview = useSidebarListPreview(
    sessions.length,
    resetKey,
    searchActive,
  );
  return (
    <>
      <CollapsingVirtualRows as="li" gap={1} items={sessions.slice(0, preview.count)} getKey={session => session.id} estimateSize={52} activeIndex={sessions.slice(0, preview.count).findIndex(session => session.id === activeId)}>
      {(session) => (
        <SessionListItem
          as="div"
          key={session.id}
          session={session}
          cwd={cwd}
          motion={motion}
        >
          {renderCard(session)}
        </SessionListItem>
      )}
      </CollapsingVirtualRows>
      {preview.button && <li className="list-none">{preview.button}</li>}
    </>
  );
}

/** List row that grows open when a new session lands, pushing rows below it down. */
export function SessionListItem({
  as = "li",
  session,
  cwd: _cwd,
  motion,
  expanded,
  sortable,
  children,
}: {
  as?: "li" | "div";
  session: SessionSummary;
  cwd: string;
  motion: RefObject<SessionInsertMotion>;
  expanded?: boolean;
  sortable?: SortableItemState;
  children: ReactNode;
}) {
  const content = sortable ? (
    <SidebarEntryReorderContext.Provider value={sortable}>
      {children}
    </SidebarEntryReorderContext.Provider>
  ) : (
    children
  );
  // Decided once per row: effects can replay (StrictMode, reordering), and a
  // row that already slid in must not do it again.
  const played = useRef(false);
  useLayoutEffect(() => {
    if (played.current) return;
    played.current = true;
    const state = motion.current;
    state.seen.add(session.id);

  }, []);
  const Row = as === "li" ? ListMotionLi : ListMotionItem;
  return (
    <Row
      {...sortable?.motionProps}
      data-reordering={sortable?.sorting || undefined}
      data-dragging={sortable?.dragging || undefined}
      ref={sortable?.ref}
      style={sortable?.style}
      data-session-row={session.id}
      className={`${sortable ? "relative" : ""} ${expanded === undefined ? "" : "empty:hidden"}`}
    >
      {expanded === undefined ? (
        content
      ) : (
        <AnimatedCollapse expanded={expanded}>{content}</AnimatedCollapse>
      )}
    </Row>
  );
}
