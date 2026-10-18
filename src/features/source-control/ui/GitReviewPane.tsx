// Adapted from ZCode (Apache-2.0).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  measureElement as measureRow,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  basename,
  gitDiscardFile,
  gitStageContents,
  gitStageFile,
  gitUnstageFile,
  notifyGitChanged,
} from "../../../platform/tauri/fs";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useInlineBreakpoints } from "../../../shared/hooks/useInlineBreakpoints";
import { isEqualOrInside } from "../../../shared/lib/paths";
import {
  AlertCircle,
  FileDiff,
  FoldVertical,
  FolderTree,
  Loader,
  RefreshCw,
  UnfoldVertical,
  X,
} from "../../../shared/ui/icons";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { useReviewSource } from "../model/useReviewSource";
import {
  estimateReviewBodyHeight,
  reviewCommit,
  type ReviewDiffState,
  type ReviewFile,
  type ReviewSource,
} from "../model/reviewDiff";
import { stageChunkText } from "../../connections/files/editor/editorGit";
import { LINE_DIFF_CONFIG } from "../model/lineDiff";
import { GitReviewChangeCard, ReviewIconButton } from "./GitReviewChangeCard";
import { ReviewDiffsWorkerPool } from "./ReviewDiffsWorkerPool";
import { ReviewSourceSelect } from "./ReviewSourceSelect";
import "./GitReviewPane.css";

export type GitReviewPaneProps = {
  cwd: string;
  sessionId?: string;
  initialSource?: ReviewSource;
  /** Commit tabs keep their comparison fixed to the commit named in the tab. */
  commit?: string;
  focusPath?: string;
};

const COLLAPSED_ROW_HEIGHT = 32;
/** Loading placeholders reserve at most this much, enough to fill a viewport. */
const MAX_PLACEHOLDER_HEIGHT = 640;
/** Covers the open animation plus the first diff loads after Expand all. */
const BULK_EXPAND_MS = 1000;
const REVIEW_WIDTH_BREAKPOINTS = [36] as const;

export function GitReviewPane({
  cwd,
  sessionId,
  initialSource = "unstaged",
  commit,
  focusPath,
}: GitReviewPaneProps) {
  const { t } = useTranslation();
  const measureWidth = useInlineBreakpoints(REVIEW_WIDTH_BREAKPOINTS, "rem");
  const { data: worktrees } = useProjectWorktrees(cwd);
  // A linked worktree can live inside the main checkout; match the deepest root.
  const worktree = useMemo(
    () => worktrees?.worktrees
      .filter((tree) => isEqualOrInside(cwd, tree.path))
      .sort((a, b) => b.path.length - a.path.length)[0],
    [cwd, worktrees],
  );
  const gitAvailable = !!worktrees?.worktrees.length;
  const [selectedSource, setSource] = useState<ReviewSource>(initialSource);
  const source: ReviewSource = commit
    ? `commit:${commit}`
    : sessionId && !gitAvailable
      ? "session"
      : selectedSource;
  const { scopeKey, files, error, loading, workspaceShared, loadDiff, getDiff, refresh } =
    useReviewSource(cwd, source, sessionId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const [actionError, setActionError] = useState<string>();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const focusHandled = useRef<string | undefined>(undefined);
  const rows = files ?? [];
  const bulkExpandUntil = useRef(0);
  const bulkAnchor = useRef<number | undefined>(undefined);
  const expandedCommits = useRef(new Set<string>());
  // Rows opened by a click are mounted and measured as they grow. A collapsed
  // row matches its estimate, so TanStack has no cached size for it; switching
  // to the expanded estimate would open a blank gap that the first measurement
  // snaps shut, then grow again.
  const measuredOpen = useRef(new Set<string>());
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getItemKey: (index: number) => `${scopeKey}:${rows[index].relative}`,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index: number) => {
      const file = rows[index];
      const id = `${scopeKey}:${file.relative}`;
      return expanded.has(id) && !measuredOpen.current.has(id)
        ? COLLAPSED_ROW_HEIGHT +
            estimateReviewBodyHeight(file, getDiff(file.relative))
        : COLLAPSED_ROW_HEIGHT;
    },
    // Expanded rows can contain entire files. Keep one neighbour ready for
    // scrolling without rewrapping two offscreen files on each side.
    overscan: expanded.size ? 1 : 6,
    measureElement: (
      element: HTMLDivElement,
      entry: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
    ) => {
      const height = measureRow(element, entry, instance);
      if (performance.now() > bulkExpandUntil.current) return height;
      // After Expand all, count an opening card at its final height. Its animated
      // height would otherwise pull every following row into view, each of which
      // then loads and renders a diff only to be pushed back out.
      const item = element.querySelector<HTMLElement>(
        '.zen-fold-item[data-fold-state="opening"]',
      );
      const body = item?.firstElementChild;
      if (!item || !body) return height;
      return Math.max(
        height,
        height -
          item.getBoundingClientRect().height +
          body.getBoundingClientRect().height,
      );
    },
    useAnimationFrameWithResizeObserver: true,
  });
  useLayoutEffect(() => {
    // Historical reviews open their files by default. Mounting and content
    // loading remain virtualized, and refresh must preserve manual folding.
    if (
      !reviewCommit(source) ||
      !files?.length ||
      expandedCommits.current.has(scopeKey)
    )
      return;
    expandedCommits.current.add(scopeKey);
    bulkExpandUntil.current = performance.now() + BULK_EXPAND_MS;
    measuredOpen.current.clear();
    virtualizer.measure();
    setExpanded((current) =>
      new Set([...current, ...files.map((file) => `${scopeKey}:${file.relative}`)]),
    );
  }, [files, scopeKey, source, virtualizer]);
  const virtualRows = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    const mounted = new Set(virtualRows.map((row) => row.index));
    rows.forEach((file, index) => {
      // ResizeObserver tracks mounted cards throughout both animations. Closed
      // offscreen cards have no observer: discard their cached expanded height
      // without resetting the measurements of cards that are still closing.
      if (!mounted.has(index) && !expanded.has(`${scopeKey}:${file.relative}`))
        virtualizer.resizeItem(index, COLLAPSED_ROW_HEIGHT);
    });
  }, [expanded, rows, scopeKey, virtualRows, virtualizer]);
  useLayoutEffect(() => {
    const anchor = bulkAnchor.current;
    if (anchor === undefined) return;
    bulkAnchor.current = undefined;
    if (anchor > 0) virtualizer.scrollToIndex(anchor, { align: "start" });
  }, [expanded, virtualizer]);
  const focusIndex = rows.findIndex(
    (file) => file.path === focusPath || file.relative === focusPath,
  );
  useEffect(() => {
    if (focusIndex < 0 || !focusPath) return;
    const request = `${scopeKey}:${focusPath}`;
    if (focusHandled.current === request) return;
    focusHandled.current = request;
    const relative = rows[focusIndex].relative;
    setExpanded((current) => new Set(current).add(`${scopeKey}:${relative}`));
    loadDiff(relative);
    virtualizer.scrollToIndex(focusIndex, { align: "start" });
  }, [focusIndex, focusPath, scopeKey, rows, loadDiff, virtualizer]);

  const reportError = useCallback(
    (caught: unknown) =>
      setActionError(caught instanceof Error ? caught.message : String(caught)),
    [],
  );
  const runAction = async (
    file: ReviewFile,
    operation: () => Promise<void>,
  ) => {
    const id = `${scopeKey}:${file.relative}`;
    if (busyRef.current.has(id)) return;
    busyRef.current.add(id);
    setBusy(new Set(busyRef.current));
    setActionError(undefined);
    try {
      await operation();
      notifyGitChanged();
    } catch (caught) {
      reportError(caught);
    } finally {
      busyRef.current.delete(id);
      setBusy(new Set(busyRef.current));
    }
  };
  // Cards are memoized; route their callbacks through the latest render state.
  const latest = useRef({
    cwd,
    source,
    scopeKey,
    expanded,
    getDiff,
    runAction,
  });
  latest.current = { cwd, source, scopeKey, expanded, getDiff, runAction };
  const toggleFile = useCallback((file: ReviewFile) => {
    const id = `${latest.current.scopeKey}:${file.relative}`;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (latest.current.expanded.has(id)) measuredOpen.current.delete(id);
    else measuredOpen.current.add(id);
  }, []);
  const performFileAction = useCallback(
    (file: ReviewFile, action: "stage" | "unstage" | "discard") => {
      const { cwd, runAction } = latest.current;
      void runAction(file, () =>
        action === "stage"
          ? gitStageFile(cwd, file.relative)
          : action === "unstage"
            ? gitUnstageFile(cwd, file.relative)
            : gitDiscardFile(cwd, file.relative),
      );
    },
    [],
  );
  const stageHunk = useCallback(
    (file: ReviewFile, diffState: ReviewDiffState | undefined, pos: number) => {
      const { cwd, source, getDiff, runAction } = latest.current;
      // Use the snapshot that produced this annotation, never a newer
      // response with a different chunk at the same character offset.
      if (
        source !== "unstaged" ||
        diffState?.state !== "loaded" ||
        getDiff(file.relative) !== diffState
      )
        return;
      const next = stageChunkText(
        diffState.diff.original,
        diffState.diff.current,
        pos,
        null,
        LINE_DIFF_CONFIG,
      );
      if (next != null)
        void runAction(file, () => gitStageContents(cwd, file.relative, next));
    },
    [],
  );
  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, file) => {
          const state = getDiff(file.relative);
          const diff = state?.state === "loaded" ? state.diff.unified : null;
          return {
            additions: sum.additions + (diff?.additions ?? file.additions),
            deletions: sum.deletions + (diff?.deletions ?? file.deletions),
          };
        },
        { additions: 0, deletions: 0 },
      ),
    [rows, getDiff],
  );

  const counts = (
    <span className="review-total-counts ml-1 flex shrink-0 gap-0.5 tabular-nums">
      <span className="text-[var(--review-added)]">
        +{totals.additions.toLocaleString()}
      </span>
      <span className="text-[var(--review-removed)]">
        -{totals.deletions.toLocaleString()}
      </span>
    </span>
  );

  return (
    <ReviewDiffsWorkerPool>
      <section
        ref={measureWidth}
        className="git-review-pane content-surface flex h-full min-h-0 min-w-0 flex-col"
        data-git-review-pane
      >
        <div className="review-toolbar flex shrink-0 items-center justify-between gap-1 p-1">
          {worktree && !worktree.isMain ? (
            <span
              className="git-review-worktree flex h-6 min-w-0 max-w-48 items-center gap-1.5 text-ui-base text-foreground-subtle"
              title={t("Worktree: {path}", { path: worktree.path })}
            >
              <FolderTree className="size-3.5 shrink-0" />
              <span className="truncate">{basename(worktree.path)}</span>
            </span>
          ) : null}
          {commit ? (
            <div
              className="review-commit-label flex h-6 min-w-0 items-center gap-1.5"
              title={commit}
            >
              <span className="text-foreground-subtle">{t("Committed")}</span>
              <span className="font-mono text-content">{commit.slice(0, 7)}</span>
              {counts}
            </div>
          ) : (
            <ReviewSourceSelect
              cwd={cwd}
              value={source}
              sessionId={sessionId}
              gitAvailable={gitAvailable}
              onChange={(next) => {
                setSource(next);
                setActionError(undefined);
              }}
              trailing={counts}
            />
          )}
          <div className="review-toolbar-actions ml-auto flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-foreground-subtle outline-none hover:bg-surface-hover focus-visible:bg-surface-hover disabled:opacity-40"
              title={t("Expand all")}
              aria-label={t("Expand all")}
              disabled={!rows.length}
              onClick={() => {
                const scroller = scrollerRef.current;
                const offset = scroller?.scrollTop ?? 0;
                bulkAnchor.current = virtualizer
                  .getVirtualItems()
                  .find((row) => row.end > offset)?.index;
                bulkExpandUntil.current = performance.now() + BULK_EXPAND_MS;
                measuredOpen.current.clear();
                // One cache reset re-estimates every row as expanded, so only the
                // cards that fit the viewport mount, load and render.
                virtualizer.measure();
                setExpanded(
                  (current) =>
                    new Set([
                      ...current,
                      ...rows.map((file) => `${scopeKey}:${file.relative}`),
                    ]),
                );
              }}
            >
              <UnfoldVertical className="size-3.5" />
            </button>
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-foreground-subtle outline-none hover:bg-surface-hover focus-visible:bg-surface-hover disabled:opacity-40"
              title={t("Collapse all")}
              aria-label={t("Collapse all")}
              disabled={!rows.length}
              onClick={() => {
                setExpanded(
                  (current) =>
                    new Set(
                      [...current].filter(
                        (id) => !id.startsWith(`${scopeKey}:`),
                      ),
                    ),
                );
              }}
            >
              <FoldVertical className="size-3.5" />
            </button>
            <button
              type="button"
              title={t("Refresh changes")}
              aria-label={t("Refresh changes")}
              disabled={loading}
              onClick={() => refresh()}
              className="flex h-8 items-center gap-2 rounded-lg px-3 text-ui-base text-content transition-colors hover:bg-surface-hover disabled:opacity-40 motion-reduce:transition-none"
            >
              <RefreshCw
                className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
        {actionError ? (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-content/8 px-3 py-2 text-[12px] text-red-400"
          >
            <span className="flex-1">{actionError}</span>
            <ReviewIconButton
              title={t("Dismiss error")}
              onClick={() => setActionError(undefined)}
            >
              <X className="size-3" />
            </ReviewIconButton>
          </div>
        ) : null}
        {workspaceShared ? (
          <p className="px-3 py-2 text-[11px] text-content/60">
            {t("Other sessions were active in this workspace. These changes may include their edits; undo is disabled.")}
          </p>
        ) : null}
        <div
          ref={scrollerRef}
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
        >
          {!cwd || cwd === "~" ? (
            <Empty>{t("No project folder")}</Empty>
          ) : error ? (
            <Empty icon={<AlertCircle className="size-5" />}>
              <span>{t("Couldn’t load changes")}</span>
              <span className="text-content/45">{error}</span>
            </Empty>
          ) : files == null ? (
            <Empty icon={<Loader className="size-4 animate-spin" />}>
              {t("Loading…")}
            </Empty>
          ) : !rows.length ? (
            <Empty icon={<FileDiff className="size-6" />}>
              {source === "session"
                ? t("No session changes")
                : source === "staged"
                  ? t("No staged changes")
                  : source === "unstaged"
                    ? t("No unstaged changes")
                    : source === "uncommitted"
                      ? t("No uncommitted changes")
                      : source === "branch"
                        ? t("No changes on this branch")
                        : t("No changes in this commit")}
            </Empty>
          ) : (
            <div
              className="relative w-full min-w-0"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualRows.map((row) => {
                const file = rows[row.index];
                const id = `${scopeKey}:${file.relative}`;
                const diffState = getDiff(file.relative);
                return (
                  <div
                    key={row.key}
                    ref={virtualizer.measureElement}
                    data-index={row.index}
                    className="absolute left-0 w-full min-w-0"
                    style={{ top: row.start }}
                  >
                    <GitReviewChangeCard
                      file={file}
                      source={source}
                      expanded={expanded.has(id)}
                      focused={focusIndex === row.index}
                      busy={busy.has(id)}
                      diffState={diffState}
                      placeholderHeight={measuredOpen.current.has(id) ? undefined : Math.min(
                        MAX_PLACEHOLDER_HEIGHT,
                        estimateReviewBodyHeight(file, diffState),
                      )}
                      loadDiff={loadDiff}
                      onError={reportError}
                      onToggle={toggleFile}
                      onAction={performFileAction}
                      onStageHunk={stageHunk}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </ReviewDiffsWorkerPool>
  );
}

function Empty({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 px-6 text-center text-ui-base text-foreground-subtle">
      {icon}
      {children}
    </div>
  );
}
