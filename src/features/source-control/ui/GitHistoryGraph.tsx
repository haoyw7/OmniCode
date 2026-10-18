import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { motion } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Maximize2,
} from "../../../shared/ui/icons";
import { useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../../../shared/ui/SurfaceVisibility";
import { GitGraphDialog } from "./GitGraphDialog";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { beginResizeInteraction } from "../../../shared/lib/resizeInteraction";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { HoverSummary, useHoverSummary } from "../../../shared/ui/HoverSummary";
import {
  gitCommitFiles,
  gitHistory,
  subscribeGitChanged,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import {
  GRAPH_ROW_PX,
  historyItemGraph,
  layoutGitGraph,
  type GraphRef,
  type HistoryItemViewModel,
} from "../model/gitGraph";
import {
  commitCoAuthors,
  contributorAvatarUrl,
} from "../model/gitContributors";

type Props = {
  cwd: string;
  enabled: boolean;
  expanded: boolean;
  selectedSha?: string;
  onToggleExpanded: () => void;
  onOpenCommit: (commit: GitHistoryCommit, pin?: boolean) => void;
};

const historyByCwd = new Map<string, GitHistoryCommit[]>();

type CommitStats = { files: number; additions: number; deletions: number };
const statsByCommit = new Map<string, CommitStats>();

export function GitHistoryGraph({
  cwd,
  enabled,
  expanded,
  selectedSha,
  onToggleExpanded,
  onOpenCommit,
}: Props) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const { foldState, finish } = useCollapseMotion(expanded);
  const reduced = useMotionPreference();
  const [dialogCwd, setDialogCwd] = useState<string>();
  const expandButton = useRef<HTMLButtonElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const { commits } = useGitHistory(
    cwd,
    enabled && visible && foldState !== "closed",
  );
  const rows = useMemo(() => layoutGitGraph(commits), [commits]);
  const dialogOpen = dialogCwd === cwd && enabled && visible;
  useEffect(() => {
    setDialogCwd(undefined);
  }, [cwd, enabled, visible]);
  const closeDialog = () => {
    setDialogCwd(undefined);
    expandButton.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="relative flex h-7 shrink-0 items-center hover:bg-content/3">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? uiT("Collapse graph") : uiT("Expand graph")}
          className="flex h-full min-w-0 w-full items-center gap-1 px-3 text-left leading-none"
        >
          <span className="min-w-0 truncate pr-8 text-[10px] font-semibold tracking-[0.04em] text-content/55 uppercase">
            {uiT("Graph")}
          </span>
          {expanded ? (
            <ChevronDown className="ml-auto size-3.5 shrink-0 text-content/50" />
          ) : (
            <ChevronRight className="ml-auto size-3.5 shrink-0 text-content/50" />
          )}
        </button>
        <button
          ref={expandButton}
          type="button"
          title={uiT("Open Git graph")}
          aria-label={uiT("Open Git graph")}
          aria-haspopup="dialog"
          aria-expanded={dialogOpen}
          disabled={!enabled || !cwd || cwd === "~"}
          onClick={() => setDialogCwd(cwd)}
          className="absolute inset-y-0 right-8 grid w-6 place-items-center text-content/50 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-hover disabled:opacity-40"
        >
          <Maximize2 className="size-3" />
        </button>
      </div>
      {expanded || foldState !== "closed" ? (
        <SurfaceVisibilityContext.Provider value={visible && expanded}>
          <motion.div
            initial={false} animate={{ opacity: expanded ? 1 : 0 }} transition={reduced ? immediateTransition : panelTransition} onAnimationComplete={finish}
            ref={lockOverscroll}
            inert={!expanded}
            aria-hidden={!expanded || undefined}
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none"
          >
            {!cwd || cwd === "~" ? (
              <p className="px-3 py-2 text-[12px] text-content/45">
                {uiT("No project folder")}
              </p>
            ) : commits.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-content/45">
                {uiT("No commits yet")}
              </p>
            ) : (
              <ul className="min-w-0 max-w-full">
                {commits.map((commit, index) => {
                  const row = rows[index];
                  if (!row) return null;
                  return (
                    <HistoryRow
                      key={commit.sha}
                      cwd={cwd}
                      commit={commit}
                      row={row}
                      active={selectedSha === commit.sha}
                      onOpen={(pin) => onOpenCommit(commit, pin)}
                    />
                  );
                })}
              </ul>
            )}
          </motion.div>
        </SurfaceVisibilityContext.Provider>
      ) : null}
      <PresenceBoundary>{dialogOpen ? (
        <GitGraphDialog
          cwd={cwd}
          selectedSha={selectedSha}
          onClose={closeDialog}
          onOpenCommit={(commit) => {
            closeDialog();
            onOpenCommit(commit, true);
          }}
        />
      ) : null}</PresenceBoundary>
    </div>
  );
}

function HistoryRow({
  cwd,
  commit,
  row,
  active,
  onOpen,
}: {
  cwd: string;
  commit: GitHistoryCommit;
  row: HistoryItemViewModel;
  active: boolean;
  onOpen: (pin?: boolean) => void;
}) {
  const graph = historyItemGraph(row);
  const badge = row.refs.find((ref) => ref.color) ?? row.refs[0];
  const statsKey = `${cwd}\0${commit.sha}`;
  const [stats, setStats] = useState(() => statsByCommit.get(statsKey));
  const hover = useHoverSummary<HTMLButtonElement>({
    openDelay: 400,
    onOpen: () => {
      if (statsByCommit.has(statsKey)) return;
      void gitCommitFiles(cwd, commit.sha)
        .then((files) => {
          const next = files.reduce<CommitStats>(
            (sum, file) => ({
              files: sum.files + 1,
              additions: sum.additions + file.additions,
              deletions: sum.deletions + file.deletions,
            }),
            { files: 0, additions: 0, deletions: 0 },
          );
          statsByCommit.set(statsKey, next);
          setStats(next);
        })
        .catch(() => undefined);
    },
  });
  return (
    <li className="min-w-0 overflow-visible" style={{ height: GRAPH_ROW_PX }}>
      <button
        type="button"
        ref={hover.anchorRef}
        {...hover.triggerProps}
        aria-describedby={hover.open ? hover.id : undefined}
        onClick={() => {
          hover.close();
          onOpen();
        }}
        onDoubleClick={() => onOpen(true)}
        aria-pressed={active}
        className={`git-history-item flex h-[22px] min-w-0 w-full items-stretch overflow-visible pr-2 text-left ${
          row.kind === "HEAD" ? "is-head" : ""
        } ${
          active
            ? "is-selected bg-selection text-content"
            : "text-content hover:bg-content/3"
        }`}
      >
        <svg
          aria-hidden
          className="git-history-graph pointer-events-none block shrink-0 overflow-visible"
          width={graph.width}
          height={graph.height}
          overflow="visible"
        >
          {graph.paths.map((path, pathIndex) => (
            <path
              key={pathIndex}
              d={path.d}
              fill="none"
              stroke={path.color}
              strokeWidth={path.strokeWidth}
              strokeLinecap="round"
            />
          ))}
          {graph.circles.map((circle, circleIndex) => (
            <circle
              key={circleIndex}
              cx={circle.cx}
              cy={circle.cy}
              r={circle.r}
              fill={circle.fill ?? "none"}
              strokeWidth={circle.strokeWidth}
            />
          ))}
        </svg>
        <span className="ml-1 flex min-w-0 flex-1 items-center overflow-hidden">
          <span
            data-code-label
            className={`min-w-0 shrink truncate text-[12px] leading-[22px] ${
              row.kind === "HEAD" ? "font-semibold" : ""
            }`}
          >
            {commit.subject || commit.shortSha}
          </span>
          {commit.author ? (
            <span
              title={commit.author}
              className="ml-2 max-w-[calc(100%-0.5rem)] shrink-0 truncate text-[12px] leading-[22px] text-content/45"
            >
              {commit.author}
            </span>
          ) : null}
        </span>
        {badge ? <RefPill refInfo={badge} /> : null}
      </button>
      <HoverSummary hover={hover}>
        <CommitSummary commit={commit} stats={stats} />
      </HoverSummary>
    </li>
  );
}

function CommitSummary({
  commit,
  stats,
}: {
  commit: GitHistoryCommit;
  stats: CommitStats | undefined;
}) {
  const { t: uiT } = useTranslation();
  const date = new Date(commit.timestamp * 1000);
  const coAuthors = commitCoAuthors(commit.body);
  const author = commit.author || uiT("Unknown author");
  const message = [commit.subject, commit.body].filter(Boolean).join("\n\n");
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-start gap-2">
          <ContributorAvatar name={author} email={commit.authorEmail} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-content [overflow-wrap:anywhere]">
              {author}
            </div>
            {commit.timestamp > 0 ? (
              <time
                dateTime={date.toISOString()}
                className="block text-[11px] text-content/45"
              >
                {relativeCommitTime(commit.timestamp, uiT)} ·{" "}
                {date.toLocaleString()}
              </time>
            ) : null}
          </div>
        </div>
        {coAuthors.map(({ name, email }) => (
          <div
            key={email || name}
            className="flex min-w-0 items-center gap-2 text-[11px] text-content/55"
          >
            <ContributorAvatar name={name} email={email} />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {uiT("{name} (co-author)", { name })}
            </span>
          </div>
        ))}
      </div>
      <p data-code-label className="max-h-48 overflow-y-auto whitespace-pre-wrap text-content/85 [overflow-wrap:anywhere]">
        {message || commit.shortSha}
      </p>
      {stats ? (
        <div className="text-[11px] text-content/55">
          {stats.files === 1
            ? uiT("{count} file changed", { count: stats.files })
            : uiT("{count} files changed", { count: stats.files })}
          {stats.additions ? (
            <span className="ml-2 font-mono text-emerald-400">+{stats.additions}</span>
          ) : null}
          {stats.deletions ? (
            <span className="ml-1.5 font-mono text-rose-400">-{stats.deletions}</span>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-content/10 pt-1.5 text-[11px] text-content/45">
        <span className="font-mono">{commit.shortSha}</span>
        {commit.refs.map((ref) => (
          <span
            data-code-label
            key={`${ref.kind}:${ref.name}`}
            className="max-w-full truncate rounded-full bg-content/10 px-1.5 text-content/60"
          >
            {ref.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContributorAvatar({ name, email }: { name: string; email?: string }) {
  const [image, setImage] = useState<{ email?: string; url: string }>();
  useEffect(() => {
    let cancelled = false;
    void contributorAvatarUrl(email)
      .then((url) => {
        if (!cancelled) setImage({ email, url });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [email]);
  const url = image?.email === email ? image?.url : undefined;
  return url ? (
    <img
      src={url}
      alt=""
      width={28}
      height={28}
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setImage({ email, url: "" })}
      className="size-7 shrink-0 rounded-full bg-content/10 object-cover"
    />
  ) : (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-full bg-content/10 text-[12px] font-medium text-content/65"
    >
      {Array.from(name.trim())[0]?.toUpperCase() || "?"}
    </span>
  );
}

function relativeCommitTime(
  timestamp: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - timestamp) / 60));
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{count}m ago", { count: minutes });
  if (minutes < 1440) return t("{count}h ago", { count: Math.floor(minutes / 60) });
  return t("{count}d ago", { count: Math.floor(minutes / 1440) });
}

function RefPill({ refInfo }: { refInfo: GraphRef }) {
  const local = refInfo.kind === "local";
  return (
    <span
      className={`ml-1 flex min-h-3.5 min-w-0 max-w-[6.5rem] shrink-0 self-center items-center gap-0.5 rounded-full px-1.5 text-[10px] leading-label ${
        refInfo.color ? "" : "bg-content/10 text-content/55"
      }`}
      style={
        refInfo.color
          ? {
              backgroundColor: refInfo.color,
              color: "var(--color-background-base)",
            }
          : undefined
      }
    >
      {local ? (
        <GitBranch className="size-2.5 shrink-0" strokeWidth={2} />
      ) : null}
      <span data-code-label className="min-w-0 truncate">{refInfo.name}</span>
    </span>
  );
}

function useGitHistory(
  cwd: string,
  enabled: boolean,
): { commits: GitHistoryCommit[] } {
  const [commits, setCommits] = useState<GitHistoryCommit[]>(
    () => historyByCwd.get(cwd) ?? [],
  );
  const commitsRef = useRef(commits);
  commitsRef.current = commits;

  const load = useCallback(() => {
    if (!enabled || !cwd || cwd === "~") return;
    void gitHistory(cwd)
      .then((next) => {
        const prev = commitsRef.current;
        if (sameHistory(prev, next.commits)) return;
        historyByCwd.set(cwd, next.commits);
        commitsRef.current = next.commits;
        setCommits(next.commits);
      })
      .catch(() => {
        historyByCwd.delete(cwd);
        commitsRef.current = [];
        setCommits([]);
      });
  }, [cwd, enabled]);

  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") {
      commitsRef.current = [];
      setCommits([]);
      return;
    }
    const cached = historyByCwd.get(cwd) ?? [];
    commitsRef.current = cached;
    setCommits(cached);
    load();
    const onResume = () => {
      if (!document.hidden) load();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    const unsub = subscribeGitChanged(load);
    return () => {
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      unsub();
    };
  }, [cwd, enabled, load]);

  return { commits };
}

function sameHistory(
  prev: GitHistoryCommit[],
  next: GitHistoryCommit[],
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((commit, i) => {
    const other = next[i];
    return (
      other &&
      commit.sha === other.sha &&
      commit.subject === other.subject &&
      commit.author === other.author &&
      commit.authorEmail === other.authorEmail &&
      commit.body === other.body &&
      commit.timestamp === other.timestamp &&
      commit.head === other.head &&
      commit.refs.length === other.refs.length &&
      commit.refs.every(
        (ref, j) =>
          other.refs[j]?.name === ref.name && other.refs[j]?.kind === ref.kind,
      )
    );
  });
}

export const GRAPH_PANEL_MIN = 120;
export const GRAPH_PANEL_DEFAULT = 240;

let graphPanelHeight = GRAPH_PANEL_DEFAULT;

export function loadGraphPanelHeight(): number {
  return graphPanelHeight;
}

export function saveGraphPanelHeight(height: number) {
  graphPanelHeight = height;
}

export function GraphResizeSash({
  height,
  onHeightPaint,
  onHeightCommit,
  maxHeight,
}: {
  height: number;
  onHeightPaint: (height: number) => void;
  onHeightCommit: (height: number) => void;
  maxHeight: () => number;
}) {
  const { t: uiT } = useTranslation();
  const drag = useRef<{ start: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const paintedRef = useRef(height);
  if (!drag.current) paintedRef.current = height;
  const stopDrag = useRef<(() => void) | null>(null);
  const paintRef = useRef(onHeightPaint);
  paintRef.current = onHeightPaint;
  const commitRef = useRef(onHeightCommit);
  commitRef.current = onHeightCommit;
  const maxRef = useRef(maxHeight);
  maxRef.current = maxHeight;
  useEffect(() => () => stopDrag.current?.(), []);

  const clamp = (value: number) =>
    Math.min(maxRef.current(), Math.max(GRAPH_PANEL_MIN, Math.round(value)));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || stopDrag.current) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    // Measure before the interaction changes styles.
    const maximum = maxRef.current();
    handle.setPointerCapture(pointerId);
    const endInteraction = beginResizeInteraction("row-resize");
    drag.current = { start: event.clientY, size: paintedRef.current };
    setDragging(true);
    let pending = paintedRef.current;
    let frame: number | null = null;
    const sample = (ev: PointerEvent) => {
      if (!drag.current) return;
      pending = Math.min(
        maximum,
        Math.max(
          GRAPH_PANEL_MIN,
          Math.round(drag.current.size - (ev.clientY - drag.current.start)),
        ),
      );
    };
    const paint = () => {
      if (paintedRef.current === pending) return;
      paintedRef.current = pending;
      handle.setAttribute("aria-valuenow", String(pending));
      paintRef.current(pending);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || !drag.current) return;
      sample(ev);
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        paint();
      });
    };

    const stop = () => {
      if (stopDrag.current !== stop) return;
      stopDrag.current = null;
      if (frame != null) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", stop);
      handle.removeEventListener("lostpointercapture", stop);
      paint();
      endInteraction();
      setDragging(false);
      drag.current = null;
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      commitRef.current(pending);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.type === "pointerup") sample(ev);
      stop();
    };

    stopDrag.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", stop);
    handle.addEventListener("lostpointercapture", stop);
  };

  return (
    <div className="relative z-10 h-4 shrink-0">
      <ResizeHandle
        edge="top"
        dragging={dragging}
        className="resize-handle-centered"
        style={{ top: 0 }}
        aria-label={uiT("Resize graph")}
        aria-valuenow={height}
        onPointerDown={onPointerDown}
        onDoubleClick={() => commitRef.current(clamp(GRAPH_PANEL_DEFAULT))}
      />
    </div>
  );
}
