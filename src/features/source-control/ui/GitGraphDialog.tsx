import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  dataTableFeatures,
  type DataTableCell,
} from "../../../shared/ui/primitives/DataTable";
import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { useInfiniteQuery, useIsFetching } from "@tanstack/react-query";
import {
  queryClient,
  invalidateAfterChange,
} from "../../../shared/lib/queryClient";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { gitKeys } from "../model/gitQueries";
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

const graphColumn = createColumnHelper<
  typeof dataTableFeatures,
  GitHistoryCommit
>();
const GRAPH_COLUMNS = [
  "Graph",
  "Description",
  "Date",
  "Author",
  "Commit",
] as const;

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
  const fetchingWorktrees = useIsFetching(
    { queryKey: gitKeys.worktrees(pathKey(cwd)) },
    queryClient,
  );
  const refreshing = loading || fetchingWorktrees > 0;
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
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([tabindex="-1"]), [tabindex="0"]',
        ),
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

  const columns = useMemo(
    () =>
      GRAPH_COLUMNS.map((label, index) =>
        graphColumn.display({
          id: label,
          header: t(label),
          meta: {
            className: [
              "border-r border-stroke p-0 align-middle",
              "px-3 py-0",
              "truncate px-3 py-0 tabular-nums text-content/50",
              "truncate px-3 py-0 text-content/50",
              "truncate px-3 py-0 font-mono text-content/50",
            ][index],
          },
        }),
      ),
    [t],
  );
  const renderCell = (cell: DataTableCell<GitHistoryCommit>) => {
    const commit = cell.row.original;
    const index = cell.row.index;
    const graph = rows[index]!;
    const trees = treesByHead.get(commit.sha) ?? [];
    const date = new Date(commit.timestamp * 1000);
    const validDate = commit.timestamp > 0 && Number.isFinite(date.getTime());

    switch (cell.column.id) {
      case "Graph":
        return (
          <>
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
          </>
        );
      case "Description":
        return (
          <>
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
                  <span data-code-label className="truncate">
                    {ref.name}
                  </span>
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
              <Button
                variant="ghost"
                size="content"
                tabIndex={-1}
                data-code-label
                title={[commit.subject, commit.body]
                  .filter(Boolean)
                  .join("\n\n")}
                className="min-w-20 flex-1 truncate rounded py-2 text-left text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-hover justify-start"
              >
                {commit.subject || commit.shortSha}
              </Button>
            </div>
          </>
        );
      case "Date":
        return (
          <>
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
          </>
        );
      case "Author":
        return (
          <>
            <span title={commit.author}>
              {commit.author || t("Unknown author")}
            </span>
          </>
        );
      case "Commit":
        return (
          <>
            <span title={commit.sha}>{commit.shortSha}</span>
          </>
        );
      default:
        return null;
    }
  };

  const refresh = () => Promise.all([reload(), worktrees.refresh()]);

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
          className="desktop-toolbar git-graph-toolbar flex h-10 shrink-0 select-none items-center gap-2 border-b border-stroke pl-3 pr-14"
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
          <Button
            variant="ghost"
            size="content"
            type="button"
            onClick={() => void refresh()}
            disabled={loading || refreshing}
            aria-label={t("Refresh Git graph")}
            title={t("Refresh Git graph")}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-content/55 hover:bg-content/3 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-hover disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                loading || refreshing ? "motion-safe:animate-spin" : "",
              )}
            />
          </Button>
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
          className="flex min-h-0 flex-1 flex-col"
          aria-busy={loading || loadingMore}
        >
          <DataTable
            label={t("Git graph")}
            data={commits}
            columns={columns}
            getRowId={(commit) => commit.sha}
            estimateRowHeight={ROW_HEIGHT}
            containerClassName="min-h-0 max-h-none flex-1 overflow-auto overscroll-contain"
            className="git-graph-table w-full table-fixed border-collapse text-left text-ui-sm"
            style={{ minWidth: Math.max(820, graphWidth + 740) }}
            headerClassName="content-sticky text-content/50"
            headClassName="h-10 border-b border-r border-stroke px-3 font-normal text-inherit last:border-r-0"
            rowProps={({ original: commit }) => ({
              tabIndex: 0,
              "aria-label": t("Open commit {sha}: {subject}", {
                sha: commit.shortSha,
                subject: commit.subject,
              }),
              "aria-current": commit.sha === selectedSha ? "true" : undefined,
              onClick: () => onOpenCommit(commit),
              onKeyDown: (event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  onOpenCommit(commit);
                }
              },
              className: cn(
                "git-history-item cursor-pointer border-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-hover active:bg-content/10",
                commit.head && "is-head",
                commit.sha === selectedSha
                  ? "is-selected bg-selection"
                  : commit.head
                    ? "bg-content/5"
                    : "hover:bg-content/5",
              ),
              style: { height: ROW_HEIGHT },
            })}
            renderCell={renderCell}
            onScroll={({ currentTarget }) => {
              const remaining =
                currentTarget.scrollHeight -
                currentTarget.scrollTop -
                currentTarget.clientHeight;
              if (!error && remaining <= ROW_HEIGHT * 4) void loadMore();
            }}
          >
            <colgroup>
              <col style={{ width: graphWidth }} />
              <col />
              <col className="w-36" />
              <col className="w-32" />
              <col className="w-24" />
            </colgroup>
          </DataTable>
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
            <Button
              variant="ghost"
              size="content"
              type="button"
              onClick={() => void loadMore()}
              disabled={loading || loadingMore}
              className="h-10 w-full text-center text-ui-sm text-content/45 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-hover disabled:opacity-50"
            >
              {loadingMore ? t("Loading…") : t("Load more commits")}
            </Button>
          ) : null}
        </div>
      </div>
    </AppViewDialog>
  );
}

/** Query retains the loaded depth and serializes page reads across refreshes. */
function useGraphHistory(cwd: string) {
  // This paged query owns its cancellation barrier for Git events.
  const queryKey = ["gitGraphHistory", cwd] as const;
  const history = useInfiniteQuery(
    {
      queryKey,
      refetchOnWindowFocus: false,
      initialPageParam: { offset: 0, head: null as string | null },
      queryFn: async ({ pageParam, signal }) => {
        const result = await gitHistory(
          cwd,
          HISTORY_PAGE_SIZE,
          true,
          pageParam.offset,
        );
        signal.throwIfAborted();
        const moved = pageParam.offset > 0 && result.head !== pageParam.head;
        return { ...result, commits: moved ? [] : result.commits, moved };
      },
      getNextPageParam: (last, pages) => {
        const offset = pages.reduce(
          (sum, page) => sum + page.commits.length,
          0,
        );
        const seen = new Set(
          pages
            .slice(0, -1)
            .flatMap((page) => page.commits.map((commit) => commit.sha)),
        );
        if (
          last.moved ||
          (last.commits.length === HISTORY_PAGE_SIZE &&
            last.commits.some((commit) => !seen.has(commit.sha)))
        )
          return { offset, head: pages[0].head };
        return undefined;
      },
    },
    queryClient,
  );
  const reload = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey });
    await invalidateAfterChange(queryKey);
  }, [cwd]);
  const loadMore = useCallback(async () => {
    if (queryClient.isFetching({ queryKey }) || !history.hasNextPage) return;
    const previous = queryClient.getQueryData(queryKey);
    const next = await history.fetchNextPage({ cancelRefetch: false });
    if (next.data?.pages.at(-1)?.moved) {
      queryClient.setQueryData(queryKey, previous);
      await reload();
    }
  }, [cwd, history.hasNextPage, history.fetchNextPage, reload]);
  useEffect(() => {
    const resume = () => {
      if (!document.hidden) void reload();
    };
    const unsubscribe = subscribeGitChanged(resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [reload]);
  const commits = useMemo(() => {
    const seen = new Set<string>();
    return (
      history.data?.pages
        .flatMap((page) => page.commits)
        .filter((commit) => {
          if (seen.has(commit.sha)) return false;
          seen.add(commit.sha);
          return true;
        }) ?? []
    );
  }, [history.data]);
  return {
    commits,
    loading:
      history.isPending || (history.isFetching && !history.isFetchingNextPage),
    loadingMore: history.isFetchingNextPage,
    hasMore: history.hasNextPage,
    error: history.error ? String(history.error) : undefined,
    reload,
    loadMore,
  };
}
