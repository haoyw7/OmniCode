import { cn } from "../../../shared/lib/cn";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { motion } from "motion/react";
import type { SortableItemState } from "../../../shared/ui/primitives/Sortable";
import { HoverSummary, HoverSummaryRow, useHoverSummary } from "../../../shared/ui/HoverSummary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  BellOff,
  FolderOpen,
  Internet,
  MessageSquare,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Settings,
} from "../../../shared/ui/icons";
import { useContext, useEffect, useLayoutEffect, type MouseEvent } from "react";
import { useProjectDiffStats } from "../../../features/source-control/hooks/useProjectDiffStats";
import { useTabGroupLogos } from "../../../features/projects/hooks/useTabGroupLogos";
import { basename, type GitDiffStats } from "../../../platform/tauri/fs";
import { formatInteger } from "../../../shared/lib/numbers";
import { pathKey, projectKey } from "../../../shared/lib/paths";
import {
  loadPinnedProjects,
  sameProjectPath,
  savePinnedProjects,
  type RecentProject,
} from "../../../features/projects/model/recents";
import { resolveTabGroupLabel } from "../../../features/workspace/model/tabGroups";
import { TerminalSpinner } from "../../../features/sessions/ui/TerminalSpinner";
import {
  useRemoteMachineOnline,
  useRemoteMachines,
} from "../../../features/connections/model/connections";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { ProjectAvatar } from "../ProjectAvatar";
import { SidebarProjectGroupContext } from "../projectGroupDrop";
import { InsidePinnedSectionContext, SidebarPinDropContext } from "../sidebarPinDrop";
import {
  nameClassName,
  PROJECT_COLLAPSE_DURATION_MS,
  ProjectSummaryContext,
  type ProjectTree,
} from "./projectListShared";



export function ProjectCard({
  compact,
  item,
  muteStatus,
  selected,
  busy,
  statsEnabled,
  tree,
  pinned,
  sortable,
  onSelect,
  onTogglePin,
  onContextMenu,
  onOpenMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
}: {
  compact: boolean;
  item: RecentProject;
  muteStatus?: string;
  selected: boolean;
  busy: boolean;
  statsEnabled: boolean;
  tree?: ProjectTree;
  pinned: boolean;
  sortable?: SortableItemState;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
  onContextMenu: (path: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (
    path: string,
    x: number,
    y: number,
    trigger?: HTMLElement | null,
  ) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
}) {
  const { t: uiT } = useTranslation();
  const revealPins = useContext(SidebarPinDropContext);
  const insidePins = useContext(InsidePinnedSectionContext);
  const groupId = useContext(SidebarProjectGroupContext);
  const hoverSummary = useContext(ProjectSummaryContext);
  const hover = useHoverSummary<HTMLButtonElement>({
    enabled: !hoverSummary.disabled && !sortable?.sorting,
    interactive: true,
    // A clicked project keeps focus; the card must still leave with the pointer.
    focusRetains: false,
    onOpen: () => hoverSummary.onOpen?.(item.path),
  });
  const nameButtonRef = hover.anchorRef;
  const summary = hoverSummary.summaries?.get(pathKey(item.path));
  const fallbackName = basename(item.path);
  const key = projectKey(item.path);
  const name = resolveTabGroupLabel(key, groupLabels, fallbackName);
  useLayoutEffect(() => sortable?.setPayload({
    type: "sidebar-project", path: item.path, pinned, insidePins, groupId,
    onPin: compact ? undefined : () => {
      const pins = loadPinnedProjects();
      if (!pins.some(path => sameProjectPath(path, item.path))) savePinnedProjects([...pins, item.path]);
      revealPins?.();
    },
  }, () => <span className="flex items-center gap-1.5"><FolderOpen className="size-4" /><span className="truncate">{name}</span></span>),
  [sortable?.setPayload, item.path, pinned, insidePins, groupId, compact, revealPins, name]);
  const diffEnabled = statsEnabled && Boolean(item.path) && item.path !== "~";
  const stats = useProjectDiffStats(item.path, diffEnabled);
  const files = stats?.files ?? 0;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  const hasChanges = files > 0 || additions > 0 || deletions > 0;
  const hostProject = remoteProjectFor(item.path);
  const remote = hostProject?.local ? undefined : hostProject;
  const { machines } = useRemoteMachines(!!remote);
  const machine = remote
    ? machines.find((entry) => entry.environmentId === remote.environmentId)
    : undefined;
  const online = useRemoteMachineOnline(machine?.id);
  const disconnected = !!remote && (!machine || online === false);
  const connection = !remote
    ? ""
    : !machine
      ? uiT("Machine not connected on this computer")
      : online === undefined
        ? uiT("Connecting")
        : online
          ? uiT("Connected")
          : uiT("Reconnecting");
  const cardAriaLabel = projectCardAriaLabel(
    machine
      ? uiT("{project} on {machine}", { project: name, machine: machine.name })
      : name,
    stats,
    busy,
    uiT,
  );
  const labelClassName = (
    machine
      ? "min-w-0 max-w-[75%] shrink-0 truncate text-ui-base font-medium leading-tight"
      : nameClassName
  ).replace("font-medium", tree ? "font-normal" : "font-medium") + " project-name";
  const treeAvatar = tree ? (
    <ProjectAvatar
      path={item.path}
      busy={busy}
      colors={groupColors}
      customColors={groupCustomColors}
      logos={groupLogos}
      mascots={groupMascots}
      className="size-4"
    />
  ) : null;
  const expandable = tree?.canExpandProject?.(item.path) !== false;
  const expanded =
    expandable && (tree?.expandedPaths.has(pathKey(item.path)) ?? false);
  const needsApproval = tree?.needsApproval.has(pathKey(item.path)) ?? false;
  useEffect(() => {
    if (!expanded && tree?.pendingActivation.current === pathKey(item.path))
      tree.pendingActivation.current = undefined;
  }, [expanded, item.path, tree?.pendingActivation]);

  const header = (
    <motion.div
      {...(tree ? undefined : sortable?.motionProps)}
      ref={tree ? undefined : sortable?.ref}
      style={tree ? undefined : sortable?.style}
      data-selected={selected || undefined}
      data-project-header={tree ? "" : undefined}
      className={`${tree ? "project-tree-header" : ""} group relative flex touch-none items-stretch rounded-lg ${compact ? "size-8" : "px-2 h-8"} ${
        tree
          ? selected
            ? "text-content hover:bg-surface-hover"
            : "text-content/80 hover:bg-surface-hover hover:text-content"
          : selected
            ? "bg-selection-strong text-content"
            : "opacity-65"
      } cursor-grab`}
      onPointerEnter={hover.triggerProps.onPointerEnter}
      onPointerLeave={hover.triggerProps.onPointerLeave}
      onPointerDown={(event) => {
        hover.triggerProps.onPointerDown();
        if (event.button !== 0) return;
        hover.close();
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        sortable?.handleProps.onPointerDown?.(event);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        if (sortable?.consumeClick()) return;
        hover.close();
        if (
          !expanded &&
          expandable &&
          tree?.onActivateProject &&
          tree.onToggleProject
        ) {
          // Workspace/editor initialization must not block the disclosure frames.
          tree.pendingActivation.current = pathKey(item.path);
          tree.onToggleProject(item.path);
        } else {
          if (tree?.pendingActivation.current === pathKey(item.path))
            tree.pendingActivation.current = undefined;
          onSelect(item.path);
        }
      }}
      onContextMenu={(event) => onContextMenu(item.path, event)}
      onKeyDown={(event) => {
        if (
          event.key !== "ContextMenu" &&
          !(event.shiftKey && event.key === "F10")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpenMenu(item.path, rect.left, rect.bottom);
      }}
    >
      {tree && expandable ? (
        // Like project groups, the avatar slot doubles as the disclosure so
        // session rows can indent to the project name.
        <button
          type="button"
          data-no-drag
          aria-label={uiT(expanded ? "Collapse project" : "Expand project")}
          aria-expanded={expanded}
          title={uiT(expanded ? "Collapse project" : "Expand project")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (tree.pendingActivation.current === pathKey(item.path))
              tree.pendingActivation.current = undefined;
            tree.onToggleProject?.(item.path);
          }}
          data-project-tile
          className="active:opacity-70 grid w-4 shrink-0 place-items-center rounded-sm text-content/55 outline-none hover:text-content"
        >
          <span
            data-project-avatar
            className="project-card-logo col-start-1 row-start-1 grid size-4 place-items-center group-hover:invisible group-has-[:focus-visible]:invisible"
          >
            {treeAvatar}
          </span>
          <DisclosureChevron
            expanded={expanded}
            data-project-chevron
            className="project-tree-chevron invisible col-start-1 row-start-1 size-3.5 group-hover:visible group-has-[:focus-visible]:visible"
          />
        </button>
      ) : tree ? (
        <span
          data-project-avatar
          data-project-tile
          className="project-card-logo grid w-4 shrink-0 place-items-center"
        >
          {treeAvatar}
        </span>
      ) : null}
      <button
        {...sortable?.handleProps}
        onPointerDown={undefined}
        ref={(node) => { nameButtonRef.current = node; sortable?.handleProps.ref(node); }}
        type="button"
        data-project-select={pathKey(item.path)}
        aria-label={
          muteStatus ? `${cardAriaLabel}, ${muteStatus}` : cardAriaLabel
        }
        aria-description={remote?.cwd ?? item.path}
        aria-current={selected ? "true" : undefined}
        aria-expanded={tree && expandable ? expanded : undefined}
        aria-haspopup="dialog"
        aria-describedby={[sortable?.handleProps["aria-describedby"], hover.open ? hover.id : undefined].filter(Boolean).join(" ") || undefined}
        onFocus={() => {
          if (hoverSummary.restoringPinFocusPath?.current === item.path) return;
          hover.triggerProps.onFocus();
        }}
        onBlur={hover.triggerProps.onBlur}
        onKeyDown={(event) => { sortable?.handleProps.onKeyDown?.(event); if (!event.defaultPrevented) hover.triggerProps.onKeyDown(event); }}
        className={
          cn("hover:opacity-80 active:opacity-70", compact
            ? "relative grid size-8 cursor-grab place-items-center"
            : `flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left ${tree ? "pl-2 pr-14" : "pr-6"}`)
        }
      >
        {compact ? (
          <ProjectAvatar
            path={item.path}
            busy={busy}
            colors={groupColors}
            customColors={groupCustomColors}
            logos={groupLogos}
            mascots={groupMascots}
          />
        ) : (
          <>
            {tree ? null : (
              <div className="project-card-logo grid size-4 shrink-0 place-items-center transition-opacity group-hover:opacity-0">
                <ProjectAvatar
                  path={item.path}
                  busy={busy}
                  colors={groupColors}
                  customColors={groupCustomColors}
                  logos={groupLogos}
                  mascots={groupMascots}
                  className="size-4"
                />
              </div>
            )}
            <span className={labelClassName}>{name}</span>
            {machine ? (
              <span
                data-project-machine
                className="min-w-0 flex-1 truncate text-[11px] leading-tight text-content/45"
              >
                {machine.name}
              </span>
            ) : null}
            {hasChanges ? (
              <span className="project-card-stats shrink-0 group-hover:invisible group-has-[:focus-visible]:invisible">
                <ProjectDiffStat additions={additions} deletions={deletions} />
              </span>
            ) : null}
            {needsApproval ? (
              <span
                role="img"
                aria-label={uiT("Needs approval")}
                title={uiT("Needs approval")}
                className="size-1.5 shrink-0 rounded-full bg-warning"
              />
            ) : busy ? (
              <span role="img" aria-label={uiT("Working...")}>
                <TerminalSpinner className="inline-block w-3 shrink-0 select-none text-center text-ui-sm leading-none text-brand" />
              </span>
            ) : summary?.historyState === "error" && !disconnected ? (
              <span
                role="img"
                aria-label={uiT("Couldn’t load sessions")}
                className="size-1.5 shrink-0 rounded-full bg-destructive"
              />
            ) : summary && summary.unread > 0 ? (
              <span
                role="img"
                aria-label={uiT("Unread")}
                className="size-1.5 shrink-0 rounded-full bg-accent"
              />
            ) : null}
          </>
        )}
        {remote ? (
          <span
            role="img"
            aria-label={connection}
            className={
              compact
                ? "absolute right-0 bottom-0 grid size-3 place-items-center text-content/60"
                : "relative grid size-4 shrink-0 place-items-center text-content/45"
            }
          >
            <Internet
              className="size-3"
              aria-hidden="true"
            />
            <span
              aria-hidden="true"
              className={`absolute right-0 bottom-0 size-1.5 rounded-full ring-1 ring-background-base ${
                online
                  ? "bg-success"
                  : disconnected
                    ? "bg-destructive"
                    : "bg-content/35"
              }`}
            />
          </span>
        ) : null}
        {hostProject?.machine?.kind === "wsl" && !compact ? (
          <span className="text-ui-xs text-content/50" title={hostProject.machine.distribution}>WSL</span>
        ) : null}
        {muteStatus ? (
          <span
            role="img"
            aria-label={muteStatus}
            title={muteStatus}
            className={
              compact
                ? "absolute right-0 top-0 grid size-3 place-items-center text-warning"
                : "grid size-4 shrink-0 place-items-center text-warning"
            }
          >
            <BellOff
              className="size-3.5"
              aria-hidden="true"
            />
          </span>
        ) : null}
      </button>
      {compact ? null : (
        <>
          {tree?.onNewInProject ? (
            <IconButton
              size="sm"
              shape="square"
              data-sidebar-toolbar-action
              data-sidebar-row-action="secondary"
              data-no-drag
              label={uiT("New session in {project}", { project: name })}
              title={uiT("New session in {project}", { project: name })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                tree.onNewInProject?.(item.path);
              }}
              className="absolute top-1/2 -translate-y-1/2"
            >
              <Plus />
            </IconButton>
          ) : null}
          <IconButton
            size="sm"
            shape="square"
            data-sidebar-toolbar-action
            data-sidebar-row-action
            data-no-drag
            title={uiT("Project options")}
            data-menu-trigger="sidebar"
            label={uiT("Project options")}
            aria-haspopup="menu"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenMenu(
                item.path,
                event.detail === 0 ? rect.left : event.clientX,
                event.detail === 0 ? rect.bottom : event.clientY,
              );
            }}
            className="absolute top-1/2 -translate-y-1/2"
          >
            <MoreHorizontal />
          </IconButton>
          {tree ? null : (
            <button
              type="button"
              data-no-drag
              title={pinned ? uiT("Unpin project") : uiT("Pin project")}
              aria-label={pinned ? uiT("Unpin project") : uiT("Pin project")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin(item.path);
              }}
              className="active:opacity-70 absolute left-2 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-content/55 opacity-0 pointer-events-none transition-opacity hover:text-content group-hover:pointer-events-auto group-hover:opacity-100"
            >
              {pinned ? (
                <PinOff className="size-3.5" />
              ) : (
                <Pin className="size-3.5" />
              )}
            </button>
          )}
        </>
      )}
      <HoverSummary
        hover={hover}
        role="dialog"
        label={uiT("Project summary for {project}", { project: name })}
        width={272}
        data-project-summary={pathKey(item.path)}
      >
        <div className="flex min-w-0 items-start gap-2 text-content">
          <ProjectAvatar
            path={item.path}
            busy={busy}
            colors={groupColors}
            customColors={groupCustomColors}
            logos={groupLogos}
            mascots={groupMascots}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="min-w-0 flex-1 text-ui-caption font-medium leading-relaxed [overflow-wrap:anywhere]">
            {name}
          </span>
          <button
            type="button"
            data-no-drag
            aria-label={uiT(pinned ? "Unpin project" : "Pin project")}
            aria-pressed={pinned}
            onClick={() => {
              hover.close();
              if (hoverSummary.onPin) hoverSummary.onPin(item.path);
              else onTogglePin(item.path);
            }}
            className="active:opacity-70 grid size-6 shrink-0 place-items-center rounded-lg text-content/45 hover:bg-surface-hover hover:text-content"
          >
            {pinned ? (
              <PinOff className="size-3.5" />
            ) : (
              <Pin className="size-3.5" />
            )}
          </button>
        </div>
        {summary ? (
          <>
            <div className="mt-2 flex min-w-0 items-start gap-2 text-content/65">
              <MessageSquare
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 text-content/45"
              />
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums">
                <span>
                  {uiT(
                    summary.total === 1
                      ? "{count} session"
                      : "{count} sessions",
                    {
                      count:
                        summary.total === undefined
                          ? "—"
                          : formatInteger(summary.total),
                    },
                  )}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {uiT("{count} unread", {
                    count: formatInteger(summary.unread),
                  })}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {uiT("{count} opened", {
                    count: formatInteger(summary.opened),
                  })}
                </span>
              </div>
            </div>
            {summary.historyState === "idle" ||
            summary.historyState === "loading" ? (
              <p role="status" className="mt-1.5 text-[11px] text-content/45">
                {uiT("Loading project summary…")}
              </p>
            ) : summary.historyState === "error" ? (
              <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px]">
                <p role="status" className="min-w-0 flex-1 text-foreground-subtle">
                  {uiT("Project summary unavailable")}
                </p>
                {hoverSummary.onOpen && summary.canRetry !== false ? (
                  <button
                    type="button"
                    aria-label={uiT("Retry")}
                    onClick={() => hoverSummary.onOpen?.(item.path)}
                    className="active:opacity-70 shrink-0 rounded-lg px-1.5 py-0.5 text-content/65 hover:bg-surface-hover hover:text-content"
                  >
                    {uiT("Retry")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {summary.cached ? (
              <p className="mt-1 text-[11px] text-content/45">
                {uiT("Showing cached summary")}
              </p>
            ) : null}
          </>
        ) : null}
        <div className="mt-2 space-y-1 border-t border-content/10 pt-2">
          <HoverSummaryRow icon={<FolderOpen />} label={uiT("Project path")}>
            {remote?.cwd ?? item.path}
          </HoverSummaryRow>
          {remote ? (
            <HoverSummaryRow icon={<Internet />} label={uiT("Machine")}>
              <span>{machine?.name ?? uiT("another machine")}</span>
              <span className="block text-[11px] text-content/45">
                {connection}
              </span>
            </HoverSummaryRow>
          ) : null}
          {muteStatus ? (
            <HoverSummaryRow icon={<BellOff />} label={uiT("Notifications")}>
              {muteStatus}
            </HoverSummaryRow>
          ) : null}
        </div>
        <div className="mt-2 border-t border-content/10 pt-1">
          <button
            type="button"
            data-no-drag
            aria-label={uiT("Edit project")}
            onClick={() => {
              const trigger = nameButtonRef.current;
              if (!trigger) return;
              const rect = trigger.getBoundingClientRect();
              hover.close();
              onOpenMenu(item.path, rect.left, rect.bottom, trigger);
            }}
            className="active:opacity-70 -mx-1 flex w-[calc(100%+8px)] items-center gap-2 rounded-lg px-1 py-1 text-left text-content/75 hover:bg-surface-hover hover:text-content"
          >
            <Settings className="size-3.5 text-content/45" aria-hidden="true" />
            {uiT("Edit project")}
          </button>
        </div>
      </HoverSummary>
    </motion.div>
  );
  return tree ? (
    <motion.div
      {...sortable?.motionProps}
      ref={sortable?.ref}
      style={sortable?.style}
      data-project-path={pathKey(item.path)}
      data-reordering={sortable?.sorting || undefined}
      data-dragging={sortable?.dragging || undefined}
      className="relative shrink-0"
    >
      {header}
      <AnimatedCollapse
        keepMounted
        expanded={expanded}
        motion="height"
        className="project-tree-collapse"
        durationMs={PROJECT_COLLAPSE_DURATION_MS}
        animateContentResize
        onEntered={() => {
          if (tree.pendingActivation.current !== pathKey(item.path)) return;
          tree.pendingActivation.current = undefined;
          tree.onActivateProject?.(item.path);
        }}
      >
        {() => (
          <div data-project-children={pathKey(item.path)}>
            {tree.renderProjectChildren?.(item.path)}
          </div>
        )}
      </AnimatedCollapse>
    </motion.div>
  ) : (
    header
  );
}

function ProjectDiffStat({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  const { t: uiT } = useTranslation();
  if (additions <= 0 && deletions <= 0) return null;

  const label = [
    additions > 0 ? `+${formatInteger(additions)}` : "",
    deletions > 0 ? `-${formatInteger(deletions)}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      title={uiT("{value0} uncommitted", { value0: String(label) })}
      className="flex shrink-0 items-center gap-1 font-sans text-[11px] font-semibold tabular-nums"
    >
      {additions > 0 ? (
        <span className="text-success">+{formatInteger(additions)}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-danger">-{formatInteger(deletions)}</span>
      ) : null}
    </span>
  );
}

function projectCardAriaLabel(
  name: string,
  stats: GitDiffStats | null,
  busy: boolean,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const parts = [name];
  if (busy) parts.push(t("working"));
  const files = stats?.files ?? 0;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  if (files > 0) {
    parts.push(
      t(files === 1 ? "{count} file changed" : "{count} files changed", {
        count: files,
      }),
    );
  }
  if (additions > 0) parts.push(`+${formatInteger(additions)}`);
  if (deletions > 0) parts.push(`-${formatInteger(deletions)}`);
  return parts.join(", ");
}
