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
import { motion } from "motion/react";
import { Virtualizer as DiffVirtualizer } from "@pierre/diffs";
import { VirtualizerContext as DiffVirtualizerContext } from "@pierre/diffs/react";
import {
  basename,
  gitDiscardFile,
  gitStageContents,
  gitStageFile,
  gitUnstageFile,
  notifyGitChanged,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import { useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import { duration, immediateTransition } from "../../../shared/motion/tokens";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useInlineBreakpoints } from "../../../shared/hooks/useInlineBreakpoints";
import { isEqualOrInside } from "../../../shared/lib/paths";
import { AlertCircle, Check, FileDiff, FolderTree, ListBullet, MoreVertical, Search, X } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../shared/ui/primitives/DropdownMenu";
import { usePreferenceState } from "../../settings/model/usePreferenceState";
import {
  loadReviewViewOptions,
  saveReviewViewOptions,
  type ReviewViewOptions,
} from "../model/reviewViewOptions";
import { ReviewViewOptionsContext } from "./ReviewViewOptionsContext";
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
import { BranchPicker } from "./BranchPicker";
import { GitChangesPanel } from "./GitChangesPanel";
import { GitReviewChangeCard, ReviewFileIcon, ReviewIconButton } from "./GitReviewChangeCard";
import { ReviewDiffsWorkerPool } from "./ReviewDiffsWorkerPool";
import { ReviewSourceSelect } from "./ReviewSourceSelect";
import "./GitReviewPane.css";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

export type GitReviewPaneProps = {
  cwd: string;
  sessionId?: string;
  turnId?: string;
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
/** Below this width (rem) source control would crowd the diffs, so it folds away. */
const RAIL_MIN_REVIEW_WIDTH = 32;
const REVIEW_WIDTH_BREAKPOINTS = [36, RAIL_MIN_REVIEW_WIDTH] as const;
/** The source-control rail stays as the reader last left it across reviews. */
let railOpen = true;

export function GitReviewPane({
  cwd,
  sessionId,
  turnId,
  initialSource = "unstaged",
  commit,
  focusPath,
}: GitReviewPaneProps) {
  const { t } = useTranslation();
  // A narrow review folds source control away without forgetting the reader's
  // choice; the toggle can still bring it back until the width changes again.
  const [narrow, setNarrow] = useState(false);
  const [narrowRail, setNarrowRail] = useState(false);
  // Only the first measurement places the rail without animating; every later
  // fold, from the width or the toggle, animates both ways.
  const classified = useRef(false);
  const [snapRail, setSnapRail] = useState(false);
  useEffect(() => {
    if (snapRail) setSnapRail(false);
  }, [snapRail]);
  const measureWidth = useInlineBreakpoints(
    REVIEW_WIDTH_BREAKPOINTS,
    "rem",
    true,
    useCallback((below: readonly number[]) => {
      setNarrow(below.includes(RAIL_MIN_REVIEW_WIDTH));
      setNarrowRail(false);
      if (!classified.current) {
        classified.current = true;
        setSnapRail(true);
      }
    }, []),
  );
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
  // Reviews of a checkout carry source control beside the diffs: commit,
  // sync, the changed files and history. Commit tabs stay diff-only, and a
  // session review shows it only where there is Git to act on.
  const rail = !commit && (!sessionId || gitAvailable);
  const [railPreferred, setRailExpanded] = useState(railOpen);
  const railExpanded = narrow ? narrowRail : railPreferred;
  const railVisible = rail && railExpanded;
  // File height observations rerender this pane throughout a disclosure. Keep
  // the source-control panel's props stable so its full file tree stays idle.
  const railBranchControl = useMemo(
    () => <BranchPicker cwd={cwd} enabled={railVisible} popoverSide="bottom" />,
    [cwd, railVisible],
  );
  const railMotion = useCollapseMotion(railVisible, duration.panel * 1000);
  /** A file picked in the rail; it takes over from the tab's own focus. */
  const [jump, setJump] = useState<{ path: string; seq: number }>();
  const source: ReviewSource = commit
    ? `commit:${commit}`
    : sessionId && !gitAvailable
      ? "session"
      : selectedSource;
  const { scopeKey, files, error, loading, workspaceShared, loadDiff, getDiff, refresh } =
    useReviewSource(cwd, source, sessionId, turnId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const [actionError, setActionError] = useState<string>();
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Reuse the review's scroll box for line virtualization as well as file
  // virtualization. Expanded files keep their rich rendering without making
  // every offscreen syntax token participate in each divider resize.
  const [diffVirtualizer] = useState(() => new DiffVirtualizer({
    overscrollSize: 200,
    intersectionObserverMargin: 400,
  }));
  const attachScroller = useCallback((element: HTMLDivElement | null) => {
    scrollerRef.current = element;
    if (element) diffVirtualizer.setup(element);
    else diffVirtualizer.cleanUp();
  }, [diffVirtualizer]);
  const focusHandled = useRef<string | undefined>(undefined);
  const [viewOptions, setViewOptions] = usePreferenceState(loadReviewViewOptions);
  const toggleViewOption = (key: keyof ReviewViewOptions) =>
    setViewOptions((current) => {
      const next = { ...current, [key]: !current[key] };
      saveReviewViewOptions(next);
      return next;
    });
  const rows = useMemo(() => files ?? [], [files]);
  // Search jumps to one changed file; it never narrows the review itself.
  const fileOptions = useMemo(
    () => rows.map((file) => {
      const slash = file.relative.lastIndexOf("/");
      return {
        value: file.relative,
        label: file.relative.slice(slash + 1),
        detail: slash > 0 ? file.relative.slice(0, slash) : undefined,
        keywords: file.relative,
        icon: <ReviewFileIcon relative={file.relative} />,
        trailing: (
          // The panel is portaled outside the review, so use the theme's colors.
          <span className="review-search-counts flex shrink-0 gap-1 tabular-nums">
            <span className="text-[var(--color-success)]">+{file.additions}</span>
            <span className="text-[var(--color-danger)]">-{file.deletions}</span>
          </span>
        ),
      };
    }),
    [rows],
  );
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
  const target = jump?.path ?? focusPath;
  const focusIndex = rows.findIndex(
    (file) => file.path === target || file.relative === target,
  );
  useEffect(() => {
    if (focusIndex < 0 || !target) return;
    const request = `${scopeKey}:${target}:${jump?.seq ?? 0}`;
    if (focusHandled.current === request) return;
    focusHandled.current = request;
    const relative = rows[focusIndex].relative;
    setExpanded((current) => new Set(current).add(`${scopeKey}:${relative}`));
    loadDiff(relative);
    virtualizer.scrollToIndex(focusIndex, { align: "start" });
  }, [focusIndex, target, jump, scopeKey, rows, loadDiff, virtualizer]);

  const toggleRail = () => {
    if (narrow) {
      setNarrowRail(!railExpanded);
      return;
    }
    railOpen = !railExpanded;
    setRailExpanded(railOpen);
  };
  const showSource = useCallback((next: ReviewSource) => {
    setSource(next);
    setActionError(undefined);
  }, []);
  const openRailFile = useCallback((path: string, kind: GitFileDiffKind) => {
    showSource(kind);
    setJump((current) => ({ path, seq: (current?.seq ?? 0) + 1 }));
  }, [showSource]);
  const openRailCommit = useCallback(
    (picked: GitHistoryCommit) => showSource(`commit:${picked.sha}`),
    [showSource],
  );

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
  const expandAll = () => {
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
  };
  const collapseAll = () =>
    setExpanded(
      (current) =>
        new Set([...current].filter((id) => !id.startsWith(`${scopeKey}:`))),
    );
  const toolbarButton =
    "review-toolbar-action grid size-8 shrink-0 place-items-center rounded-lg text-foreground-subtle outline-none hover:bg-surface-hover focus-visible:bg-surface-hover aria-pressed:bg-surface-hover aria-pressed:text-content aria-expanded:bg-surface-hover disabled:opacity-40";
  const checkItem = (label: string, checked: boolean, onToggle: () => void) => (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      onSelect={(event) => {
        event.preventDefault();
        onToggle();
      }}
    >
      <span className="flex-1">{label}</span>
      <Check className={`size-3.5 ${checked ? "" : "invisible"}`} />
    </DropdownMenuItem>
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
      <ReviewViewOptionsContext.Provider value={viewOptions}>
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
                onChange={showSource}
                trailing={counts}
              />
            )}
            <div className="review-toolbar-actions ml-auto flex min-w-0 shrink items-center gap-0.5">
              <SearchableSelect
                variant="icon"
                label={t("Search changed files")}
                value=""
                options={fileOptions}
                onChange={(relative) =>
                  setJump((current) => ({ path: relative, seq: (current?.seq ?? 0) + 1 }))}
                disabled={!rows.length}
                triggerIcon={<Search className="size-3.5" />}
                triggerClassName={toolbarButton}
                searchPlaceholder={t("Search changed files")}
                emptyLabel={t("No matching files")}
                checkPosition="end"
                side="bottom"
                align="before"
                gap={0}
                width={320}
                maxHeight={440}
                limit={12}
                overflowLabel={(hidden) =>
                  t("{count} more files. Keep typing to narrow.", { count: hidden })}
                menuClassName="review-file-search"
              />
              {rail ? (
                <button
                  type="button"
                  title={railExpanded ? t("Hide source control") : t("Show source control")}
                  aria-label={railExpanded ? t("Hide source control") : t("Show source control")}
                  aria-pressed={railExpanded}
                  data-review-rail-toggle
                  onClick={toggleRail}
                  className={toolbarButton}
                >
                  <ListBullet className="size-3.5" />
                </button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={toolbarButton}
                    title={t("Review options")}
                    aria-label={t("Review options")}
                    data-review-options
                  >
                    <MoreVertical className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" aria-label={t("Review options")}>
                  {rail ? (
                    <>
                      {checkItem(t("Show source control"), railExpanded, toggleRail)}
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <DropdownMenuItem disabled={!rows.length} onSelect={collapseAll}>
                    {t("Collapse all files")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!rows.length} onSelect={expandAll}>
                    {t("Expand all files")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {checkItem(t("Side by side"), viewOptions.sideBySide, () => toggleViewOption("sideBySide"))}
                  {checkItem(t("Word wrap"), viewOptions.wordWrap, () => toggleViewOption("wordWrap"))}
                  {checkItem(t("Highlight changed words"), viewOptions.highlightWords, () => toggleViewOption("highlightWords"))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={loading} onSelect={() => refresh()}>
                    {t("Refresh")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <motion.div
            {...railMotion.motionProps}
            transition={snapRail ? immediateTransition : railMotion.motionProps.transition}
            animate={{
              gridTemplateColumns: !rail
                ? "minmax(0, 1fr)"
                : railVisible
                  ? "minmax(0, 1fr) var(--review-rail-width)"
                  : "minmax(0, 1fr) 0px",
            }}
            data-fold-state={rail ? railMotion.foldState : undefined}
            className="review-body animated-collapse-size grid min-h-0 flex-1"
          >
            <div className="flex min-h-0 min-w-0 flex-col">
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
              <DiffVirtualizerContext.Provider value={diffVirtualizer}>
                <div
                  ref={attachScroller}
                  data-review-scroll
                  className="min-h-0 flex-1 overflow-auto overscroll-contain"
                >
                  <div data-review-content className="min-w-0">
                    {!cwd || cwd === "~" ? (
                      <Empty>{t("No project folder")}</Empty>
                    ) : error ? (
                      <Empty icon={<AlertCircle className="size-5" />}>
                        <span>{t("Couldn’t load changes")}</span>
                        <span className="text-content/45">{error}</span>
                      </Empty>
                    ) : files == null ? (
                      <Empty icon={<Spinner className="size-4" />}>
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
                </div>
              </DiffVirtualizerContext.Provider>
            </div>
            {rail ? (
              <aside
                className="review-rail min-h-0 min-w-0 overflow-hidden"
                aria-label={t("Source control")}
                inert={!railVisible}
                aria-hidden={!railVisible || undefined}
              >
                <div className="review-rail-content flex h-full min-h-0 flex-col">
                  <GitChangesPanel
                    cwd={cwd}
                    enabled={railVisible}
                    branchControl={railBranchControl}
                    selectedPath={source === "staged" || source === "unstaged" ? target : undefined}
                    selectedKind={source === "staged" || source === "unstaged" ? source : undefined}
                    selectedSha={reviewCommit(source)}
                    onOpenFile={openRailFile}
                    onOpenAllChanges={showSource}
                    onOpenCommit={openRailCommit}
                  />
                </div>
              </aside>
            ) : null}
          </motion.div>
        </section>
      </ReviewViewOptionsContext.Provider>
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
