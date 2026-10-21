import { usePreferenceState } from "../../features/settings/model/usePreferenceState";
import { AnimatedCollapse } from "../../shared/ui/AnimatedCollapse";
import type { ProjectHoverSummary } from "../model/projectHoverSummary";
import { useTranslation } from "../../shared/i18n/useTranslation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import { motion } from "motion/react";
import { ListMotion } from "../../shared/ui/ListMotion";
import { SortableItem, SortableList } from "../../shared/ui/primitives/Sortable";
import {
  loadSidebarPinnedOrder,
  reorderSidebarPins,
  saveSidebarPinnedOrder,
  subscribeSidebarPinnedOrder,
} from "../model/sidebarPinnedOrder";
import { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { basename } from "../../platform/tauri/fs";
import { pathKey, projectKey } from "../../shared/lib/paths";
import {
  collectRailProjects,
  loadPinnedProjects,
  loadProjectRailOrder,
  projectRailSections,
  saveProjectRailOrder,
  subscribeProjectPathsChanged,
  syncProjectRailOrder,
  toggleProjectPin,
  type RecentProject,
} from "../../features/projects/model/recents";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupLabel,
} from "../../features/workspace/model/tabGroups";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  projectGroupIdForPath,
  updateProjectGroup,
} from "../../features/projects/model/projectGroups";
import { notificationMuteStatus } from "../../features/notifications/ui/notificationMuteActions";
import { useProjectNotificationPreferences } from "../../features/notifications/hooks/useProjectNotificationPreferences";
import { useNotificationProjects } from "../../features/notifications/hooks/useNotificationProjects";
import { useProjectMenu } from "./useProjectMenu";
import {
  loadSidebarSectionsCollapsed,
  saveSidebarSectionsCollapsed,
  subscribeSidebarSectionsCollapsed,
  type SidebarSectionId,
} from "../../features/settings/model/sidebarSections";
import {
  DEFAULT_SIDEBAR_SECTION_ORDER,
  loadSidebarSectionOrder,
  reorderSidebarSections,
  saveSidebarSectionOrder,
  subscribeSidebarSectionOrder,
  type SidebarOrderedSectionId,
} from "../../features/settings/model/sidebarSectionOrder";
import { SidebarPinDropContext } from "./sidebarPinDrop";
import { PROJECT_COLLAPSE_DURATION_MS, type ProjectListEntry, ProjectSummaryContext, SidebarSectionReorderContext } from "./projects/projectListShared";
import { ProjectSection } from "./projects/ProjectSection";
import { ChatProjectCard } from "./projects/ChatProjectCard";
import { ProjectSectionHeader } from "./projects/ProjectSectionHeader";
import { ProjectGroupSection } from "./projects/ProjectGroupSection";

export type ProjectListProps = {
  cwd: string;
  recents: RecentProject[];
  busyPaths?: Iterable<string>;
  compact?: boolean;
  active?: boolean;
  query?: string;
  onSelectProject: (path: string) => void;
  onOpenProject: () => void;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  expandedPaths?: ReadonlySet<string>;
  onToggleProject?: (path: string) => void;
  /** Activate the workspace after a name-triggered disclosure finishes. */
  onActivateProject?: (path: string) => void;
  canExpandProject?: (path: string) => boolean;
  renderProjectChildren?: (path: string) => ReactNode;
  onNewInProject?: (path: string) => void;
  needsApprovalPaths?: Iterable<string>;
  statsEnabled?: boolean;
  scrollable?: boolean;
  scrollRef?: Ref<HTMLDivElement>;
  /** Navigation or other content sharing the project list's scroll container. */
  leadingContent?: ReactNode;
  matchedProjectPaths?: ReadonlySet<string>;
  visibleProjectPaths?: ReadonlySet<string>;
  showProjectSections?: boolean;
  searchActive?: boolean;
  /** Lists every row instead of the paged preview; defaults to `searchActive`. */
  previewAll?: boolean;
  /** Restarts the paged preview when the listed scope changes. */
  previewKey?: string;
  /** Full project counts, independent of the current sidebar filter/preview. */
  projectSummaries?: ReadonlyMap<string, ProjectHoverSummary>;
  pinnedEntries?: ProjectListEntry[];
  /** Projectless chats, listed under a "Chats" row above workflows and projects. */
  chatEntries?: ProjectListEntry[];
  /** Starts a projectless chat from the Chats row. */
  onNewChat?: () => void;
  /** Content of the collapsible Workflows section; absent hides it. */
  workflowsSection?: ReactNode;
  onProjectHoverOpen?: (path: string) => void;
};

export function ProjectList({
  cwd,
  recents,
  busyPaths,
  compact = false,
  active = true,
  query = "",
  onSelectProject,
  onOpenProject,
  onRemoveProject,
  onOpenNotificationSettings,
  expandedPaths,
  onToggleProject,
  onActivateProject,
  canExpandProject,
  renderProjectChildren,
  onNewInProject,
  needsApprovalPaths,
  statsEnabled,
  scrollable = true,
  scrollRef: externalScrollRef,
  leadingContent,
  matchedProjectPaths,
  visibleProjectPaths,
  showProjectSections = true,
  searchActive: searchActiveProp,
  previewAll: previewAllProp,
  previewKey = "",
  projectSummaries,
  pinnedEntries = [],
  chatEntries,
  onNewChat,
  workflowsSection,
  onProjectHoverOpen,
}: ProjectListProps) {
  const { t: uiT } = useTranslation();
  const searchActive = searchActiveProp ?? !active;
  const previewAll = previewAllProp ?? searchActive;
  const pendingActivation = useRef<string | undefined>(undefined);
  useEffect(() => {
    // An external project selection supersedes any disclosure still entering.
    pendingActivation.current = undefined;
  }, [cwd]);
  const tree =
    !compact && expandedPaths !== undefined
      ? {
          expandedPaths,
          onToggleProject,
          onActivateProject,
          pendingActivation,
          canExpandProject,
          renderProjectChildren,
          onNewInProject,
          needsApproval: new Set([...(needsApprovalPaths ?? [])].map(pathKey)),
        }
      : undefined;
  const [railOrder, setRailOrder] = usePreferenceState(loadProjectRailOrder);
  const [pinnedPaths, setPinnedPaths] = usePreferenceState(loadPinnedProjects);
  const [pinnedOrder, setPinnedOrder] = usePreferenceState(loadSidebarPinnedOrder);
  const [sectionOrder, setSectionOrder] = usePreferenceState(
    loadSidebarSectionOrder,
  );
  useEffect(
    () =>
      subscribeSidebarSectionOrder(() =>
        setSectionOrder(loadSidebarSectionOrder()),
      ),
    [],
  );
  useEffect(
    () =>
      subscribeSidebarPinnedOrder(() => setPinnedOrder(loadSidebarPinnedOrder())),
    [],
  );
  const [groupLabels, setGroupLabels] = usePreferenceState(loadTabGroupLabels);
  const [groupColors, setGroupColors] = usePreferenceState(loadTabGroupColors);
  const [groupMascots, setGroupMascots] = usePreferenceState(loadTabGroupMascots);
  const [groupCustomColors, setGroupCustomColors] = usePreferenceState(
    loadTabGroupCustomColors,
  );
  const [projectGroups, setProjectGroups] = usePreferenceState(loadProjectGroups);
  const [projectGroupAssignments, setProjectGroupAssignments] = usePreferenceState(
    loadProjectGroupAssignments,
  );
  const [collapsedSections, setCollapsedSections] = usePreferenceState(
    loadSidebarSectionsCollapsed,
  );
  const [searchCollapsedSections, setSearchCollapsedSections] = useState<{
    query: string;
    sections: ReadonlySet<SidebarSectionId>;
  }>(() => ({ query, sections: new Set() }));
  const groupContentId = useId();
  const workflowsContentId = useId();
  useEffect(
    () =>
      subscribeSidebarSectionsCollapsed(() =>
        setCollapsedSections(loadSidebarSectionsCollapsed()),
      ),
    [],
  );
  useEffect(() => {
    setSearchCollapsedSections({ query, sections: new Set() });
  }, [query, searchActive]);
  useEffect(
    () =>
      subscribeProjectPathsChanged(() => {
        setRailOrder(loadProjectRailOrder());
        setPinnedPaths(loadPinnedProjects());
        setGroupLabels(loadTabGroupLabels());
        setGroupColors(loadTabGroupColors());
        setGroupMascots(loadTabGroupMascots());
        setGroupCustomColors(loadTabGroupCustomColors());
        setProjectGroups(loadProjectGroups());
        setProjectGroupAssignments(loadProjectGroupAssignments());
      }),
    [],
  );
  const projectMenu = useProjectMenu({
    onRemoveProject,
    onOpenNotificationSettings,
  });
  useEffect(() => {
    // Project menus live outside the section's visibility context.
    projectMenu.close();
  }, [collapsedSections, searchCollapsedSections]);
  const sectionExpanded = (section: SidebarSectionId) =>
    compact ||
    !(searchActive
      ? searchCollapsedSections.query === query &&
        searchCollapsedSections.sections.has(section)
      : collapsedSections.has(section));
  const toggleSection = (section: SidebarSectionId) => {
    projectMenu.close();
    if (searchActive) {
      setSearchCollapsedSections((previous) => {
        const sections = new Set(
          previous.query === query ? previous.sections : [],
        );
        if (!sections.delete(section)) sections.add(section);
        return { query, sections };
      });
      return;
    }
    const next = new Set(collapsedSections);
    if (!next.delete(section)) next.add(section);
    saveSidebarSectionsCollapsed(next);
    setCollapsedSections(next);
  };
  const revealPinnedSection = useCallback(() => {
    const next = new Set(collapsedSections);
    next.delete("pinned");
    saveSidebarSectionsCollapsed(next);
    setCollapsedSections(next);
    setSearchCollapsedSections((previous) => {
      const sections = new Set(previous.sections);
      sections.delete("pinned");
      return { ...previous, sections };
    });
  }, [collapsedSections]);
  const notificationPreferences = useProjectNotificationPreferences();
  const allProjects = useMemo(
    () => collectRailProjects(recents, cwd),
    [cwd, recents],
  );
  const notificationProjects = useNotificationProjects([...allProjects.keys()]);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const summaryPinFocus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const path = summaryPinFocus.current;
    if (!path) return;
    const target = [
      ...(scrollRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-project-select]",
      ) ?? []),
    ].find((button) => button.dataset.projectSelect === pathKey(path));
    target?.focus({ preventScroll: true });
    summaryPinFocus.current = undefined;
  }, [pinnedPaths]);
  const groupLogos = useTabGroupLogos();
  const muteStatuses = new Map<string, string | null>();
  for (const project of notificationProjects.projects) {
    const status = notificationMuteStatus(notificationPreferences[project.id]);
    for (const path of project.paths) muteStatuses.set(pathKey(path), status);
  }
  const sections = useMemo(() => {
    const all = projectRailSections(recents, cwd, railOrder, pinnedPaths);
    const ordered = visibleProjectPaths ? {
      pinned: all.pinned.filter((project) => visibleProjectPaths.has(pathKey(project.path))),
      projects: all.projects.filter((project) => visibleProjectPaths.has(pathKey(project.path))),
    } : all;
    if (matchedProjectPaths) {
      const matches = (project: RecentProject) =>
        matchedProjectPaths.has(pathKey(project.path));
      return {
        pinned: ordered.pinned.filter(matches),
        projects: ordered.projects.filter(matches),
      };
    }
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return ordered;
    const matches = (project: RecentProject) =>
      [
        project.path,
        resolveTabGroupLabel(
          projectKey(project.path),
          groupLabels,
          basename(project.path),
        ),
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    return {
      pinned: ordered.pinned.filter(matches),
      projects: ordered.projects.filter(matches),
    };
  }, [
    cwd,
    pinnedPaths,
    railOrder,
    recents,
    query,
    groupLabels,
    matchedProjectPaths,
    visibleProjectPaths,
  ]);
  const groupedProjectSections = useMemo(() => {
    const byGroup = new Map<string, RecentProject[]>(
      projectGroups.map((group) => [group.id, []]),
    );
    const ungrouped: RecentProject[] = [];
    for (const project of sections.projects) {
      const groupId = projectGroupIdForPath(
        project.path,
        projectGroupAssignments,
      );
      const items = groupId ? byGroup.get(groupId) : undefined;
      if (items) items.push(project);
      else ungrouped.push(project);
    }
    return {
      ungrouped,
      grouped: projectGroups
        .map((group) => ({
          group,
          items: byGroup.get(group.id) ?? [],
        }))
        .filter(({ items }) => !searchActive || items.length > 0),
    };
  }, [projectGroupAssignments, projectGroups, sections.projects, searchActive]);
  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const path of busyPaths ?? []) set.add(path);
    return set;
  }, [busyPaths]);

  useEffect(() => {
    setRailOrder((prev) => {
      const synced = syncProjectRailOrder(prev, allProjects);
      if (synced.join("\0") === prev.join("\0")) return prev;
      saveProjectRailOrder(synced);
      return synced;
    });
  }, [allProjects]);

  useEffect(() => {
    if (!projectMenu.isOpen) return;
    const onScroll = () => projectMenu.close();
    const scrollParent = scrollRef.current ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [projectMenu.isOpen]);

  const onProjectContextMenu = (
    path: string,
    event: MouseEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
    projectMenu.open(path, event.clientX, event.clientY);
  };

  const reorderSubset = (
    fullOrder: string[],
    subsetOrder: string[],
    subsetPaths: Set<string>,
  ) => {
    const next: string[] = [];
    let subsetIndex = 0;
    for (const path of fullOrder) {
      if (!subsetPaths.has(path)) {
        next.push(path);
        continue;
      }
      if (subsetIndex < subsetOrder.length) {
        next.push(subsetOrder[subsetIndex++]);
      }
    }
    return next;
  };

  const onReorderProjects = (ids: string[]) => {
    const subset = new Set(ids);
    const next = reorderSubset(railOrder, ids, subset);
    setRailOrder(next);
    saveProjectRailOrder(next);
  };

  const onReorderPins = (ids: string[]) => {
    const all = [
      ...pinnedOrder,
      ...pinnedEntries.map((entry) => `session:${entry.id}`),
      ...sections.pinned.map((item) => item.path),
    ];
    const next = reorderSidebarPins(all, ids);
    saveSidebarPinnedOrder(next);
    setPinnedOrder(next);
    onReorderProjects(ids.filter((id) => allProjects.has(pathKey(id))));
  };

  const visibleSections: Record<SidebarOrderedSectionId, boolean> = {
    pinned: !compact || sections.pinned.length > 0 || pinnedEntries.length > 0,
    chats:
      !compact &&
      chatEntries !== undefined &&
      (!searchActive || chatEntries.length > 0),
    workflows: !compact && !!workflowsSection,
    groups: showProjectSections && projectGroups.length > 0,
    projects: showProjectSections,
  };
  const visibleSectionIds = (
    compact ? DEFAULT_SIDEBAR_SECTION_ORDER : sectionOrder
  ).filter((id) => visibleSections[id]);
  const [draggingSection, setDraggingSection] = useState<SidebarOrderedSectionId | null>(null);
  const reorderSections = (ids: SidebarOrderedSectionId[]) => {
      const next = reorderSidebarSections(sectionOrder, ids);
      saveSidebarSectionOrder(next);
      setSectionOrder(next);
    };
  useEffect(() => {
    if (draggingSection) projectMenu.close();
  }, [draggingSection]);

  const sectionContent: Record<SidebarOrderedSectionId, ReactNode> = {
    pinned: (
      <ProjectSection
        compact={compact}
        label={uiT("Pinned items")}
        expanded={sectionExpanded("pinned")}
        onToggleExpanded={() => toggleSection("pinned")}
        leadingEntries={pinnedEntries}
        emptyLabel={uiT("Drag conversations or projects here to pin them")}
        itemOrder={pinnedOrder}
        items={sections.pinned}
        muteStatuses={muteStatuses}
        cwd={cwd}
        busy={busy}
        statsEnabled={statsEnabled ?? !compact}
        tree={tree}
        onReorder={onReorderPins}
        pinned
        searchActive={searchActive}
        previewAll={previewAll}
        previewKey={previewKey}
        onSelect={onSelectProject}
        onTogglePin={toggleProjectPin}
        onContextMenu={onProjectContextMenu}
        onOpenMenu={projectMenu.open}
        groupLabels={groupLabels}
        groupColors={groupColors}
        groupCustomColors={groupCustomColors}
        groupLogos={groupLogos}
        groupMascots={groupMascots}
      />
    ),
    chats: (
      <div
        data-project-section="chats"
        className={`shrink-0 ${tree ? "mb-1" : "mb-2"}`}
      >
        <ChatProjectCard
          entries={chatEntries ?? []}
          searchActive={searchActive}
          onNewChat={onNewChat}
        />
      </div>
    ),
    workflows: (
      <div
        data-project-section="workflows"
        className={`shrink-0 ${tree ? "mb-1" : "mb-2"}`}
      >
        <ProjectSectionHeader
          label={uiT("Workflows")}
          expanded={sectionExpanded("workflows")}
          contentId={workflowsContentId}
          onToggleExpanded={() => toggleSection("workflows")}
        />
        <AnimatedCollapse
          keepMounted
          expanded={sectionExpanded("workflows")}
          motion="height"
          className="project-tree-collapse"
          durationMs={PROJECT_COLLAPSE_DURATION_MS}
        >
          <div id={workflowsContentId}>{workflowsSection}</div>
        </AnimatedCollapse>
      </div>
    ),
    groups: (
      <div
        data-project-section="groups"
        className={`shrink-0 ${tree ? "mb-1" : "mb-2"}`}
      >
        {compact ? null : (
          <ProjectSectionHeader
            label={uiT("Groups")}
            expanded={sectionExpanded("groups")}
            contentId={groupContentId}
            onToggleExpanded={() => toggleSection("groups")}
            onAddGroup={(x, y) => projectMenu.createGroup(x, y)}
          />
        )}
        <AnimatedCollapse
          keepMounted
          expanded={sectionExpanded("groups")}
          motion="height"
          className="project-tree-collapse"
          durationMs={PROJECT_COLLAPSE_DURATION_MS}
        >
          <div
            id={groupContentId}
            data-project-rows
            className={
              compact
                ? "flex flex-col items-center gap-1"
                : "flex flex-col gap-px px-2"
            }
          >
            {groupedProjectSections.grouped.map(({ group, items }) => (
              <ProjectGroupSection
                compact={compact}
                key={group.id}
                group={group}
                items={items}
                muteStatuses={muteStatuses}
                cwd={cwd}
                busy={busy}
                statsEnabled={statsEnabled ?? !compact}
                tree={tree}
                onReorder={onReorderProjects}
                searchActive={searchActive}
                onSelect={onSelectProject}
                onTogglePin={toggleProjectPin}
                onContextMenu={onProjectContextMenu}
                onOpenMenu={projectMenu.open}
                onToggleCollapsed={() =>
                  updateProjectGroup(group.id, (current) => ({
                    ...current,
                    collapsed: !current.collapsed,
                  }))
                }
                onOpenGroupMenu={(x, y) =>
                  projectMenu.openGroupMenu(group.id, x, y)
                }
                groupLabels={groupLabels}
                groupColors={groupColors}
                groupCustomColors={groupCustomColors}
                groupLogos={groupLogos}
                groupMascots={groupMascots}
              />
            ))}
          </div>
        </AnimatedCollapse>
      </div>
    ),
    projects: (
      <ProjectSection
        compact={compact}
        label={uiT("Projects")}
        expanded={sectionExpanded("projects")}
        onToggleExpanded={() => toggleSection("projects")}
        items={groupedProjectSections.ungrouped}
        muteStatuses={muteStatuses}
        emptyLabel={
          sections.projects.length === 0 && projectGroups.length === 0
            ? uiT(
                query.trim() || searchActive
                  ? "No matching projects"
                  : "No projects yet",
              )
            : undefined
        }
        onAdd={onOpenProject}
        cwd={cwd}
        busy={busy}
        statsEnabled={statsEnabled ?? !compact}
        tree={tree}
        onReorder={onReorderProjects}
        pinned={false}
        searchActive={searchActive}
        previewAll={previewAll}
        previewKey={previewKey}
        onSelect={onSelectProject}
        onTogglePin={toggleProjectPin}
        onContextMenu={onProjectContextMenu}
        onOpenMenu={projectMenu.open}
        groupLabels={groupLabels}
        groupColors={groupColors}
        groupCustomColors={groupCustomColors}
        groupLogos={groupLogos}
        groupMascots={groupMascots}
      />
    ),
  };

  return (
    <SortableList ids={visibleSectionIds} onReorder={reorderSections} disabled={compact}
      renderOverlay={id => uiT(({ pinned: "Pinned items", chats: "Chats", workflows: "Workflows", groups: "Project groups", projects: "Projects" })[id])}>
    <SidebarPinDropContext.Provider value={revealPinnedSection}>
    <ProjectSummaryContext.Provider
      value={{
        summaries: projectSummaries,
        onOpen: onProjectHoverOpen,
        onPin: (path) => {
          summaryPinFocus.current = path;
          toggleProjectPin(path);
        },
        restoringPinFocusPath: summaryPinFocus,
        disabled: projectMenu.isActive || draggingSection !== null,
      }}
    >
      <div
        aria-label={uiT("Projects")}
        data-project-list={tree ? "tree" : compact ? "avatars" : "full"}
        className={`flex flex-col ${scrollable ? "min-h-0 flex-1" : "shrink-0"}`}
      >
        <div
          data-project-list-scroll
          ref={(el) => {
            lockOverscroll(el);
            scrollRef.current = el;
            if (typeof externalScrollRef === "function") externalScrollRef(el);
            else if (externalScrollRef) externalScrollRef.current = el;
          }}
          className={`flex flex-col gap-1 pb-2 ${scrollable ? "min-h-0 flex-1 overflow-y-auto overscroll-none" : "shrink-0"}`}
        >
          {leadingContent}
          <ListMotion>
          {visibleSectionIds.map((id) => <SortableItem key={id} id={id} disabled={compact} onActiveChange={active => setDraggingSection(active ? id : null)}>{item => (
            <SidebarSectionReorderContext.Provider
              value={compact ? null : { id, item }}
            >
              <motion.div
                {...item.motionProps}
                ref={item.ref}
                style={item.style}
                data-sidebar-reorder-section={id}
                data-reordering={item.sorting || undefined}
                data-dragging={item.dragging || undefined}
                className="relative flex shrink-0 flex-col"
              >
                {sectionContent[id]}
              </motion.div>
            </SidebarSectionReorderContext.Provider>
          )}</SortableItem>)}
          </ListMotion>
        </div>
        {projectMenu.element}
      </div>
    </ProjectSummaryContext.Provider>
    </SidebarPinDropContext.Provider>
    </SortableList>
  );
}
