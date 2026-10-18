import { Button } from "../shared/ui/forms/Button";
import { motion } from "motion/react";
import { motionGeometry, panelTransition } from "../shared/motion/tokens";
import { useListReorderMotion } from "../shared/hooks/useListReorderMotion";
import { MobileSpinner } from "./MobileSpinner";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type {
  HostProject,
  HostSessionSummary,
} from "../features/connections/model/protocol";
import { sessionDisplayTitle } from "../features/sessions/model/session";
import { useTranslation } from "../shared/i18n/useTranslation";
import { useMobilePageState } from "./mobilePageState";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";
import {
  Archive,
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  LoaderCircle,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from "../shared/ui/icons";
import { MobileSheet, type MobileSheetPoint } from "./MobileSheet";
import { MobileListPreview } from "./MobileListPreview";
import { MobileSessionRow } from "./MobileSessionRow";
import { MobileEmpty } from "./MobileEmpty";
import { useMobileSessionLists } from "./sessionListStore";
import { MobileListSkeleton } from "./MobileListSkeleton";
import { lightImpact } from "./haptics";
import { sortMobileProjects } from "./sessionList";
import { isChatFolder } from "../features/projects/model/chatFolderPath";
import type { MobileRemoteHost } from "./useMobileHostDirectory";
import {
  filterMobileSessions,
  MOBILE_SESSION_FILTER_LABELS,
  MOBILE_SESSION_FILTERS,
  type MobileSessionFilter,
} from "./sessionFilter";

const FILTER_ICONS: Record<MobileSessionFilter, typeof Check> = {
  all: SlidersHorizontal,
  working: LoaderCircle,
  needsInput: TriangleAlert,
  completed: Check,
  archived: Archive,
};

/** Where a conversation listed from another paired device lives. */
interface RemoteOrigin {
  endpoint: string;
  name: string;
  owner: HostProject;
}

const MotionChevronDown = motion.create(ChevronDown);

function projectState(history: readonly HostSessionSummary[]) {
  return history.some((session) => !session.archived && session.needsInput)
    ? "input"
    : history.some((session) => !session.archived && session.status === "running") ? "running" : "idle";
}

/** The same list surface serves Home, All projects and a single project. */
function useMobileHomeController({
  projects,
  project,
  projectsPage = false,
  projectsPending = false,
  projectsUnavailable = false,
  foreground,
  inactive,
  query,
  now,
  unreadIds,
  loadSessions,
  cachedSessions,
  onProject,
  onSession,
  onNewSession,
  onNewChat,
  chatsPage = false,
  onChats,
  onSearch,
  searchOpen = false,
  searchTrigger,
  onAddProject,
  onSessionActions,
  sessionActionsId,
  refreshKey = 0,
  devices,
  unavailable,
  remote,
  onRemoteSession,
  onRemoteProject,
}: {
  projects: HostProject[];
  project?: HostProject;
  /** The project index reached from the drawer, without conversations. */
  projectsPage?: boolean;
  projectsPending?: boolean;
  projectsUnavailable?: boolean;
  foreground: boolean;
  inactive?: boolean;
  query: string;
  now: number;
  unreadIds: ReadonlySet<string>;
  loadSessions: (projectId: string) => Promise<HostSessionSummary[]>;
  cachedSessions?: (projectId: string) => HostSessionSummary[] | undefined;
  onProject: (project: HostProject) => void;
  onSession: (id: string, project: HostProject) => void;
  onNewSession: () => void;
  /** Starts a projectless chat; absent when the Host cannot create one. */
  onNewChat?: () => void;
  /** Lists every projectless chat, like a single project. */
  chatsPage?: boolean;
  /** Opens the chats page from the Chats row atop the projects. */
  onChats?: () => void;
  onSearch: () => void;
  searchOpen?: boolean;
  searchTrigger?: RefObject<HTMLButtonElement | null>;
  onAddProject: (trigger: HTMLButtonElement) => void;
  onSessionActions?: (session: HostSessionSummary, trigger: HTMLButtonElement, point?: MobileSheetPoint) => void;
  sessionActionsId?: string;
  refreshKey?: number;
  /** Home's device row, shown above its sections. */
  devices?: ReactNode;
  /** Replaces Home's empty lists while its device is unreachable or connecting. */
  unavailable?: ReactNode;
  /** Other paired devices' lists while Home shows every device. */
  remote?: readonly MobileRemoteHost[];
  onRemoteSession?: (endpoint: string, id: string, project: HostProject) => void;
  onRemoteProject?: (endpoint: string, project: HostProject) => void;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const searchButton = useRef<HTMLButtonElement | null>(null);
  const setSearchButton = useCallback((element: HTMLButtonElement | null) => {
    if (searchTrigger && (element || searchTrigger.current === searchButton.current))
      searchTrigger.current = element;
    searchButton.current = element;
  }, [searchTrigger]);
  const chatProjects = useMemo(() => projects.filter((item) => isChatFolder(item.cwd)), [projects]);
  const owners = useMemo(() => chatsPage ? chatProjects : project ? [project] : projects,
    [chatsPage, chatProjects, project, projects]);
  const idsKey = JSON.stringify(owners.map((item) => item.id));
  const { histories, refresh } = useMobileSessionLists({
    idsKey, enabled: foreground && visible, loadSessions, cachedSessions, refreshKey,
  });
  const [filter, setFilter] = useMobilePageState<MobileSessionFilter>("filter", "all");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const root = !project && !projectsPage && !chatsPage;
  // Only Home offers status filters; a project page always lists everything.
  const activeFilter = root ? filter : "all";
  const [projectsOpen, setProjectsOpen] = useMobilePageState("projectsOpen", true);
  const [pinnedOpen, setPinnedOpen] = useMobilePageState("pinnedOpen", true);
  const remoteHosts = useMemo(() => root ? remote ?? [] : [], [root, remote]);
  const hold = useRef<{ pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; moved: boolean; opened: boolean } | undefined>(undefined);
  const suppressClick = useRef<string | undefined>(undefined);
  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = undefined;
  };
  useEffect(() => {
    cancelHold();
    return cancelHold;
  }, [inactive, foreground, visible, project?.id, query]);
  const orderedProjects = useMemo(() => sortMobileProjects(
    projects.filter((item) => !isChatFolder(item.cwd)),
    (id) => histories[id]?.sessions ?? [],
  ), [projects, histories]);
  const needle = query.trim().toLocaleLowerCase();
  const matchingProjects = useMemo(() => orderedProjects.filter((item) =>
    !needle || `${item.name} ${item.cwd}`.toLocaleLowerCase().includes(needle),
  ), [orderedProjects, needle]);
  const ownerById = useMemo(() => new Map(owners.map((item) => [item.id, item])), [owners]);
  const origins = useMemo(() => {
    const result = new Map<HostSessionSummary, RemoteOrigin>();
    for (const host of remoteHosts) {
      const hostOwners = new Map(host.projects.map((item) => [item.id, item]));
      for (const item of host.sessions) {
        const owner = hostOwners.get(item.projectId);
        if (owner) result.set(item, { endpoint: host.endpoint, name: host.name, owner });
      }
    }
    return result;
  }, [remoteHosts]);
  const remoteProjects = useMemo(() => remoteHosts.flatMap((host) =>
    sortMobileProjects(host.projects, (id) => host.sessions.filter((item) => item.projectId === id))
      .filter((item) => !isChatFolder(item.cwd))
      .filter((item) => !needle || `${item.name} ${item.cwd}`.toLocaleLowerCase().includes(needle))
      .map((item) => ({ host, project: item })),
  ), [remoteHosts, needle]);
  const sessions = useMemo(() => filterMobileSessions(
    [...owners.flatMap((item) => histories[item.id]?.sessions ?? []), ...origins.keys()],
    activeFilter,
  ).filter((item) => origins.has(item) || ownerById.has(item.projectId)), [owners, ownerById, origins, histories, activeFilter]);
  const ordered = useMemo(() => sessions.filter(
      (item) =>
        !needle ||
        `${sessionDisplayTitle(item.title, item.harness) || t("Untitled conversation")} ${(origins.get(item)?.owner ?? ownerById.get(item.projectId))?.name}`
          .toLocaleLowerCase()
          .includes(needle),
    ), [sessions, needle, ownerById, origins, t]);
  // Home's unfiltered overview splits pinned conversations into their own section.
  const overview = root && !needle && activeFilter === "all";
  const pinned = useMemo(() => overview ? ordered.filter((item) => item.pinned) : [], [overview, ordered]);
  const recent = useMemo(() => overview ? ordered.filter((item) => !item.pinned) : ordered, [overview, ordered]);
  const loading = owners.some((item) => !histories[item.id]);
  const projectsLoading = loading && !owners.some((item) => histories[item.id]?.sessions);
  const failed = owners.filter((item) => histories[item.id]?.failed);
  const row = (item: HostSessionSummary) => {
    const origin = origins.get(item);
    if (origin) return (
      <MobileSessionRow
        key={`${origin.endpoint}:${item.id}`}
        session={item}
        now={now}
        unread={false}
        hostName={origin.name}
        onClick={() => onRemoteSession?.(origin.endpoint, item.id, origin.owner)}
      />
    );
    const owner = ownerById.get(item.projectId)!;
    return (
      <MobileSessionRow
        key={item.id}
        session={item}
        now={now}
        unread={unreadIds.has(item.id)}
        aria-haspopup={onSessionActions ? "dialog" : undefined}
        aria-expanded={sessionActionsId === item.id}
        onPointerDown={(event) => {
          cancelHold();
          suppressClick.current = undefined;
          if (!onSessionActions || inactive || event.button !== 0) return;
          const trigger = event.currentTarget;
          const press = {
            pointerId: event.pointerId, x: event.clientX, y: event.clientY,
            moved: false, opened: false,
            timer: setTimeout(() => {
              press.opened = true;
              suppressClick.current = item.id;
              void lightImpact();
              onSessionActions(item, trigger, { x: press.x, y: press.y });
            }, 450),
          };
          hold.current = press;
        }}
        onPointerMove={(event) => {
          const press = hold.current;
          if (!press || press.pointerId !== event.pointerId) return;
          if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
            press.moved = true;
            clearTimeout(press.timer);
            suppressClick.current = item.id;
          }
        }}
        onPointerUp={cancelHold}
        onPointerCancel={() => {
          suppressClick.current = item.id;
          cancelHold();
        }}
        onPointerLeave={cancelHold}
        onContextMenu={(event) => {
          if (!onSessionActions || inactive) return;
          event.preventDefault();
          cancelHold();
          suppressClick.current = item.id;
          onSessionActions(item, event.currentTarget, event.clientX || event.clientY
            ? { x: event.clientX, y: event.clientY } : undefined);
        }}
        onKeyDown={(event) => {
          suppressClick.current = undefined;
          if (onSessionActions && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
            event.preventDefault();
            onSessionActions(item, event.currentTarget);
          }
        }}
        onClick={(event) => {
          if (suppressClick.current === item.id) {
            event.preventDefault();
            suppressClick.current = undefined;
            return;
          }
          onSession(item.id, owner);
        }}
      />
    );
  };

  const projectActivity = (history: readonly HostSessionSummary[], combined = false) => {
    const state = projectState(history);
    const running = state === "running" || (combined && history.some((session) =>
      !session.archived && !session.needsInput && session.status === "running"));
    if (state === "idle") return null;
    return (
      <span className="mobile-home-project-activity">
        {state === "input" && (
          <span className="mobile-home-project-state" role="img" aria-label={t("Needs input")}>
            <TriangleAlert size={18} aria-hidden="true" />
          </span>
        )}
        {running && (
          <span className="mobile-home-project-state" role="img" aria-label={t("Working")}>
            <MobileSpinner size={18} className="mobile-spin" aria-hidden="true" />
          </span>
        )}
      </span>
    );
  };
  const projectRow = (
    item: HostProject,
    history: readonly HostSessionSummary[],
    onClick: () => void,
    overview?: { key: string; hostName?: string },
  ) => {
    const state = projectState(history);
    return (
      <button
        type="button"
        className="mobile-home-project"
        data-list-row
        key={overview?.key ?? item.id}
        title={item.cwd}
        data-state={state}
        data-compact={overview ? true : undefined}
        onClick={onClick}
      >
        <Folder size={23} />
        <span>
          <strong>{item.name}</strong>
          {!overview && <small>{item.machine?.kind === "wsl" ? `WSL · ${item.machine.distribution} · ${item.cwd}` : item.cwd}</small>}
        </span>
        {overview?.hostName && <small className="mobile-home-project-host">{overview.hostName}</small>}
        {projectActivity(history, !!overview)}
      </button>
    );
  };
  const chatHistory = chatProjects.flatMap((item) => histories[item.id]?.sessions ?? []);
  const chatsRow = (overview: boolean) => (
    <button
      type="button"
      className="mobile-home-project"
      key="chats"
      data-chat-project
      data-state={projectState(chatHistory)}
      data-compact={overview || undefined}
      onClick={onChats}
    >
      <MessageSquare size={23} />
      <span>
        <strong>{t("Chats")}</strong>
      </span>
      {projectActivity(chatHistory, overview)}
    </button>
  );
  const overviewProjects = [
    ...(onChats && !needle ? [{ key: "chats", render: () => chatsRow(true) }] : []),
    ...matchingProjects.map((item) => ({ key: item.id, render: () =>
      projectRow(item, histories[item.id]?.sessions ?? [], () => onProject(item), { key: item.id }) })),
    ...remoteProjects.map(({ host, project: item }) => {
      const key = `${host.endpoint}:${item.id}`;
      return { key, render: () => projectRow(item, host.sessions.filter((session) => session.projectId === item.id),
        () => onRemoteProject?.(host.endpoint, item), { key, hostName: host.name }) };
    }),
  ];
  const hasProjects = !!projects.length || remoteHosts.some((host) => host.projects.length > 0);
  return {
    activeFilter,
    chatsPage,
    chatsRow,
    devices,
    failed,
    filter,
    filterOpen,
    filterTrigger,
    hasProjects,
    histories,
    inactive,
    loading,
    matchingProjects,
    needle,
    onAddProject,
    onChats,
    onNewChat,
    onNewSession,
    onProject,
    onSearch,
    ordered,
    overview,
    overviewProjects,
    pinned,
    pinnedOpen,
    project,
    projectActivity,
    projectRow,
    projects,
    projectsLoading,
    projectsOpen,
    projectsPage,
    projectsPending,
    projectsUnavailable,
    query,
    recent,
    refresh,
    root,
    row,
    searchOpen,
    sessions,
    setFilter,
    setFilterOpen,
    setPinnedOpen,
    setProjectsOpen,
    setSearchButton,
    t,
    unavailable,
  };
}

type MobileHomeViewModel = ReturnType<typeof useMobileHomeController>;

function MobileHomeView({ vm }: { vm: MobileHomeViewModel }) {
  const list = useRef<HTMLDivElement>(null);
  useListReorderMotion(list, [
    ...vm.matchingProjects.map((project) => project.id),
    ...vm.overviewProjects.map((project) => project.key),
    ...vm.pinned.map((session) => session.id),
    ...vm.recent.map((session) => session.id),
  ], "data-list-row", !vm.inactive);
  const {
    activeFilter,
    chatsPage,
    chatsRow,
    devices,
    failed,
    filter,
    filterOpen,
    filterTrigger,
    hasProjects,
    histories,
    inactive,
    loading,
    matchingProjects,
    needle,
    onAddProject,
    onChats,
    onNewChat,
    onNewSession,
    onProject,
    onSearch,
    ordered,
    overview,
    overviewProjects,
    pinned,
    pinnedOpen,
    project,
    projectActivity,
    projectRow,
    projects,
    projectsLoading,
    projectsOpen,
    projectsPage,
    projectsPending,
    projectsUnavailable,
    query,
    recent,
    refresh,
    root,
    row,
    searchOpen,
    sessions,
    setFilter,
    setFilterOpen,
    setPinnedOpen,
    setProjectsOpen,
    setSearchButton,
    t,
    unavailable,
  } = vm;

  return (
    <main
      className="mobile-home"
      data-project={!!project || chatsPage}
      inert={inactive}
      aria-hidden={inactive || undefined}
    >
      <div ref={list} className="mobile-home-scroll" key={chatsPage ? "chats" : project?.id ?? "all"}>
        {root && devices}
        {root && unavailable && !hasProjects && (projectsUnavailable || projectsPending) ? unavailable
          : projectsUnavailable && !hasProjects ? (
          <p className="mobile-home-empty" role="status">{t("Couldn’t load projects")}</p>
        ) : projectsPending && !hasProjects && (
          <MobileListSkeleton kind="projects" label={t("Loading projects…")} />
        )}
        {root && !needle && !hasProjects && !projectsPending && !projectsUnavailable && (
          <section className="mobile-home-projects" aria-label={t("Projects")}>
            <MobileEmpty icon={<Folder size={40} />} title={t("Projects")}
              action={<Button variant="secondary" type="button" className="mobile-home-add"
                onClick={(event) => onAddProject(event.currentTarget)}>
                <FolderPlus size={21} />{t("Open project")}
              </Button>}>
              {t("Choose a project")}
            </MobileEmpty>
          </section>
        )}
        {projectsPage && (
          <section className="mobile-home-projects" aria-label={t("Projects")}>
            {projectsLoading ? (
              <MobileListSkeleton kind="projects" rows={Math.min(matchingProjects.length || 5, 5)} label={t("Loading conversations…")} />
            ) : <>{onChats && !needle && chatsRow(false)}<MobileListPreview key={needle} stateKey={needle ? undefined : "projects"} initialLimit={50} items={matchingProjects} renderItem={(item) =>
              projectRow(item, histories[item.id]?.sessions ?? [], () => onProject(item))} /></>}
            {!matchingProjects.length && !projectsPending && !projectsUnavailable && !projectsLoading && (
              <MobileEmpty icon={needle ? <Search size={40} /> : <Folder size={40} />}
                title={t(needle ? "No matching projects" : "Projects")}>
                {!needle && t("Choose a project")}
              </MobileEmpty>
            )}
          </section>
        )}
        {overview && !!overviewProjects.length && (
          <section className="mobile-home-overview-projects" aria-label={t("Projects")}>
            <h2 className="mobile-home-section-head">
              <button type="button" className="mobile-home-section-toggle" aria-expanded={projectsOpen}
                onClick={() => setProjectsOpen((open) => !open)}>
                <span>{t("Projects")}</span>
                {projectActivity(sessions, true)}
                <MotionChevronDown size={18} aria-hidden="true" animate={{ rotate: projectsOpen ? 0 : -motionGeometry.disclosureAngle }} transition={panelTransition} />
              </button>
            </h2>
            <AnimatedCollapse expanded={projectsOpen} motion="height">
              <MobileListPreview stateKey="home-projects" initialLimit={5} items={overviewProjects}
                renderItem={(item) => item.render()} />
            </AnimatedCollapse>
          </section>
        )}
        {overview && !!pinned.length && (
          <section className="mobile-home-pinned" aria-label={t("Pinned")}>
            <h2 className="mobile-home-section-head">
              <button type="button" className="mobile-home-section-toggle" aria-expanded={pinnedOpen}
                onClick={() => setPinnedOpen((open) => !open)}>
                <span>{t("Pinned")}</span>
                <MotionChevronDown size={18} aria-hidden="true" animate={{ rotate: pinnedOpen ? 0 : -motionGeometry.disclosureAngle }} transition={panelTransition} />
              </button>
            </h2>
            <AnimatedCollapse expanded={pinnedOpen} motion="height">
              {pinned.map(row)}
            </AnimatedCollapse>
          </section>
        )}
        {!projectsPage && hasProjects && <section className="mobile-home-recent" aria-label={t(root ? "Recents" : "Sessions")}>
          {root && (
            <div className="mobile-home-section-head">
              <h2>{t("Recents")}</h2>
              <button
                ref={filterTrigger}
                type="button"
                className="mobile-home-filter"
                aria-haspopup="dialog"
                aria-expanded={filterOpen}
                onClick={() => setFilterOpen((open) => !open)}
              >
                <span>{t(MOBILE_SESSION_FILTER_LABELS[filter])}</span>
                <ChevronDown size={18} aria-hidden="true" />
              </button>
            </div>
          )}
          <MobileListPreview key={`${needle}:${activeFilter}`} stateKey={needle ? undefined : `recent:${activeFilter}`} initialLimit={20} items={recent} renderItem={row} />
          {projectsLoading && !ordered.length && (
            <MobileListSkeleton kind="sessions" label={t("Loading conversations…")} />
          )}
          {!ordered.length && !loading && !failed.length && !projectsPending && !projectsUnavailable && (
            <MobileEmpty icon={needle ? <Search size={40} /> : <MessageSquarePlus size={40} />}
              title={needle || activeFilter !== "all"
                ? t("No matching conversations")
                : t("No conversations yet")} />
          )}
          {!!failed.length && (
            <div className="mobile-home-error" role="alert">
              <span>
                {t("Couldn’t load sessions")} ·{" "}
                {failed.map((item) => item.name).join(", ")}
              </span>
              <button
                type="button"
                onClick={() => refresh()}
              >
                {t("Retry")}
              </button>
            </div>
          )}
        </section>}
      </div>
      {root && (
        <MobileSheet
          open={filterOpen && !inactive}
          title="Filter conversations"
          placement="anchor"
          anchor={filterTrigger}
          align="end"
          side="bottom"
          width={232}
          onClose={() => setFilterOpen(false)}
        >
          {MOBILE_SESSION_FILTERS.map((option) => {
            const Icon = FILTER_ICONS[option];
            return (
              <button
                key={option}
                type="button"
                className="mobile-sheet-row"
                data-separated={option === "archived" || undefined}
                role="menuitemradio"
                aria-checked={filter === option}
                onClick={() => {
                  setFilter(option);
                  setFilterOpen(false);
                }}
              >
                <Icon size={22} />
                <span className="flex-1">{t(MOBILE_SESSION_FILTER_LABELS[option])}</span>
                {filter === option && <Check size={22} />}
              </button>
            );
          })}
        </MobileSheet>
      )}
      {projectsPage && (
        <div className="mobile-home-dock">
          <button
            type="button"
            className="mobile-home-new mobile-home-open-project"
            aria-haspopup="dialog"
            onClick={(event) => onAddProject(event.currentTarget)}
          >
            <FolderPlus size={22} />
            <span>{t("Open project")}</span>
          </button>
        </div>
      )}
      {!!projects.length && !projectsPage && (
        <div className="mobile-home-dock">
          {chatsPage && (
            <button
              ref={setSearchButton}
              type="button"
              className="mobile-home-search"
              aria-label={t(searchOpen ? "Close search" : chatsPage ? "Search chats" : "Search conversations")}
              aria-expanded={searchOpen}
              onClick={onSearch}
            >
              <Search size={22} />
              <span>{query || t(chatsPage ? "Search chats" : "Search conversations")}</span>
            </button>
          )}
          {chatsPage ? (
            onNewChat && (
              <button
                type="button"
                className="mobile-home-new"
                aria-label={t("New chat")}
                onClick={onNewChat}
              >
                <MessageSquarePlus size={22} />
                <span>{t("Projectless chat")}</span>
              </button>
            )
          ) : (
            <button
              type="button"
              className="mobile-home-new"
              aria-label={t("New conversation")}
              onClick={onNewSession}
            >
              {project ? <MessageSquarePlus size={22} /> : <Plus size={22} />}
              <span>{t(project ? "Chat" : "New conversation")}</span>
            </button>
          )}
        </div>
      )}
    </main>
  );
}

export function MobileHome(props: {
  projects: HostProject[];
  project?: HostProject;
  /** The project index reached from the drawer, without conversations. */
  projectsPage?: boolean;
  projectsPending?: boolean;
  projectsUnavailable?: boolean;
  foreground: boolean;
  inactive?: boolean;
  query: string;
  now: number;
  unreadIds: ReadonlySet<string>;
  loadSessions: (projectId: string) => Promise<HostSessionSummary[]>;
  cachedSessions?: (projectId: string) => HostSessionSummary[] | undefined;
  onProject: (project: HostProject) => void;
  onSession: (id: string, project: HostProject) => void;
  onNewSession: () => void;
  /** Starts a projectless chat; absent when the Host cannot create one. */
  onNewChat?: () => void;
  /** Lists every projectless chat, like a single project. */
  chatsPage?: boolean;
  /** Opens the chats page from the Chats row atop the projects. */
  onChats?: () => void;
  onSearch: () => void;
  searchOpen?: boolean;
  searchTrigger?: RefObject<HTMLButtonElement | null>;
  onAddProject: (trigger: HTMLButtonElement) => void;
  onSessionActions?: (session: HostSessionSummary, trigger: HTMLButtonElement, point?: MobileSheetPoint) => void;
  sessionActionsId?: string;
  refreshKey?: number;
  /** Home's device row, shown above its sections. */
  devices?: ReactNode;
  /** Replaces Home's empty lists while its device is unreachable or connecting. */
  unavailable?: ReactNode;
  /** Other paired devices' lists while Home shows every device. */
  remote?: readonly MobileRemoteHost[];
  onRemoteSession?: (endpoint: string, id: string, project: HostProject) => void;
  onRemoteProject?: (endpoint: string, project: HostProject) => void;
}) {
  return <MobileHomeView vm={useMobileHomeController(props)} />;
}
