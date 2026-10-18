import { useSidebarListPreview } from "../useSidebarListPreview";
import { SidebarEntryReorderContext } from "../SidebarEntryReorder";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import {
  useAnimatedReorder,
  type ReorderExternalDrop,
} from "../../../shared/hooks/useAnimatedReorder";
import { ChevronDown, ChevronRight, CircleAlert } from "../../../shared/ui/icons";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
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
      className={`group relative flex w-full touch-none items-center gap-1.5 ${dense ? "pl-8 pr-2" : "px-2"} h-8 text-left ${
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
          <CircleAlert className="size-3 text-amber-400" />
        ) : !expanded && busy ? (
          <TerminalSpinner className="inline-flex size-4 shrink-0 select-none items-center justify-center text-[16px] leading-none text-accent" />
        ) : !expanded && done ? (
          <span className="size-1.5 rounded-full bg-sky-500" />
        ) : null}
        <span>{count}</span>
      </span>
    </button>
  );
}
/** Rows created this recently slide in; older ones are just being listed. */

export type SessionInsertMotion = { cwd: string; seen: Set<string> };

export function SessionGroupPreview({
  sessions,
  resetKey,
  searchActive,
  cwd,
  motion,
  renderCard,
}: {
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
      {sessions.map((session, index) => (
        <SessionListItem
          key={session.id}
          session={session}
          cwd={cwd}
          motion={motion}
          expanded={index < preview.count}
        >
          {renderCard(session)}
        </SessionListItem>
      ))}
      {preview.button && <li className="list-none">{preview.button}</li>}
    </>
  );
}

/** List row that grows open when a new session lands, pushing rows below it down. */
export function SessionListItem({
  session,
  cwd: _cwd,
  motion,
  expanded,
  sortable,
  children,
}: {
  session: SessionSummary;
  cwd: string;
  motion: RefObject<SessionInsertMotion>;
  expanded?: boolean;
  sortable?: ReturnType<typeof useAnimatedReorder<string>>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // A fresh value would re-render every memoized card on each section render.
  const dragging = !!sortable && sortable.draggingId !== null;
  const onItemPointerDown = sortable?.onItemPointerDown;
  const consumeClick = sortable?.consumeClick;
  const reorder = useMemo(
    () =>
      onItemPointerDown && consumeClick
        ? {
            dragging,
            onPointerDown: (
              event: ReactPointerEvent,
              externalDrop?: ReorderExternalDrop<string>,
            ) => onItemPointerDown(session.id, event, externalDrop),
            consumeClick,
          }
        : null,
    [dragging, onItemPointerDown, consumeClick, session.id],
  );
  const content = reorder ? (
    <SidebarEntryReorderContext.Provider value={reorder}>
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
  return (
    <li
      ref={(node) => {
        ref.current = node;
        sortable?.setItemRef(session.id, node);
      }}
      data-session-row={session.id}
      className={`${sortable ? "reorder-item session-reorder-item relative" : ""} ${expanded === undefined ? "" : "empty:hidden"}`}
    >
      {expanded === undefined ? (
        content
      ) : (
        <AnimatedCollapse expanded={expanded}>{content}</AnimatedCollapse>
      )}
    </li>
  );
}
