import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { AppPageHeader } from "../../workspace/ui/AppPageHeader";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  CheckCheck,
  Inbox,
  ListFilter,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
} from "../../../shared/ui/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { InboxFiltersMenu, INBOX_FILTER_MENU_WIDTH } from "./InboxFiltersMenu";
import { InboxConnectMenu } from "./InboxConnectMenu";
import { InboxProviderMark } from "./InboxProviderMark";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import {
  githubStatus,
  githubWorkItem,
  inboxItemKey,
  inboxListIsFresh,
  inboxProjectsForRail,
  listInboxItems,
  peekInboxList,
  type InboxItem,
  type InboxProviderErrors,
  type InboxQuery,
} from "../model/githubTasks";
import {
  applyInboxFilters,
  connectableInboxSources,
  hasActiveInboxFilters,
  loadInboxConnections,
  linearProjectOptions,
  inboxFetchState,
  loadInboxFilters,
  loadInboxSource,
  pruneInboxFilters,
  saveInboxFilters,
  resolveInboxSource,
  saveInboxConnections,
  saveInboxSource,
  visibleInboxSources,
  INBOX_SOURCE_LABELS,
  isTrackerSource,
  type ConnectableInboxSource,
  type InboxFilters,
  type InboxSource,
} from "../model/inboxFilters";
import { projectKey, projectName } from "../../../shared/lib/paths";
import {
  type RecentProject,
} from "../../projects/model/recents";
import {
  type LinkedWorkItem,
} from "../../sessions/model/session";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import {
  inboxItemMatchesLinkedWorkItem,
  linkedWorkItemInboxKey,
  relatedSessionsForInboxItem,
} from "../../sessions/model/sessionWorkItem";
import {
  isInboxEntryUnseen,
  markInboxItemSeen,
  markInboxItemsSeen,
  rememberInboxItems,
  useInboxSeenTick,
} from "../model/inboxSeen";
import { LIST_PAGE_SIZE, listWindowSize } from "../../../shared/lib/listWindow";
import {
  LINEAR_CHANGE_EVENT,
  linearConnected,
  listLinearTeams,
  loadHiddenLinearTeamIds,
  saveHiddenLinearTeamIds,
  type LinearTeam,
} from "../model/linear";
import {
  JIRA_CHANGE_EVENT,
  jiraConnected,
  listJiraProjects,
  loadHiddenJiraProjectIds,
  saveHiddenJiraProjectIds,
  type JiraProject,
} from "../model/jira";
import {
  GITLAB_CHANGE_EVENT,
  gitlabConnected,
} from "../model/gitlab";
import {
  AZUREDEVOPS_CHANGE_EVENT,
  azureDevOpsConnected,
} from "../model/azureDevOps";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import {
  InboxDiscussionPanel,
  type InboxSessionPortal,
} from "./InboxDiscussionPanel";
import { inboxAskKey } from "../model/inboxAsk";
import { type CiRepairProps, InboxDetail } from "./InboxDetail";
import { type InboxProjectOption, inboxProjectOptions } from "./InboxProjectPicker";
import { InboxCard } from "./InboxCard";

const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 280;

let rememberedWidth = DEFAULT_WIDTH;

function peekInboxForRail(recents: RecentProject[], cwd: string) {
  const projects = inboxProjectsForRail(recents, cwd);
  const filters = pruneInboxFilters(
    loadInboxFilters(),
    projects.map((project) => project.path),
  );
  return peekInboxList(projects, {
    assignedToMe: filters.assignedToMe,
    state: inboxFetchState(filters),
    search: "",
    linearHiddenTeamIds: loadHiddenLinearTeamIds(),
    jiraHiddenProjectIds: loadHiddenJiraProjectIds(),
  });
}

function InboxSourceTab({
  source,
  selected,
  onSelect,
}: {
  source: InboxSource;
  selected: boolean;
  onSelect: (source: InboxSource) => void;
}) {
  const label = INBOX_SOURCE_LABELS[source];
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(source)}
      className="surface-tab flex h-6 min-w-0 flex-1 items-center justify-center px-2 text-[12px] leading-none"
    >
      <span className="flex items-center gap-1.5">
        <InboxProviderMark
          provider={source}
          className="block size-3.5 shrink-0"
        />
        <span className="leading-none">{label}</span>
      </span>
    </button>
  );
}

type Props = {
  onAsk: (item: InboxItem) => Promise<string>;
  onAskRestart: (item: InboxItem) => Promise<string>;
  onAskMount: (portal: InboxSessionPortal | null) => void;
  cwd: string;
  recents: RecentProject[];
  active?: boolean;
  onClose?: () => void;
  onStart?: (item: InboxItem, body?: string) => void | Promise<void>;
  repairSessions?: CiRepairProps["repairSessions"];
  onRepairChecks?: CiRepairProps["onRepairChecks"];
  sessions?: readonly SessionSummary[];
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  /** Session-card destination to reveal after the Inbox list loads. */
  target?: LinkedWorkItem | null;
  /** Opens Settings on the card where the given source is connected. */
  onOpenIntegrations: (source: ConnectableInboxSource) => void;
};

export function InboxView({
  onAsk,
  onAskRestart,
  onAskMount,
  cwd,
  recents,
  active = true,
  onClose,
  onStart,
  repairSessions,
  onRepairChecks,
  sessions = [],
  onOpenSession,
  target = null,
  onOpenIntegrations,
}: Props) {
  const { t: uiT } = useTranslation();
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const listLock = useLockOverscroll<HTMLDivElement>();
  const listScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLLIElement>(null);
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const setListScrollRef = useCallback(
    (element: HTMLDivElement | null) => {
      listLock(element);
      listScrollRef.current = element;
    },
    [listLock],
  );
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const logos = useTabGroupLogos();
  const [groupMascots] = useState(loadTabGroupMascots);
  const [groupColors] = useState(loadTabGroupColors);
  const [groupCustomColors] = useState(loadTabGroupCustomColors);

  const [searchInput, setSearchInput] = useState("");
  const [items, setItems] = useState<InboxItem[]>(
    () => peekInboxForRail(recents, cwd)?.items ?? [],
  );
  const [loading, setLoading] = useState(
    () => peekInboxForRail(recents, cwd) == null,
  );
  const [revalidating, setRevalidating] = useState(false);
  const [readStatusError, setReadStatusError] = useState<string | null>(null);
  const [providerErrors, setProviderErrors] = useState<InboxProviderErrors>(
    () => peekInboxForRail(recents, cwd)?.errors ?? {},
  );
  const [refresh, setRefresh] = useState(0);
  const targetSelectionKey = target ? linkedWorkItemInboxKey(target) : null;
  const [selectedKey, setSelectedKey] = useState<string | null>(
    targetSelectionKey,
  );
  const [targetItem, setTargetItem] = useState<InboxItem | null>(null);
  const [filters, setFilters] = useState(loadInboxFilters);
  const [connections, setConnections] = useState(loadInboxConnections);
  const [source, setSource] = useState(() =>
    resolveInboxSource(loadInboxSource(), connections),
  );
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);
  const connectButtonRef = useRef<HTMLButtonElement | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [linearHiddenTeamIds, setLinearHiddenTeamIds] = useState(
    loadHiddenLinearTeamIds,
  );
  const [linearTeams, setLinearTeams] = useState<LinearTeam[]>([]);
  const [jiraHiddenProjectIds, setJiraHiddenProjectIds] = useState(
    loadHiddenJiraProjectIds,
  );
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const prevRefresh = useRef(refresh);

  const projects = useMemo(
    () => inboxProjectsForRail(recents, cwd),
    [cwd, recents],
  );
  const projectOptions = useMemo(
    () => inboxProjectOptions(projects, logos),
    [logos, projects],
  );
  const linearProjects = useMemo(() => linearProjectOptions(items), [items]);
  const activeFilters = useMemo(
    () =>
      pruneInboxFilters(
        filters,
        projects.map((project) => project.path),
      ),
    [filters, projects],
  );
  const filtersActive = hasActiveInboxFilters(
    activeFilters,
    source,
    linearHiddenTeamIds,
    jiraHiddenProjectIds,
  );
  const fetchState = inboxFetchState(activeFilters);
  const fetchQuery = useMemo<InboxQuery>(
    () => ({
      assignedToMe: activeFilters.assignedToMe,
      state: fetchState,
      search: "",
      linearHiddenTeamIds,
      jiraHiddenProjectIds,
    }),
    [
      activeFilters.assignedToMe,
      fetchState,
      linearHiddenTeamIds,
      jiraHiddenProjectIds,
    ],
  );

  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () => Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.5)),
    defaultWidth: DEFAULT_WIDTH,
    initial: rememberedWidth,
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });

  useEffect(() => {
    if (!target) return;
    setSource("github");
    setSearchInput("");
  }, [target]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (filterMenu) {
        setFilterMenu(null);
        return;
      }
      if (connectMenuOpen) {
        setConnectMenuOpen(false);
        return;
      }
      onCloseRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, connectMenuOpen, filterMenu]);

  useEffect(() => {
    const onChange = () => {
      setLinearHiddenTeamIds(loadHiddenLinearTeamIds());
      setRefresh((value) => value + 1);
    };
    window.addEventListener(LINEAR_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LINEAR_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    const onChange = () => {
      setJiraHiddenProjectIds(loadHiddenJiraProjectIds());
      setRefresh((value) => value + 1);
    };
    window.addEventListener(JIRA_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(JIRA_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    const onChange = () => setRefresh((value) => value + 1);
    window.addEventListener(GITLAB_CHANGE_EVENT, onChange);
    window.addEventListener(AZUREDEVOPS_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener(GITLAB_CHANGE_EVENT, onChange);
      window.removeEventListener(AZUREDEVOPS_CHANGE_EVENT, onChange);
    };
  }, []);

  // Returning from Settings refreshes connections without remounting this view.
  // Only the newest overlapping read may write its connection state.
  useEffect(() => {
    let cancelled = false;
    let latest = 0;
    const read = () => {
      const generation = ++latest;
      void Promise.allSettled([
        githubStatus(),
        linearConnected(),
        jiraConnected(),
        gitlabConnected(),
        azureDevOpsConnected(),
      ]).then(([github, linear, jira, gitlab, azuredevops]) => {
        if (cancelled || generation !== latest) return;
        setConnections((prev) => ({
          github:
            github.status === "fulfilled"
              ? github.value.connected
              : prev.github,
          linear:
            linear.status === "fulfilled"
              ? linear.value.connected
              : prev.linear,
          jira: jira.status === "fulfilled" ? jira.value.connected : prev.jira,
          gitlab:
            gitlab.status === "fulfilled"
              ? gitlab.value.connected
              : prev.gitlab,
          azuredevops:
            azuredevops.status === "fulfilled"
              ? azuredevops.value.connected
              : prev.azuredevops,
        }));
      });
    };
    read();
    window.addEventListener(LINEAR_CHANGE_EVENT, read);
    window.addEventListener(JIRA_CHANGE_EVENT, read);
    window.addEventListener(GITLAB_CHANGE_EVENT, read);
    window.addEventListener(AZUREDEVOPS_CHANGE_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(LINEAR_CHANGE_EVENT, read);
      window.removeEventListener(JIRA_CHANGE_EVENT, read);
      window.removeEventListener(GITLAB_CHANGE_EVENT, read);
      window.removeEventListener(AZUREDEVOPS_CHANGE_EVENT, read);
    };
  }, [active]);

  useEffect(() => {
    saveInboxConnections(connections);
  }, [connections]);

  // The initial source is resolved against cached status, so storage can still
  // name a provider this view has already fallen back from.
  useEffect(() => {
    saveInboxSource(source);
    // Mount only: the temporary switch to GitHub for a linked target must not
    // be persisted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disconnecting can pull the tab out from under the current selection.
  useEffect(() => {
    const next = resolveInboxSource(source, connections);
    if (next === source) return;
    setSource(next);
    saveInboxSource(next);
  }, [connections, source]);

  const visibleSources = visibleInboxSources(connections);
  const connectableSources = connectableInboxSources(connections);
  const sourceAvailable = visibleSources.includes(source);
  const noSourcesConnected = visibleSources.length === 0;

  // The roster has to come from Linear, not from the fetched issues: hiding a
  // team drops its issues, so a derived list could never offer it back.
  useEffect(() => {
    if (source !== "linear") return;
    let cancelled = false;
    void listLinearTeams()
      .then((teams) => {
        if (!cancelled) setLinearTeams(teams);
      })
      .catch(() => {
        if (!cancelled) setLinearTeams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source, linearHiddenTeamIds]);

  // Same for Jira: hidden projects are excluded from the fetch itself.
  useEffect(() => {
    if (source !== "jira") return;
    let cancelled = false;
    void listJiraProjects()
      .then((next) => {
        if (!cancelled) setJiraProjects(next);
      })
      .catch(() => {
        if (!cancelled) setJiraProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source, jiraHiddenProjectIds]);

  useEffect(() => {
    const force = refresh !== prevRefresh.current;
    prevRefresh.current = refresh;
    const cached = peekInboxList(projects, fetchQuery);
    if (cached) {
      setItems(cached.items);
      setProviderErrors(cached.errors);
      setLoading(false);
    }
    if (!force && cached && inboxListIsFresh(projects, fetchQuery)) {
      return;
    }

    let cancelled = false;
    if (cached) setRevalidating(true);
    else {
      setLoading(true);
      setProviderErrors({});
    }
    void listInboxItems(projects, fetchQuery, { force })
      .then((next) => {
        if (cancelled) return;
        setItems(next.items);
        setProviderErrors(next.errors);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (cached) return;
        setItems([]);
        const message = err instanceof Error ? err.message : String(err);
        setProviderErrors({
          github: message,
          linear: message,
          jira: message,
          gitlab: message,
          azuredevops: message,
        });
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRevalidating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchQuery, projects, refresh]);

  useEffect(() => {
    if (
      !target ||
      items.some((item) => inboxItemMatchesLinkedWorkItem(item, target))
    ) {
      return;
    }
    let cancelled = false;
    void githubWorkItem(cwd, target.repo, target.kind, target.number)
      .then((item) => {
        if (cancelled) return;
        setTargetItem({
          ...item,
          projectPath: cwd,
          provider: "github",
        });
      })
      .catch(() => {
        // The normal Inbox remains usable when an exact lookup is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, items, target, targetSelectionKey]);

  const visibleItems = useMemo(() => {
    if (!sourceAvailable) return [];
    const visible = applyInboxFilters(
      items,
      activeFilters,
      searchInput,
      Date.now(),
      source,
    );
    if (!target || source !== "github") return visible;
    const targeted =
      items.find((item) => inboxItemMatchesLinkedWorkItem(item, target)) ??
      (targetItem && inboxItemMatchesLinkedWorkItem(targetItem, target)
        ? targetItem
        : null);
    if (!targeted || visible.includes(targeted)) return visible;
    return [targeted, ...visible];
  }, [
    activeFilters,
    items,
    searchInput,
    source,
    sourceAvailable,
    target,
    targetItem,
  ]);

  const inboxSeenTick = useInboxSeenTick();
  useEffect(() => {
    rememberInboxItems(
      items.map((item) => ({
        key: inboxItemKey(item),
        updatedAt: item.updatedAt,
        projectPath: item.projectPath,
      })),
    );
  }, [items]);
  const sourceEntries = useMemo(
    () =>
      sourceAvailable
        ? items
            .filter((item) => item.provider === source)
            .map((item) => ({
              key: inboxItemKey(item),
              updatedAt: item.updatedAt,
            }))
        : [],
    [items, source, sourceAvailable],
  );
  const sourceHasUnseen = useMemo(
    () => sourceEntries.some(isInboxEntryUnseen),
    [inboxSeenTick, sourceEntries],
  );

  const searchNarrowed = searchInput.trim().length > 0;
  const narrowedByUser = searchNarrowed || filtersActive;
  const sourceError = providerErrors[source] ?? null;

  const selectedByKey = visibleItems.find(
    (item) => inboxItemKey(item) === selectedKey,
  );
  const waitingForTarget =
    !!targetSelectionKey && selectedKey === targetSelectionKey;
  const selected =
    selectedByKey ?? (waitingForTarget ? null : visibleItems[0]) ?? null;
  const updateInboxItem = useCallback((next: InboxItem) => {
    const key = inboxItemKey(next);
    setItems((current) =>
      current.map((entry) => (inboxItemKey(entry) === key ? next : entry)),
    );
    setTargetItem((current) =>
      current && inboxItemKey(current) === key ? next : current,
    );
  }, []);
  const shownItemCount = listWindowSize(visibleItems.length, listLimit);
  const shownItems = visibleItems.slice(0, shownItemCount);
  const hasMoreItems = shownItemCount < visibleItems.length;

  useEffect(() => {
    setListLimit(LIST_PAGE_SIZE);
    const scroller = listScrollRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [
    activeFilters,
    jiraHiddenProjectIds,
    linearHiddenTeamIds,
    searchInput,
    source,
  ]);

  useEffect(() => {
    if (!hasMoreItems) return;
    const sentinel = loadMoreRef.current;
    const root = listScrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setListLimit((current) => current + LIST_PAGE_SIZE);
      },
      { root, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreItems, shownItemCount]);

  useEffect(() => {
    if (!selected) {
      if (!targetSelectionKey) setSelectedKey(null);
      return;
    }
    const key = inboxItemKey(selected);
    // Keep waiting while the exact cache-miss lookup loads. Otherwise the
    // current list's first row replaces the requested key.
    if (
      targetSelectionKey &&
      selectedKey === targetSelectionKey &&
      key !== targetSelectionKey
    ) {
      return;
    }
    if (key !== selectedKey) setSelectedKey(key);
  }, [selected, selectedKey, targetSelectionKey]);

  const onFiltersChange = (next: InboxFilters) => {
    const pruned = pruneInboxFilters(
      next,
      projects.map((project) => project.path),
    );
    setFilters(pruned);
    saveInboxFilters(pruned);
  };

  const onSourceChange = (next: InboxSource) => {
    setSource(next);
    saveInboxSource(next);
  };

  const onFilterButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (filterMenu) {
      setFilterMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setFilterMenu({
      x: rect.right - INBOX_FILTER_MENU_WIDTH,
      y: rect.bottom + 2,
    });
  };

  const list = (
    <div
      ref={resize.setPaneRef}
      className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-stroke"
    >
      <div className="desktop-toolbar flex h-9 shrink-0 items-center gap-px border-b border-stroke px-2">
        {visibleSources.length > 0 ? (
          <div
            role="tablist"
            aria-label={uiT("Inbox source")}
            className="flex min-w-0 basis-0 items-center gap-px"
            style={{ flexGrow: visibleSources.length }}
          >
            {visibleSources.map((option) => (
              <InboxSourceTab
                key={option}
                source={option}
                selected={source === option}
                onSelect={onSourceChange}
              />
            ))}
          </div>
        ) : null}
        {connectableSources.length > 0 ? (
          <button
            ref={connectButtonRef}
            type="button"
            aria-label={uiT("Connect an inbox source")}
            aria-haspopup="menu"
            aria-expanded={connectMenuOpen}
            title={uiT("Connect an inbox source")}
            onClick={() => setConnectMenuOpen((open) => !open)}
            className={`flex h-6 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] leading-none ${
              connectMenuOpen
                ? "bg-selection text-content"
                : "text-content/40 hover:bg-content/3 hover:text-content"
            }`}
          >
            <Plus className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate leading-normal">{uiT("Add connection")}</span>
          </button>
        ) : null}
      </div>
      {noSourcesConnected ? null : (
        <div className="desktop-toolbar flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2">
          <div className="relative flex h-7 min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={uiT("Filter inbox")}
              aria-label={uiT("Filter inbox")}
              spellCheck={false}
              autoComplete="off"
              className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-[12px] text-content outline-none placeholder:text-content/40"
            />
          </div>
          <button
            type="button"
            title={uiT("Filter inbox")}
            aria-label={uiT("Filter inbox")}
            aria-expanded={!!filterMenu}
            aria-haspopup="menu"
            onClick={onFilterButtonClick}
            className={`grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/6 hover:text-content ${
              filterMenu || filtersActive ? "bg-selection text-content" : ""
            }`}
          >
            <ListFilter className="size-3" />
          </button>
          <button
            type="button"
            title={uiT("Mark all as read")}
            aria-label={uiT("Mark all as read")}
            disabled={!sourceHasUnseen}
            onClick={() =>
              setReadStatusError(
                markInboxItemsSeen(sourceEntries)
                  ? null
                  : "Could not save read status. Please try again.",
              )
            }
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/6 hover:text-content disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-content/45"
          >
            <CheckCheck className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={uiT("Refresh")}
            onClick={() => setRefresh((value) => value + 1)}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/6 hover:text-content"
          >
            {loading || revalidating ? (
              <LoaderCircle
                className="size-3.5 animate-spin"
              />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
        </div>
      )}
      {readStatusError ? (
        <p role="alert" className="px-3 py-2 text-xs text-red-400">
          {readStatusError}
        </p>
      ) : null}
      <div
        ref={setListScrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none"
      >
        {noSourcesConnected ? (
          <p className="px-3 py-3 text-[12px] text-content/50">
            {uiT("Add a connection to start using the Inbox.")}
          </p>
        ) : sourceError && visibleItems.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-content/50">{sourceError}</p>
        ) : loading && items.length === 0 ? (
          <div className="flex justify-center py-10 text-content/40">
            <LoaderCircle className="size-4 animate-spin" />
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-content/50">
            {narrowedByUser
              ? searchNarrowed
                ? isTrackerSource(source)
                  ? uiT("No matching {value0} issues", {
                      value0: String(INBOX_SOURCE_LABELS[source]),
                    })
                  : source === "gitlab"
                    ? uiT("No matching issues or merge requests")
                    : uiT("No matching issues or pull requests")
                : isTrackerSource(source)
                  ? uiT("No {value0} issues match these filters", {
                      value0: String(INBOX_SOURCE_LABELS[source]),
                    })
                  : source === "gitlab" || source === "azuredevops"
                    ? activeFilters.assignedToMe
                      ? uiT("Nothing needs your attention")
                      : source === "gitlab"
                        ? uiT("No GitLab items match these filters")
                        : uiT("No ADO items match these filters")
                    : uiT("No issues or pull requests match these filters")
              : isTrackerSource(source)
                ? uiT("No {value0} issues", {
                    value0: String(INBOX_SOURCE_LABELS[source]),
                  })
                : source === "gitlab"
                  ? projects.length === 0
                    ? uiT("Open a project to fill the inbox")
                    : uiT("No matching issues or merge requests")
                  : projects.length === 0
                    ? uiT("Open a project to fill the inbox")
                    : uiT("No matching issues or pull requests")}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5 p-1.5">
            {shownItems.map((item) => {
              const key = inboxItemKey(item);
              const projectId = projectKey(item.projectPath);
              const relatedSessions = relatedSessionsForInboxItem(
                item,
                sessions,
              );
              return (
                <li key={key}>
                  <InboxCard
                    item={item}
                    active={selected != null && key === inboxItemKey(selected)}
                    logoPath={resolveTabGroupLogo(projectId, logos)}
                    mascotName={resolveTabGroupMascot(projectId, groupMascots)}
                    mascotColor={resolveTabGroupColor(
                      projectId,
                      groupColors,
                      groupCustomColors,
                      projectName(item.projectPath),
                    )}
                    relatedSessionCount={relatedSessions.length}
                    onSelect={() => {
                      markInboxItemSeen({
                        key,
                        updatedAt: item.updatedAt,
                      });
                      setSelectedKey(key);
                    }}
                  />
                </li>
              );
            })}
            {hasMoreItems ? (
              <li ref={loadMoreRef} aria-hidden className="h-px list-none" />
            ) : null}
          </ul>
        )}
      </div>
      <ResizeHandle
        edge="right"
        dragging={resize.dragging}
        aria-label={uiT("Resize inbox list")}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
    </div>
  );

  const filtersPortal = filterMenu ? (
    <InboxFiltersMenu
      x={filterMenu.x}
      y={filterMenu.y}
      projects={projectOptions}
      linearProjects={linearProjects}
      linearTeams={linearTeams}
      hiddenLinearTeamIds={linearHiddenTeamIds}
      jiraProjects={jiraProjects}
      hiddenJiraProjectIds={jiraHiddenProjectIds}
      source={source}
      filters={activeFilters}
      onChange={onFiltersChange}
      onLinearTeamsChange={saveHiddenLinearTeamIds}
      onJiraProjectsChange={saveHiddenJiraProjectIds}
      onClose={() => setFilterMenu(null)}
    />
  ) : null;

  const connectPortal =
    connectMenuOpen && connectableSources.length > 0 ? (
      <InboxConnectMenu
        anchor={connectButtonRef}
        sources={connectableSources}
        onConnect={onOpenIntegrations}
        onClose={() => setConnectMenuOpen(false)}
      />
    ) : null;

  return (
    <div
      role="region"
      aria-label={uiT("Inbox")}
      data-app-inbox
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <AppPageHeader title={uiT("Inbox")} icon={Inbox} />

      <div className="flex min-h-0 min-w-0 flex-1">
        {list}
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <div className="min-h-0 min-w-0 flex-1 pl-4">
            <InboxDetailBody
              item={selected}
              cwd={cwd}
              projects={projectOptions}
              revision={refresh}
              relatedSessions={
                selected ? relatedSessionsForInboxItem(selected, sessions) : []
              }
              onDiscuss={() => setDiscussionOpen(true)}
              onStart={onStart}
              repairSessions={repairSessions}
              onRepairChecks={onRepairChecks}
              onOpenSession={onOpenSession}
              onItemChange={updateInboxItem}
            />
          </div>
          {discussionOpen && selected ? (
            <InboxDiscussionPanel
              onOpen={onAsk}
              onRestart={onAskRestart}
              onMount={onAskMount}
              key={inboxAskKey(selected)}
              item={selected}
              onClose={() => setDiscussionOpen(false)}
            />
          ) : null}
        </div>
      </div>
      <PresenceBoundary propagate>{filtersPortal}</PresenceBoundary>
      <PresenceBoundary propagate>{connectPortal}</PresenceBoundary>
    </div>
  );
}

function InboxDetailBody({
  item,
  cwd,
  projects,
  revision = 0,
  relatedSessions,
  onDiscuss,
  onStart,
  repairSessions,
  onRepairChecks,
  onOpenSession,
  onItemChange,
}: {
  item: InboxItem | null;
  cwd: string;
  projects: InboxProjectOption[];
  revision?: number;
  relatedSessions: readonly SessionSummary[];
  onDiscuss?: () => void;
  onStart?: (item: InboxItem, body?: string) => void | Promise<void>;
  repairSessions?: CiRepairProps["repairSessions"];
  onRepairChecks?: CiRepairProps["onRepairChecks"];
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  onItemChange?: (item: InboxItem) => void;
}) {
  const { t: uiT } = useTranslation();
  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Inbox className="mb-3 size-6 text-content/30" />
        <p className="text-[13px] text-content/45">
          {uiT("Select an inbox item")}
        </p>
      </div>
    );
  }
  return (
    <InboxDetail
      key={inboxItemKey(item)}
      item={item}
      cwd={cwd}
      projects={projects}
      revision={revision}
      relatedSessions={relatedSessions}
      onDiscuss={onDiscuss}
      onStart={onStart}
      repairSessions={repairSessions}
      onRepairChecks={onRepairChecks}
      onOpenSession={onOpenSession}
      onItemChange={onItemChange}
    />
  );
}
