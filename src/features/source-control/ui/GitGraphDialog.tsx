import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MENU_BAR_HEIGHT } from "../../../app/shell/MenuBar";
import { WINDOW_DRAG_BAR_HEIGHT } from "../../../app/shell/WindowChrome";
import { windowDragRegion } from "../../../app/shell/startWindowDrag";
import {
  gitHistory,
  subscribeGitChanged,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { prettyCwd } from "../../../shared/lib/paths";
import { IS_MAC } from "../../../platform/tauri/platform";
import { FolderTree, GitBranch, RefreshCw } from "../../../shared/ui/icons";
import {
  loadMenuBarVisible,
  subscribeMenuBarVisible,
} from "../../settings/model/settings";
import { AppViewDialog } from "../../workspace/ui/AppViewDialog";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { historyItemGraph, layoutGitGraph } from "../model/gitGraph";
import "./GitGraphDialog.css";

const HISTORY_PAGE_SIZE = 50;
const ROW_HEIGHT = 44;
const LANE_SCALE = 1.5;

export function GitGraphDialog({
  cwd,
  selectedSha,
  onClose,
  onOpenCommit,
}: {
  cwd: string;
  selectedSha?: string;
  onClose: () => void;
  onOpenCommit: (commit: GitHistoryCommit) => void;
}) {
  const { t, language } = useTranslation();
  const menuBarPinned =
    useSyncExternalStore(subscribeMenuBarVisible, loadMenuBarVisible) &&
    !IS_MAC;
  const { commits, loading, loadingMore, hasMore, error, reload, loadMore } =
    useGraphHistory(cwd);
  const worktrees = useProjectWorktrees(cwd);
  const contentRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const rows = useMemo(
    () => layoutGitGraph(commits).map(historyItemGraph),
    [commits],
  );
  const graphWidth = Math.max(64, ...rows.map((row) => row.width * LANE_SCALE));
  const treesByHead = useMemo(() => {
    const heads = new Map<string, string[]>();
    for (const tree of worktrees.data?.worktrees ?? []) {
      const names = heads.get(tree.head) ?? [];
      names.push(tree.path);
      heads.set(tree.head, names);
    }
    return heads;
  }, [worktrees.data]);
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    [language],
  );

  useEffect(() => {
    const panel = contentRef.current?.closest<HTMLElement>('[role="dialog"]');
    if (!panel) return;
    panel.querySelector<HTMLButtonElement>("[aria-label]")?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    panel.addEventListener("keydown", trapFocus);
    return () => panel.removeEventListener("keydown", trapFocus);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    // Match Settings: controls and popovers get to handle Escape first.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([reload(), worktrees.refresh()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AppViewDialog
      title={t("Git graph")}
      onClose={onClose}
      topInset={menuBarPinned ? MENU_BAR_HEIGHT : WINDOW_DRAG_BAR_HEIGHT}
    >
      <div
        ref={contentRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
      >
        <header
          {...windowDragRegion()}
          className="desktop-toolbar flex h-10 shrink-0 select-none items-center gap-2 border-b border-stroke px-3"
        >
          <GitBranch className="size-4 shrink-0 text-content/65" />
          <span className="shrink-0 text-[13px] font-medium">
            {t("Git graph")}
          </span>
          <span
            title={cwd}
            className="ml-2 min-w-0 flex-1 truncate text-ui-sm text-content/45"
          >
            {prettyCwd(cwd)}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || refreshing}
            aria-label={t("Refresh Git graph")}
            title={t("Refresh Git graph")}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-content/55 hover:bg-content/3 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-hover disabled:opacity-50"
          >
            <RefreshCw
              className={`size-3.5 ${loading || refreshing ? "motion-safe:animate-spin" : ""}`}
            />
          </button>
        </header>
        {error || worktrees.error ? (
          <p
            role="alert"
            className="shrink-0 border-b border-stroke px-4 py-2 text-ui-sm text-rose-400"
          >
            {error
              ? t("Could not load Git graph")
              : t("Could not load worktrees")}
            : {error || worktrees.error}
          </p>
        ) : null}
        <div
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
          aria-busy={loading || loadingMore}
          onScroll={({ currentTarget }) => {
            const remaining =
              currentTarget.scrollHeight -
              currentTarget.scrollTop -
              currentTarget.clientHeight;
            if (!error && remaining <= ROW_HEIGHT * 4) void loadMore();
          }}
        >
          <table
            className="git-graph-table w-full table-fixed border-collapse text-left text-ui-sm"
            style={{ minWidth: Math.max(820, graphWidth + 740) }}
          >
            <colgroup>
              <col style={{ width: graphWidth }} />
              <col />
              <col className="w-36" />
              <col className="w-32" />
              <col className="w-24" />
            </colgroup>
            <thead className="content-sticky sticky top-0 z-10 text-content/50">
              <tr>
                {["Graph", "Description", "Date", "Author", "Commit"].map(
                  (label) => (
                    <th
                      key={label}
                      scope="col"
                      className="h-10 border-b border-r border-stroke px-3 font-normal last:border-r-0"
                    >
                      {t(label)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {commits.map((commit, index) => {
                const graph = rows[index]!;
                const trees = treesByHead.get(commit.sha) ?? [];
                const date = new Date(commit.timestamp * 1000);
                const validDate =
                  commit.timestamp > 0 && Number.isFinite(date.getTime());
                const selected = commit.sha === selectedSha;
                return (
                  <tr
                    key={commit.sha}
                    onClick={() => onOpenCommit(commit)}
                    className={`git-history-item cursor-pointer ${commit.head ? "is-head" : ""} ${selected ? "is-selected bg-selection" : commit.head ? "bg-content/5" : "hover:bg-content/5"}`}
                    style={{ height: ROW_HEIGHT }}
                  >
                    <td className="border-r border-stroke p-0 align-middle">
                      <svg
                        aria-hidden
                        width={graph.width * LANE_SCALE}
                        height={ROW_HEIGHT}
                        className="git-history-graph pointer-events-none"
                      >
                        <g
                          transform={`scale(${LANE_SCALE},${ROW_HEIGHT / graph.height})`}
                        >
                          {graph.paths.map((path, i) => (
                            <path
                              key={i}
                              d={path.d}
                              fill="none"
                              stroke={path.color}
                              strokeWidth={1.5}
                              vectorEffect="non-scaling-stroke"
                              strokeLinecap="round"
                            />
                          ))}
                        </g>
                        {graph.circles.map((circle, i) => (
                          <circle
                            key={i}
                            cx={circle.cx * LANE_SCALE}
                            cy={(circle.cy * ROW_HEIGHT) / graph.height}
                            r={circle.r}
                            fill={circle.fill ?? "none"}
                            strokeWidth={circle.strokeWidth}
                          />
                        ))}
                      </svg>
                    </td>
                    <td className="px-3 py-0">
                      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                        {commit.head ? (
                          <span
                            className="git-graph-ref"
                            style={{ borderColor: graph.circleColor }}
                          >
                            HEAD
                          </span>
                        ) : null}
                        {commit.refs.map((ref) => (
                          <span
                            key={`${ref.kind}:${ref.name}`}
                            className="git-graph-ref"
                            title={ref.name}
                          >
                            <GitBranch className="size-3 shrink-0" />
                            <span data-code-label className="truncate">{ref.name}</span>
                          </span>
                        ))}
                        {trees.map((path) => (
                          <span
                            key={path}
                            className="git-graph-ref text-content/70"
                            title={t("Worktree: {path}", { path })}
                          >
                            <FolderTree className="size-3 shrink-0" />
                            <span data-file-label className="truncate">
                              {path
                                .replace(/\\/g, "/")
                                .split("/")
                                .filter(Boolean)
                                .at(-1) || path}
                            </span>
                          </span>
                        ))}
                        <button
                          type="button"
                          data-code-label
                          title={[commit.subject, commit.body]
                            .filter(Boolean)
                            .join("\n\n")}
                          className="min-w-20 flex-1 truncate rounded py-2 text-left text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-hover"
                        >
                          {commit.subject || commit.shortSha}
                        </button>
                      </div>
                    </td>
                    <td className="truncate px-3 py-0 tabular-nums text-content/50">
                      {validDate ? (
                        <time
                          dateTime={date.toISOString()}
                          title={date.toLocaleString(language)}
                        >
                          {dateFormat.format(date)}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      title={commit.author}
                      className="truncate px-3 py-0 text-content/50"
                    >
                      {commit.author || t("Unknown author")}
                    </td>
                    <td
                      title={commit.sha}
                      className="truncate px-3 py-0 font-mono text-content/50"
                    >
                      {commit.shortSha}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {commits.length === 0 ? (
            <p
              role="status"
              className="px-4 py-10 text-center text-ui-sm text-content/45"
            >
              {loading
                ? t("Loading…")
                : error
                  ? t("Could not load Git graph")
                  : t("No commits yet")}
            </p>
          ) : null}
          {hasMore ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loading || loadingMore}
              className="h-10 w-full text-center text-ui-sm text-content/45 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-hover disabled:opacity-50"
            >
              {loadingMore ? t("Loading…") : t("Load more commits")}
            </button>
          ) : null}
        </div>
      </div>
    </AppViewDialog>
  );
}

/** Keep loaded rows during requests; refresh the same depth in 50-row pages. */
function useGraphHistory(cwd: string) {
  const [state, setState] = useState<{
    cwd: string;
    head: string | null;
    commits: GitHistoryCommit[];
    offset: number;
    hasMore: boolean;
    loading: boolean;
    loadingMore: boolean;
    error?: string;
  }>({
    cwd,
    head: null,
    commits: [],
    offset: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
  });
  const current = useRef(state);
  const request = useRef(0);
  const publish = useCallback((next: typeof state) => {
    current.current = next;
    setState(next);
  }, []);
  const reload = useCallback(async () => {
    const id = ++request.current;
    const previous = current.current;
    const sameRepository = previous.cwd === cwd;
    const depth = sameRepository ? previous.offset : 0;
    publish({
      ...previous,
      cwd,
      commits: sameRepository ? previous.commits : [],
      offset: depth,
      hasMore: sameRepository && previous.hasMore,
      loading: true,
      loadingMore: false,
      error: undefined,
    });
    try {
      const commits: GitHistoryCommit[] = [];
      const seen = new Set<string>();
      let offset = 0;
      let head: string | null = null;
      let hasMore = true;
      do {
        const result = await gitHistory(cwd, HISTORY_PAGE_SIZE, true, offset);
        if (id !== request.current) return;
        // Do not splice pages from different HEADs if Git changes mid-refresh.
        // The next load will refresh again from the new tip.
        if (offset > 0 && result.head !== head) break;
        head = result.head;
        const added = result.commits.filter((commit) => {
          if (seen.has(commit.sha)) return false;
          seen.add(commit.sha);
          return true;
        });
        commits.push(...added);
        offset += result.commits.length;
        hasMore =
          result.commits.length === HISTORY_PAGE_SIZE && added.length > 0;
      } while (hasMore && offset < depth);
      publish({
        cwd,
        head,
        commits,
        offset,
        hasMore,
        loading: false,
        loadingMore: false,
      });
    } catch (error) {
      if (id === request.current)
        publish({
          ...current.current,
          loading: false,
          error: String(error),
        });
    }
  }, [cwd, publish]);
  const loadMore = useCallback(async () => {
    const previous = current.current;
    // The ref prevents repeated scroll events from starting duplicate pages.
    if (
      previous.cwd !== cwd ||
      previous.loading ||
      previous.loadingMore ||
      !previous.hasMore
    )
      return;
    const id = ++request.current;
    publish({ ...previous, loadingMore: true, error: undefined });
    try {
      const result = await gitHistory(
        cwd,
        HISTORY_PAGE_SIZE,
        true,
        previous.offset,
      );
      if (id !== request.current) return;
      if (result.head !== previous.head) {
        await reload();
        return;
      }
      const seen = new Set(previous.commits.map((commit) => commit.sha));
      const added = result.commits.filter((commit) => {
        if (seen.has(commit.sha)) return false;
        seen.add(commit.sha);
        return true;
      });
      publish({
        ...previous,
        commits: [...previous.commits, ...added],
        offset: previous.offset + result.commits.length,
        hasMore:
          result.commits.length === HISTORY_PAGE_SIZE && added.length > 0,
        loadingMore: false,
        error: undefined,
      });
    } catch (error) {
      if (id === request.current)
        publish({ ...previous, loadingMore: false, error: String(error) });
    }
  }, [cwd, publish, reload]);
  useEffect(() => {
    void reload();
    const resume = () => {
      if (!document.hidden) void reload();
    };
    const unsubscribe = subscribeGitChanged(resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      request.current += 1;
      unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [reload]);
  return {
    ...state,
    commits: state.cwd === cwd ? state.commits : [],
    reload,
    loadMore,
  };
}
