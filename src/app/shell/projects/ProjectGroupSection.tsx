import { IconButton } from "../../../shared/ui/forms/IconButton";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { useSidebarListPreview } from "../useSidebarListPreview";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { type MouseEvent } from "react";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { sidebarDragPreview } from "../SidebarEntryReorder";
import { useTabGroupLogos } from "../../../features/projects/hooks/useTabGroupLogos";
import { pathKey } from "../../../shared/lib/paths";
import { sameProjectPath, type RecentProject } from "../../../features/projects/model/recents";
import {
  projectGroupColor,
  type ProjectGroup,
} from "../../../features/projects/model/projectGroups";
import { ProjectMascot } from "../../../features/projects/ui/ProjectMascot";
import {
  collapsedProjectHeaderSize,
  isBusyPath,
  nameClassName,
  PROJECT_COLLAPSE_DURATION_MS,
  type ProjectTree,
} from "./projectListShared";
import { ProjectCard } from "./ProjectCard";



export function ProjectGroupSection({
  compact,
  group,
  items,
  muteStatuses,
  cwd,
  busy,
  statsEnabled,
  tree,
  onReorder,
  searchActive,
  onSelect,
  onTogglePin,
  onContextMenu,
  onOpenMenu,
  onToggleCollapsed,
  onOpenGroupMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
}: {
  compact: boolean;
  group: ProjectGroup;
  items: RecentProject[];
  muteStatuses: ReadonlyMap<string, string | null>;
  cwd: string;
  busy: Set<string>;
  statsEnabled: boolean;
  tree?: ProjectTree;
  onReorder: (ids: string[]) => void;
  searchActive: boolean;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
  onContextMenu: (path: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (
    path: string,
    x: number,
    y: number,
    trigger?: HTMLElement | null,
  ) => void;
  onToggleCollapsed: () => void;
  onOpenGroupMenu: (x: number, y: number) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
}) {
  const { t: uiT } = useTranslation();
  const expanded =
    compact || !group.collapsed || (searchActive && items.length > 0);
  const preview = useSidebarListPreview(
    items.length,
    String(searchActive),
    searchActive,
    { indented: false, expanded },
  );
  const sortable = useAnimatedReorder(
    items.slice(0, preview.count).map((item) => item.path),
    onReorder,
    "y",
    undefined,
    {
      activationDistance: 3,
      floatingPreview: sidebarDragPreview,
      collapsedSize: tree ? collapsedProjectHeaderSize : undefined,
    },
  );
  const countLabel = uiT(
    items.length === 1 ? "{count} project" : "{count} projects",
    { count: items.length },
  );
  const openMenu = (target: HTMLElement, x?: number, y?: number) => {
    const rect = target.getBoundingClientRect();
    onOpenGroupMenu(x ?? rect.left, y ?? rect.bottom);
  };

  return (
    <div
      className={`shrink-0 overflow-hidden rounded-lg ${
        tree
          ? `mb-1 last:mb-0 ${expanded ? "bg-content/5" : ""}`
          : expanded && !compact
            ? "mb-1.5 bg-content/5"
            : ""
      }`}
      data-project-group={group.id}
      role="group"
      aria-label={group.name}
    >
      {compact ? null : (
        <div
          data-project-group-header={group.id}
          className="project-reorder-item group relative flex h-8 items-stretch rounded-lg px-2 opacity-65 cursor-default"
          onContextMenu={(event) => {
            event.preventDefault();
            event.currentTarget
              .querySelector<HTMLButtonElement>("button")
              ?.focus();
            openMenu(event.currentTarget, event.clientX, event.clientY);
          }}
        >
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${group.name}, ${countLabel}`}
            title={`${group.name} · ${countLabel}`}
            onClick={searchActive ? undefined : onToggleCollapsed}
            className="flex min-w-0 flex-1 cursor-default items-center gap-2 text-left transition-[padding] duration-150 motion-reduce:transition-none group-hover:pr-6 group-has-[:focus-visible]:pr-6"
          >
            <div className="grid size-4 shrink-0 place-items-center">
              {!expanded ? (
                <span
                  data-group-mascot
                  className="grid size-4 place-items-center group-hover:hidden group-has-[:focus-visible]:hidden"
                >
                  <ProjectMascot
                    project={group.id}
                    color={projectGroupColor(group)}
                    name={group.mascot ?? null}
                    className="size-3"
                  />
                </span>
              ) : null}
              <DisclosureChevron
                expanded={expanded}
                data-group-chevron
                className={`project-tree-chevron size-3.5 ${expanded ? "" : "hidden group-hover:block group-has-[:focus-visible]:block"}`}
              />
            </div>
            <span className={nameClassName}>{group.name}</span>
          </button>
          <IconButton
            size="sm"
            shape="square"
            data-sidebar-toolbar-action
            data-sidebar-row-action
            data-no-drag
            title={uiT("Group options")}
            data-menu-trigger="sidebar"
            label={uiT("{value0} group options", {
              value0: String(group.name),
            })}
            aria-haspopup="menu"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openMenu(event.currentTarget);
            }}
            className="absolute top-1/2 -translate-y-1/2"
          >
            <MoreHorizontal />
          </IconButton>
        </div>
      )}
      <AnimatedCollapse
        keepMounted
        expanded={expanded}
        motion={tree ? "height" : undefined}
        className={tree ? "project-tree-collapse" : undefined}
        durationMs={tree ? PROJECT_COLLAPSE_DURATION_MS : undefined}
      >
        <div
          data-project-group-items
          className={
            compact
              ? "flex flex-col items-center gap-1"
              : `flex flex-col gap-px ${tree ? "px-1 py-px" : "p-1"}`
          }
        >
          {items.slice(0, preview.mountedCount).map((item, index) => (
            <AnimatedCollapse key={item.path} expanded={index < preview.count}>
              <ProjectCard
                compact={compact}
                key={item.path}
                item={item}
                muteStatus={muteStatuses.get(pathKey(item.path)) ?? undefined}
                selected={
                  (!searchActive || !!tree) && sameProjectPath(item.path, cwd)
                }
                busy={isBusyPath(item.path, busy)}
                statsEnabled={
                  statsEnabled && (!tree || sameProjectPath(item.path, cwd))
                }
                tree={tree}
                pinned={false}
                sortable={sortable}
                onSelect={onSelect}
                onTogglePin={onTogglePin}
                onContextMenu={onContextMenu}
                onOpenMenu={onOpenMenu}
                groupLabels={groupLabels}
                groupColors={groupColors}
                groupCustomColors={groupCustomColors}
                groupLogos={groupLogos}
                groupMascots={groupMascots}
              />
            </AnimatedCollapse>
          ))}
          {preview.button}
        </div>
      </AnimatedCollapse>
    </div>
  );
}
