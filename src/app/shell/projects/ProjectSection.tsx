import { useSidebarListPreview } from "../useSidebarListPreview";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useContext, useId, type MouseEvent } from "react";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { orderByIds } from "../../../shared/lib/reorder";
import { orderSidebarPins } from "../../model/sidebarPinnedOrder";
import { sidebarDragPreview } from "../SidebarEntryReorder";
import { useTabGroupLogos } from "../../../features/projects/hooks/useTabGroupLogos";
import { pathKey } from "../../../shared/lib/paths";
import { sameProjectPath, type RecentProject } from "../../../features/projects/model/recents";
import {
  collapsedProjectHeaderSize,
  isBusyPath,
  PROJECT_COLLAPSE_DURATION_MS,
  type ProjectListEntry,
  type ProjectTree,
  SidebarSectionReorderContext,
} from "./projectListShared";
import { ProjectSectionHeader } from "./ProjectSectionHeader";
import { SidebarEntry } from "./SidebarEntry";
import { ProjectCard } from "./ProjectCard";



export function ProjectSection({
  sectionId,
  compact,
  hideHeader = false,
  label,
  expanded,
  onToggleExpanded,
  items,
  leadingEntries = [],
  itemOrder,
  muteStatuses,
  emptyLabel,
  onAdd,
  cwd,
  busy,
  statsEnabled,
  tree,
  onReorder,
  pinned,
  searchActive,
  previewAll,
  previewKey,
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
  sectionId?: "remote-control";
  compact: boolean;
  hideHeader?: boolean;
  label: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  items: RecentProject[];
  leadingEntries?: ProjectListEntry[];
  itemOrder?: string[];
  muteStatuses: ReadonlyMap<string, string | null>;
  emptyLabel?: string;
  onAdd?: () => void;
  cwd: string;
  busy: Set<string>;
  statsEnabled: boolean;
  tree?: ProjectTree;
  onReorder: (ids: string[]) => void;
  pinned: boolean;
  searchActive: boolean;
  previewAll: boolean;
  previewKey: string;
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
  const contentId = useId();
  const sectionReorder = useContext(SidebarSectionReorderContext);
  const sectionDragging =
    !!sectionReorder &&
    sectionReorder.sortable.draggingId === sectionReorder.id;
  const preview = useSidebarListPreview(
    items.length + leadingEntries.length,
    `${previewAll}\0${previewKey}`,
    previewAll,
    {
      indented: leadingEntries.length > 0,
      expanded: compact || hideHeader || expanded,
    },
  );
  const rows = (pinned ? orderSidebarPins : orderByIds)<{
    id: string;
    entry?: ProjectListEntry;
    project?: RecentProject;
  }>(
    [
      ...leadingEntries.map((entry) => ({ id: `session:${entry.id}`, entry })),
      ...items.map((project) => ({ id: project.path, project })),
    ],
    itemOrder ?? [],
  );
  const sortable = useAnimatedReorder(
    rows
      .slice(0, preview.count)
      .filter((row) => pinned || row.project)
      .map((row) => row.id),
    onReorder,
    "y",
    undefined,
    {
      activationDistance: 3,
      floatingPreview: sidebarDragPreview,
      collapsedSize: tree ? collapsedProjectHeaderSize : undefined,
    },
  );
  return (
    <div
      className={compact ? "shrink-0" : `shrink-0 ${tree ? "mb-1" : "mb-2"}`}
      data-project-section={sectionId ?? (pinned ? "pinned" : "projects")}
    >
      {compact || hideHeader ? null : (
        <ProjectSectionHeader
          label={label}
          onAdd={onAdd}
          expanded={expanded}
          contentId={contentId}
          onToggleExpanded={onToggleExpanded}
        />
      )}
      <AnimatedCollapse
        keepMounted
        expanded={(compact || hideHeader || expanded) && !sectionDragging}
        motion="height"
        className="project-tree-collapse"
        durationMs={PROJECT_COLLAPSE_DURATION_MS}
      >
        <div id={contentId}>
          {items.length === 0 && leadingEntries.length === 0 && emptyLabel ? (
            <p className="px-4 pb-1 text-[11px] leading-tight text-content/40">
              {uiT(emptyLabel)}
            </p>
          ) : null}
          <div
            data-project-rows
            className={
              compact
                ? "flex flex-col items-center gap-1"
                : "flex flex-col gap-px px-2"
            }
          >
            {rows
              .slice(0, preview.mountedCount)
              .map(({ id, entry, project: item }, index) => (
                <AnimatedCollapse key={id} expanded={index < preview.count}>
                  {() => {
                    if (entry)
                      return (
                        <SidebarEntry
                          entry={entry}
                          id={id}
                          sortable={pinned ? sortable : undefined}
                        />
                      );
                    if (!item) return null;
                    return (
                      <ProjectCard
                        compact={compact}
                        key={item.path}
                        item={item}
                        muteStatus={
                          muteStatuses.get(pathKey(item.path)) ?? undefined
                        }
                        selected={
                          (!searchActive || !!tree) &&
                          sameProjectPath(item.path, cwd)
                        }
                        busy={isBusyPath(item.path, busy)}
                        statsEnabled={
                          statsEnabled &&
                          (!tree || sameProjectPath(item.path, cwd))
                        }
                        tree={tree}
                        pinned={pinned}
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
                    );
                  }}
                </AnimatedCollapse>
              ))}
            {preview.button}
          </div>
        </div>
      </AnimatedCollapse>
    </div>
  );
}
