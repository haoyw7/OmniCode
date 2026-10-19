import { IconButton } from "../../../shared/ui/forms/IconButton";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { SidebarEntryReorderContext, sidebarDragPreview } from "../SidebarEntryReorder";
import { sessionRecencyAt } from "../../../features/sessions/model/sessionActivity";
import {
  useAnimatedReorder,
  type ReorderExternalDrop,
} from "../../../shared/hooks/useAnimatedReorder";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { NO_BRANCH_LABEL } from "../../../features/source-control/model/worktrees";
import {
  OrchestrationSidebarAgents,
} from "../../../features/orchestration/ui/OrchestrationSidebarAgents";
import { SessionWorkflowRunLines } from "../../../features/workflows/ui/SessionWorkflowRunLines";
import { useWorkflowActivity } from "../../../features/workflows/model/workflowActivity";
import { isSessionWorkflowRunLive } from "../../../integrations/workflow/protocol/sessions-index-workflow-activity";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Archive,
  CircleAlert,
  CircleDashed,
  CircleDot,
  Clock,
  Folder,
  GitBranch,
  GitPullRequest,
  MoreHorizontal,
  MousePointer2,
  Pin,
  Share,
  Zap,
} from "../../../shared/ui/icons";
import {
  memo,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MOD } from "../../../platform/tauri/platform";
import { resolveModel } from "../../../features/sessions/model/models";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  type LinkedWorkItem,
} from "../../../features/sessions/model/session";
import { ParticleText } from "../../../shared/ui/ParticleText";
import { orchestrationTaskLabel } from "../../../features/orchestration/model/orchestrationSummary";
import { paneDropFromPoint, setExternalPaneDrop } from "../../../features/workspace/model/paneDrop";
import type { PaneEdge } from "../../../features/workspace/model/layout";
import { createDragLabel } from "../../../shared/lib/drag";
import { combineSidebarDrops, sidebarPinDrop, SidebarPinDropContext } from "../sidebarPinDrop";
import type { SessionSummary } from "../../../features/sessions/data/sessionStore";
import { HarnessIcon } from "../../../features/sessions/ui/HarnessIcon";
import { useSessionPageCount } from "./sessionPageCounts";
import { SessionWorktreeIcon } from "../../../features/sessions/ui/SessionWorktreeIcon";
import { TerminalSpinner } from "../../../features/sessions/ui/TerminalSpinner";
import { Popover } from "../../../shared/ui/Popover";
import { HoverSummary, HoverSummaryRow, useHoverSummary } from "../../../shared/ui/HoverSummary";



const SESSION_PREFETCH_DELAY_MS = 120;

export const SessionCard = memo(function SessionCard({
  session,
  projectLabel,
  isActive,
  isSelected,
  busy,
  done,
  unread,
  linkedUpdate,
  waitingFor,
  compact = false,
  dense = false,
  shortcut = false,
  plainTree = false,
  now,
  onSelect,
  onOpenWorkItem,
  onPrefetch,
  onPlaceOnPane,
  onContextMenu,
  onOpenMenu,
  onArchive,
  onPin,
  onRename,
  onDelete,
}: {
  session: SessionSummary;
  projectLabel?: string;
  isActive: boolean;
  isSelected: boolean;
  busy: boolean;
  done: boolean;
  unread: boolean;
  linkedUpdate: boolean;
  waitingFor?: "approval" | "input";
  compact?: boolean;
  dense?: boolean;
  shortcut?: boolean;
  plainTree?: boolean;
  now: number;
  onSelect: (
    sessionId: string,
    event: {
      shiftKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey?: boolean;
    },
  ) => void;
  onOpenWorkItem?: (item: LinkedWorkItem, sessionId: string) => void;
  onPrefetch?: (sessionId: string) => void;
  onPlaceOnPane?: (sessionId: string, targetId: string, edge: PaneEdge) => void;
  onContextMenu?: (
    sessionId: string,
    e: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  onArchive?: (sessionId: string, archived: boolean) => void;
  onOpenMenu?: (sessionId: string, x: number, y: number) => void;
  onPin?: (sessionId: string) => void;
  onRename?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const workflow = useWorkflowActivity(session.id);
  const running = busy || !!workflow?.activity.runs.some((run) => isSessionWorkflowRunLive(run.status));
  const inheritedReorder = useContext(SidebarEntryReorderContext);
  const revealPins = useContext(SidebarPinDropContext);
  const standaloneReorder = useAnimatedReorder(
    inheritedReorder ? [] : [session.id],
    () => {},
    "y",
    undefined,
    { floatingPreview: sidebarDragPreview },
  );
  const sidebarReorder = inheritedReorder ?? {
    dragging: standaloneReorder.draggingId !== null,
    onPointerDown: (event: ReactPointerEvent, drop?: ReorderExternalDrop<string>) =>
      standaloneReorder.onItemPointerDown(session.id, event, drop),
    consumeClick: standaloneReorder.consumeClick,
  };
  const prefetchTimer = useRef<number | null>(null);
  const orchestrationTooltipRootRef = useRef<HTMLDivElement>(null);
  const orchestrationTooltipId = useId();
  const [orchestrationTooltipOpen, setOrchestrationTooltipOpen] =
    useState(false);
  const metadataHover = useHoverSummary<HTMLDivElement>({
    enabled:
      dense && !orchestrationTooltipOpen && !sidebarReorder.dragging,
    // A clicked row keeps focus; the card must still leave with the pointer.
    focusRetains: false,
  });
  const orchestration = session.orchestration;
  const failed = orchestration?.tasks.some((task) => task.status === "failed");
  const draft = !!session.draft;
  const orchestrationExpanded =
    !dense && !!orchestration && (isActive || isSelected || busy);
  const orchestrationDone =
    orchestration?.tasks.filter((task) => task.status === "completed").length ??
    0;
  const title = sessionDisplayTitle(session.title, session.harness);
  const remoteDevice = session.remoteControlDevice;
  const remoteHardware = remoteDevice?.hostname ||
    [remoteDevice?.manufacturer, remoteDevice?.model].filter(Boolean).join(" ");
  const remoteDeviceLabel = [...new Set([remoteDevice?.name, remoteHardware].filter(Boolean))].join(" · ");
  const remoteControlLabel = remoteDeviceLabel
    ? uiT("Remote control from {device}", { device: remoteDeviceLabel })
    : uiT("Remote control from an unknown device");
  const twoLine = dense && projectLabel !== undefined;
  const pageCount = useSessionPageCount(session.id);
  const gitLabel = session.worktreeRemoved
    ? uiT(NO_BRANCH_LABEL)
    : formatGitLabel(session.repo, session.branch);
  const relativeTime = formatRelative(sessionRecencyAt(session), now);
  const time = relativeTime === "now" ? uiT("now") : relativeTime;
  const model =
    compact && !orchestrationExpanded
      ? null
      : resolveModel(session.harness, session.model).name;
  const waitingLabel =
    waitingFor === "input" ? uiT("Needs input") : uiT("Need approval");
  const statusClass = waitingFor
    ? "text-amber-400"
    : running
      ? "text-accent"
      : failed
        ? "text-destructive"
        : done
          ? "text-sky-500"
          : draft
            ? "text-content/55"
            : "text-content/45";
  const status = (
    <span
      className={`flex shrink-0 items-center gap-1 text-[11px] tabular-nums ${statusClass}`}
    >
      {waitingFor ? (
        <>
          <CircleAlert className="size-3" />
          <span>{waitingLabel}</span>
        </>
      ) : running ? (
        <>
          <TerminalSpinner className="inline-flex size-4 shrink-0 select-none items-center justify-center text-[16px] leading-none text-accent" />
          <span>{uiT("Working...")}</span>
        </>
      ) : failed ? (
        <>
          <span className="size-1.5 rounded-full bg-destructive" />
          <span>{uiT("Failed")}</span>
        </>
      ) : done ? (
        <span>{uiT("Done")}</span>
      ) : draft ? (
        <>
          <CircleDashed className="size-3" />
          <span>{uiT("Draft")}</span>
        </>
      ) : (
        <span>{time}</span>
      )}
    </span>
  );

  const summaryModel = session.model.trim()
    ? resolveModel(session.harness, session.model).name
    : undefined;
  const summaryStatus =
    waitingFor || running || failed || done || draft ? (
      status
    ) : (
      <span className={`shrink-0 text-[11px] ${statusClass}`}>
        {uiT("Idle")}
      </span>
    );
  const denseStatus = waitingFor ? (
    <CircleAlert
      aria-label={waitingLabel}
      className="size-3 shrink-0 text-amber-400"
    />
  ) : running ? (
    <span role="img" aria-label={uiT("Working...")} className="flex shrink-0">
      <TerminalSpinner className="inline-flex size-4 shrink-0 select-none items-center justify-center text-[16px] leading-none text-accent" />
    </span>
  ) : failed ? (
    <span
      role="img"
      aria-label={uiT("Failed")}
      className="size-1.5 shrink-0 rounded-full bg-destructive"
    />
  ) : draft ? (
    <CircleDashed
      aria-label={uiT("Draft")}
      className="size-3 shrink-0 text-content/45"
    />
  ) : null;
  const linkedWorkItem = session.linkedWorkItem;
  const unreadDot = unread ? (
    <span
      role="img"
      aria-label={uiT("Unread reply")}
      title={uiT("Unread reply")}
      className="size-1.5 shrink-0 rounded-full bg-sky-500"
    />
  ) : null;
  const linkedUpdateDot = linkedUpdate ? (
    <span
      title={uiT("Linked {value0} updated since this session", {
        value0: String(linkedWorkItem?.kind === "pr" ? "PR" : "issue"),
      })}
      aria-label={uiT("Linked work item updated")}
      className="size-1.5 shrink-0 rounded-full bg-sky-500"
    />
  ) : null;
  const workItemBadge = linkedWorkItem ? (
    <button
      type="button"
      data-no-drag
      data-tauri-drag-region="false"
      title={uiT(
        "Open {value0} #{value1} beside this session ({value2}-click for GitHub)",
        {
          value0: String(linkedWorkItem.kind === "pr" ? "PR" : "issue"),
          value1: String(linkedWorkItem.number),
          value2: String(MOD),
        },
      )}
      aria-label={uiT("Open {value0} #{value1}", {
        value0: String(linkedWorkItem.kind === "pr" ? "PR" : "issue"),
        value1: String(linkedWorkItem.number),
      })}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey) {
          void openUrl(linkedWorkItem.url).catch(() => undefined);
          return;
        }
        if (onOpenWorkItem) onOpenWorkItem(linkedWorkItem, session.id);
        else void openUrl(linkedWorkItem.url).catch(() => undefined);
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        void openUrl(linkedWorkItem.url).catch(() => undefined);
      }}
      className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-0.5 text-[11px] tabular-nums text-accent hover:underline"
    >
      {linkedWorkItem.kind === "pr" ? (
        <GitPullRequest className="size-3" />
      ) : (
        <CircleDot className="size-3" />
      )}
      <span>#{linkedWorkItem.number}</span>
    </button>
  ) : null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      metadataHover.close();
      onSelect(session.id, e);
      return;
    }
    if (e.key === "F2" && onRename) {
      e.preventDefault();
      onRename(session.id);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && onDelete) {
      e.preventDefault();
      onDelete(session.id);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    metadataHover.close();
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
    // Warm the transcript during the press. Opening stays on click so a
    // drag-to-pane gesture does not switch conversations.
    if (prefetchTimer.current != null) {
      window.clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
    onPrefetch?.(session.id);
    const source = event.currentTarget;
    let feedback: ReturnType<typeof createDragLabel> | undefined;
    const clearPaneDrop = () => {
      feedback?.dispose();
      feedback = undefined;
      setExternalPaneDrop(null);
    };
    const pinDrop =
      onPin && !session.pinned
        ? sidebarPinDrop(source, uiT("Pin"), () => {
            onPin(session.id);
            revealPins?.();
          })
        : undefined;
    const paneDrop: ReorderExternalDrop<string> | undefined = onPlaceOnPane
      ? {
          onMove: (_id, ev) => {
            const over = paneDropFromPoint(ev.clientX, ev.clientY);
            if (!over) {
              clearPaneDrop();
              return false;
            }
            if (over.id !== session.id) {
              feedback ??= createDragLabel(
                uiT("Open in split view"),
                uiT("Open in split view"),
              );
              feedback.move(ev.clientX, ev.clientY, true);
            } else {
              feedback?.dispose();
              feedback = undefined;
            }
            setExternalPaneDrop({
              fromId: session.id,
              overId: over.id,
              edge: over.edge,
            });
            return true;
          },
          onDrop: (_id, ev) => {
            const over = paneDropFromPoint(ev.clientX, ev.clientY);
            if (!over) return false;
            if (over.id !== session.id)
              onPlaceOnPane(session.id, over.id, over.edge);
            return true;
          },
          onEnd: clearPaneDrop,
        }
      : undefined;
    sidebarReorder.onPointerDown(event, combineSidebarDrops(pinDrop, paneDrop));
  };

  useEffect(
    () => () => {
      if (prefetchTimer.current != null) {
        window.clearTimeout(prefetchTimer.current);
        prefetchTimer.current = null;
      }
    },
    [onPrefetch, session.id],
  );

  const schedulePrefetch = () => {
    if (!onPrefetch || prefetchTimer.current != null) return;
    prefetchTimer.current = window.setTimeout(() => {
      prefetchTimer.current = null;
      onPrefetch(session.id);
    }, SESSION_PREFETCH_DELAY_MS);
  };

  const cancelScheduledPrefetch = () => {
    if (prefetchTimer.current == null) return;
    window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = null;
  };

  const archiveLabel = uiT(session.archived ? "Unarchive" : "Archive");
  // Two-line rows show it just before their actions menu.
  const archiveButton = onArchive ? (
    <IconButton
      size="sm"
      data-sidebar-toolbar-action
      data-no-drag
      data-tauri-drag-region="false"
      data-session-archive
      label={`${archiveLabel} ${title}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onArchive(session.id, !session.archived);
      }}
      className="pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
    >
      <Archive />
    </IconButton>
  ) : null;
  // Expanding an orchestration card must not move its existing header. Keep
  // the collapsed top inset and give only the new detail area extra room at
  // the bottom.
  const cardPaddingY = orchestrationExpanded
    ? compact
      ? "pb-2.5 pt-1.5"
      : "pb-2.5 pt-2"
    : compact
      ? "py-1.5"
      : "py-2";

  return (
    <div
      ref={(node) => {
        metadataHover.anchorRef.current = node;
        standaloneReorder.setItemRef(session.id, inheritedReorder ? null : node);
      }}
      className={`group relative ${inheritedReorder ? "" : "reorder-item session-reorder-item"}`}
    >
      <div
        title={dense ? undefined : title}
        data-session-card={session.id}
        data-orchestration-card={orchestration ? "true" : undefined}
        data-session-selected={isSelected ? "true" : undefined}
        data-session-active={isActive ? "true" : undefined}
        data-session-waiting={waitingFor ? "true" : undefined}
        data-density={compact ? "compact" : "comfort"}
        data-session-dense={dense ? "" : undefined}
        data-session-layout={twoLine ? "two-line" : undefined}
        data-session-shortcut={dense && shortcut ? "" : undefined}
        data-tauri-drag-region="false"
        onPointerDown={onPointerDown}
        onPointerEnter={(event) => {
          schedulePrefetch();
          metadataHover.triggerProps.onPointerEnter(event);
        }}
        onPointerLeave={(event) => {
          cancelScheduledPrefetch();
          metadataHover.triggerProps.onPointerLeave(event);
        }}
        onClick={(event) => {
          metadataHover.close();
          if (sidebarReorder.consumeClick()) return;
          onSelect(session.id, event);
        }}
        onContextMenu={
          onContextMenu
            ? (event) => {
                metadataHover.close();
                onContextMenu(session.id, event);
              }
            : undefined
        }
        className={`relative border flex w-full ${sidebarReorder ? "cursor-grab" : "cursor-default"} select-none touch-none rounded-lg text-left ${dense ? `h-8 flex-row items-center gap-1 ${shortcut ? "px-2" : compact ? "pl-[54px] pr-2" : "pl-8 pr-2"}` : `flex-col px-2.5 ${cardPaddingY}`} ${
          isSelected
            ? `bg-accent/15 text-content ${draft ? "border-content/30 border-dashed" : "border-transparent"}`
            : waitingFor
              ? "bg-content/20 text-content border-content/30 border-dashed"
              : isActive
                ? `bg-selection text-content ${draft ? "border-content/30 border-dashed" : "border-transparent"}`
                : draft
                  ? "border-content/25 border-dashed text-content/80 hover:bg-surface-hover hover:text-content"
                  : `text-content/80 hover:text-content border-transparent ${
                      orchestrationExpanded
                        ? "bg-content/5 hover:bg-surface-hover"
                        : "hover:bg-surface-hover"
                    }`
        }`}
      >
        <div
          role="button"
          tabIndex={0}
          aria-current={isActive ? "true" : undefined}
          aria-pressed={isSelected}
          data-session-select={session.id}
          onKeyDown={onKeyDown}
          onFocus={metadataHover.triggerProps.onFocus}
          onBlur={metadataHover.triggerProps.onBlur}
          aria-describedby={
            dense && metadataHover.open ? metadataHover.id : undefined
          }
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            // Shift-click can trigger :focus-visible. Mouse selection should
            // only highlight the card; Tab can still focus this button.
            event.preventDefault();
            // Clear prior focus too, so shortcuts cannot target another card.
            const focused = event.currentTarget.ownerDocument.activeElement;
            if (focused instanceof HTMLElement) focused.blur();
          }}
          className={`rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${dense ? "min-w-0 flex-1" : ""}`}
        >
          {dense || (compact && !orchestrationExpanded) ? null : (
            <span className="relative flex items-center gap-2">
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span data-session-harness-mark className="inline-flex shrink-0">
                  <HarnessIcon
                    harness={session.harness}
                    className="size-3.5 shrink-0"
                  />
                </span>
                <span className="min-w-0 truncate text-[11px] text-foreground-subtle">
                  {model}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {linkedUpdateDot}
                <SessionWorktreeIcon session={session} />
                {status}
              </span>
            </span>
          )}
          <span
            className={`relative flex min-w-0 items-center gap-1.5 ${
              dense || (compact && !orchestrationExpanded) ? "" : "mt-1"
            }`}
          >
            {dense || (compact && !orchestrationExpanded) ? (
              <span
                role="img"
                data-session-avatar
                aria-label={HARNESS_TITLE[session.harness]}
                title={HARNESS_TITLE[session.harness]}
                className="flex shrink-0 items-center"
              >
                <HarnessIcon
                  harness={session.harness}
                  className="size-3.5 shrink-0"
                />
              </span>
            ) : null}
            {session.pinned && !shortcut && !plainTree ? (
              <Pin
                className="size-3 shrink-0 text-content/45"
              />
            ) : null}
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="min-w-0">
                <ParticleText
                  text={title}
                  className={`desktop-sidebar-session-title min-w-0 line-clamp-1 text-ui-caption leading-snug text-content ${dense ? "font-normal" : "font-semibold"}`}
                />
              </span>
            </span>
            {dense || (compact && !orchestrationExpanded) ? (
              <span className="flex shrink-0 items-center gap-1.5">
                {linkedUpdateDot}
                <SessionWorktreeIcon session={session} />
                {dense ? (twoLine ? null : denseStatus) : status}
                {dense && !denseStatus && !twoLine ? (
                  <time
                    data-session-time
                    dateTime={new Date(sessionRecencyAt(session)).toISOString()}
                  >
                    {time}
                  </time>
                ) : null}
              </span>
            ) : null}
            {!dense ? unreadDot : null}
          </span>
          {twoLine ? (
            <span data-session-project title={session.cwd}>
              {pageCount ? (
                // Under the agent icon: how many chats share this page.
                <span
                  data-session-page-count
                  title={uiT("{count} chats on this page", { count: pageCount })}
                  aria-label={uiT("{count} chats on this page", { count: pageCount })}
                >
                  {pageCount}
                </span>
              ) : null}
              {projectLabel}
            </span>
          ) : null}
        </div>
        {orchestrationExpanded ? (
          <OrchestrationSidebarAgents
            leadId={session.id}
            summary={orchestration!}
          />
        ) : null}
        {!compact && !dense ? (
          <SessionWorkflowRunLines sessionId={session.id} isActive={isActive} />
        ) : null}
        <span
          data-session-actions
          className={`relative flex items-center ${dense ? "shrink-0" : "mt-1 gap-2"}`}
        >
          {!dense && gitLabel ? (
            <span
              data-session-preview
              className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-content/45"
              title={
                session.executionCwd
                  ? `${gitLabel}\n${session.executionCwd}`
                  : gitLabel
              }
            >
              <GitBranch className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{gitLabel}</span>
            </span>
          ) : dense ? null : (
            <span className="min-w-0 flex-1" />
          )}
          <span data-session-action-buttons className="relative flex shrink-0 items-center gap-px">
            {archiveButton}
            {twoLine && denseStatus ? (
              <span data-session-trailing-status>{denseStatus}</span>
            ) : null}
            {twoLine && onOpenMenu ? (
              <IconButton
                size="sm"
                data-sidebar-toolbar-action
                data-no-drag
                data-session-menu
                label={uiT("More actions")}
                aria-haspopup="menu"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  metadataHover.close();
                  const anchor = event.currentTarget.getBoundingClientRect();
                  onOpenMenu(session.id, anchor.right, anchor.bottom);
                }}
                className="pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
              >
                <MoreHorizontal />
              </IconButton>
            ) : null}
            {workItemBadge}
            {session.remoteControl ? (
              <span
                data-session-remote-control
                role="img"
                title={remoteControlLabel}
                aria-label={remoteControlLabel}
                className="grid size-5 shrink-0 place-items-center text-content/45"
              >
                <MousePointer2 className="size-3.5" />
              </span>
            ) : null}
            {session.automationId ? (
              <span
                data-automation-icon
                role="img"
                title={uiT("Started by an automation")}
                aria-label={uiT("Started by an automation")}
                className="grid size-5 -mr-1 shrink-0 place-items-center text-amber-400"
              >
                <Zap className="size-3" />
              </span>
            ) : null}
            {orchestration ? (
              <div
                ref={orchestrationTooltipRootRef}
                className="relative shrink-0"
                onMouseEnter={() => setOrchestrationTooltipOpen(true)}
                onMouseLeave={() => setOrchestrationTooltipOpen(false)}
              >
                <button
                  type="button"
                  data-no-drag
                  data-tauri-drag-region="false"
                  data-orchestration-icon
                  aria-label={uiT(
                    "Orchestrator, {value0} {value1}, {value2} done",
                    {
                      value0: String(orchestration.tasks.length),
                      value1: String(
                        orchestration.tasks.length === 1
                          ? "subagent"
                          : "subagents",
                      ),
                      value2: String(orchestrationDone),
                    },
                  )}
                  aria-describedby={
                    orchestrationTooltipOpen
                      ? orchestrationTooltipId
                      : undefined
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onFocus={() => setOrchestrationTooltipOpen(true)}
                  onBlur={() => setOrchestrationTooltipOpen(false)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOrchestrationTooltipOpen(false);
                    onSelect(session.id, event);
                  }}
                  className="grid size-5 shrink-0 place-items-center rounded-lg text-fuchsia-300/65 hover:bg-surface-hover hover:text-fuchsia-200/90"
                >
                  <Share className="size-3" />
                </button>
              </div>
            ) : null}
          </span>
        </span>
        {dense ? unreadDot : null}
      </div>
      <HoverSummary hover={metadataHover} role="tooltip" width={272}>
        <div className="flex items-start gap-2">
          <h3 className="desktop-section-heading min-w-0 flex-1 break-words text-ui-caption font-semibold leading-snug text-content [overflow-wrap:anywhere]">
            {title}
          </h3>
          {summaryStatus}
        </div>
        {session.remoteControl ? (
          <p className="mt-2 flex items-center gap-2 text-content/45">
            <MousePointer2 className="size-3.5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{remoteControlLabel}</span>
          </p>
        ) : null}
        {summaryModel || gitLabel || session.executionCwd || time ? (
          <div className="mt-2 flex flex-col gap-1 border-t border-content/10 pt-2">
            {summaryModel ? (
              <HoverSummaryRow
                icon={
                  <HarnessIcon harness={session.harness} className="size-4" />
                }
                label={uiT("Model")}
              >
                {summaryModel}
              </HoverSummaryRow>
            ) : null}
            {gitLabel ? (
              <HoverSummaryRow
                icon={<GitBranch className="size-4" />}
                label={uiT("Branch")}
              >
                {gitLabel}
              </HoverSummaryRow>
            ) : null}
            {session.executionCwd ? (
              <HoverSummaryRow
                icon={<Folder className="size-4" />}
                label={uiT("Working directory")}
              >
                {session.executionCwd}
              </HoverSummaryRow>
            ) : null}
            {time ? (
              <HoverSummaryRow
                icon={<Clock className="size-4" />}
                label={uiT("Last updated")}
              >
                {time}
              </HoverSummaryRow>
            ) : null}
          </div>
        ) : null}
      </HoverSummary>
      <PresenceBoundary propagate>{orchestration && orchestrationTooltipOpen ? (
        <Popover
          anchor={orchestrationTooltipRootRef}
          side="right"
          align="end"
          width={248}
          maxHeight={320}
          role="tooltip"
          id={orchestrationTooltipId}
          className="pointer-events-none overflow-y-auto p-2.5"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold text-content/85">
              {uiT("Subagents")}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-content/45">
              {orchestrationDone}/{orchestration.tasks.length} {uiT("done")}
            </span>
          </div>
          <div className="mt-1.5 flex flex-col gap-0.5">
            {orchestration.tasks.map((task) => {
              const label = orchestrationTaskLabel(task, orchestration);
              return (
                <div
                  key={task.sessionId}
                  className="flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-1"
                >
                  <HarnessIcon
                    harness={task.harness}
                    className="size-3.5 shrink-0 opacity-75"
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-content/75">
                    {task.title}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] ${
                      task.needsInput ||
                      task.status === "failed" ||
                      task.status === "blocked" ||
                      task.status === "interrupted"
                        ? "text-amber-400"
                        : label === "Working"
                          ? "text-accent"
                          : task.status === "completed"
                            ? "text-emerald-400"
                            : "text-content/45"
                    }`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </Popover>
      ) : null}</PresenceBoundary>
    </div>
  );
});

function formatGitLabel(repo?: string, branch?: string): string {
  if (repo && branch) return `${repo}/${branch}`;
  return branch || repo || "";
}

function formatRelative(value: number, now: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}
