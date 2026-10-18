import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ChevronDown, ChevronRight, FileDiff } from "../../../shared/ui/icons";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  keepSessionChanges,
  sessionCheckpointStatus,
  subscribeReviewChanged,
  undoSessionChanges,
  type CheckpointFile,
} from "../model/checkpoint";
import { invalidateProjectFiles } from "../../connections/files/model/fileIndex";
import { invalidateWatchedFiles } from "../../connections/files/model/fileWatch";
import {
  basename,
  notifyGitChanged,
  subscribeGitChanged,
} from "../../../platform/tauri/fs";
import { formatInteger } from "../../../shared/lib/numbers";
import { FileTypeIcon } from "../../connections/files/ui/FileTypeIcon";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";

type Props = {
  sessionId: string;
  cwd: string;
  enabled?: boolean;
  busy?: boolean;
  undoLocked?: boolean;
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string },
  ) => void;
};

export function SessionReview({
  sessionId,
  cwd,
  enabled = true,
  busy = false,
  undoLocked = false,
  onOpenDiff,
}: Props) {
  const visible = useSurfaceVisibility();
  const { t: uiT } = useTranslation();
  const [files, setFiles] = useState<CheckpointFile[]>([]);
  const [hostLocked, setHostLocked] = useState(false);
  const [workspaceShared, setWorkspaceShared] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<"keep" | "undo" | null>(null);
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => {
    setFiles([]);
    setError(undefined);
    setExpanded(false);
  }, [sessionId, cwd]);

  useEffect(() => {
    if (busy) {
      setFiles([]);
      setError(undefined);
      setLoading(false);
      return;
    }
    if (!enabled || !visible || !cwd || cwd === "~") return;
    let stale = false;
    let loading = false;
    let pending = false;
    let failures = 0;
    let timer: number | null = null;
    let scheduledAt = 0;
    const load = () => {
      if (loading) {
        pending = true;
        return;
      }
      loading = true;
      setLoading(true);
      void sessionCheckpointStatus(sessionId, cwd)
        .then((status) => {
          if (stale) return;
          setFiles(status.files);
          setHostLocked(!!status.undoLocked);
          setWorkspaceShared(!!status.workspaceShared);
          setError(undefined);
          failures = 0;
        })
        .catch((reason: unknown) => {
          if (stale) return;
          // Keep a usable review while retrying transient Host/snapshot failures.
          setError(String(reason).replace(/^Error: /, ""));
          failures += 1;
        })
        .finally(() => {
          loading = false;
          if (stale) return;
          setLoading(false);
          if (pending) {
            pending = false;
            schedule();
          } else if (failures > 0 && failures <= 3) {
            schedule(500 * 2 ** (failures - 1));
          }
        });
    };
    const schedule = (delay = 200) => {
      // Coalesce notifications without overlapping checkpoint status reads.
      if (loading) {
        pending = true;
        return;
      }
      if (timer != null) {
        if (scheduledAt <= Date.now() + delay) return;
        window.clearTimeout(timer);
      }
      scheduledAt = Date.now() + delay;
      timer = window.setTimeout(() => {
        timer = null;
        load();
      }, delay);
    };
    load();
    const unsubReview = subscribeReviewChanged((id) => {
      if (!id || id === sessionId) schedule();
    });
    const unsubGit = subscribeGitChanged(() => schedule());
    const onResume = () => {
      if (!document.hidden) schedule();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      stale = true;
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      unsubReview();
      unsubGit();
    };
  }, [enabled, visible, cwd, sessionId, busy, revision]);

  useEffect(() => {
    if (files.length <= 3) setExpanded(false);
  }, [files.length]);

  if (busy) return null;
  const loadNotice = error ? (
    <div
      className="flex items-center gap-2 px-3 py-2 text-[11px] text-content/60"
      role="status"
      title={error}
    >
      <span className="flex-1">{uiT("Couldn’t load session changes")}</span>
      <button
        type="button"
        disabled={loading}
        onClick={refresh}
        className="rounded-md px-2 py-1 hover:bg-content/5 disabled:opacity-35"
      >
        {uiT("Retry")}
      </button>
    </div>
  ) : null;
  if (files.length === 0) {
    // Status reads also run on focus and Git notifications. They discover
    // whether a review exists, so an empty result must not flash a loading card.
    return loadNotice ? (
      <div className="px-4 pt-1 pb-2 font-sans" data-session-review-shell>
        <div className="desktop-card rounded-xl border border-content/12 bg-content/3">
          {loadNotice}
        </div>
      </div>
    ) : null;
  }

  const disabled = busy || acting != null;
  const locked = undoLocked || hostLocked || workspaceShared;
  const canUndoAll = !locked && files.every((file) => file.undoable);
  const hiddenFileCount = files.length - 3;
  const totals = files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  const run = (action: "keep" | "undo") => {
    if (disabled || (action === "undo" && !canUndoAll)) return;
    setActing(action);
    const op =
      action === "keep"
        ? keepSessionChanges(sessionId, cwd)
        : undoSessionChanges(sessionId, cwd);
    const previous = filesRef.current.map((file) => file.path);
    void op
      .then((status) => {
        setFiles(status.files);
        setHostLocked(!!status.undoLocked);
        setWorkspaceShared(!!status.workspaceShared);
        notifyGitChanged();
        invalidateWatchedFiles(previous);
        invalidateProjectFiles(cwd);
      })
      .catch(() => refresh())
      .finally(() => setActing(null));
  };
  const fileRow = (file: CheckpointFile) => (
    <li key={file.relative}>
      <FileRow
        file={file}
        sessionId={sessionId}
        cwd={cwd}
        onOpenDiff={onOpenDiff}
      />
    </li>
  );

  return (
    <div className="px-4 pt-1 pb-2 font-sans" data-session-review-shell>
      <div
        className="desktop-card overflow-hidden rounded-xl border border-content/12 bg-content/3"
        data-session-review
      >
        {loadNotice}
        <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-content/8 text-content/55">
            <FileDiff className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-content/80">
              {uiT(
                workspaceShared
                  ? "Workspace changes this turn ({count})"
                  : files.length === 1 ? "Changed {count} file" : "Changed {count} files",
                { count: String(files.length) },
              )}
            </div>
            <div className="flex items-center gap-1.5 font-sans text-[11px] font-semibold tabular-nums -mt-0.5">
              <span className="text-emerald-400">
                +{formatInteger(totals.additions)}
              </span>
              <span className="text-red-400">
                -{formatInteger(totals.deletions)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title={
                busy
                  ? uiT(
                      "Keep and undo are unavailable while the session is running",
                    )
                  : canUndoAll
                    ? uiT("Undo all session changes")
                    : workspaceShared
                      ? uiT(
                          "Other sessions were active in this workspace. These changes may include their edits; undo is disabled.",
                        )
                      : locked
                        ? uiT(
                            "Undo is unavailable while another session is running in this project",
                          )
                        : uiT(
                            "Undo is unavailable because a file changed outside this session",
                          )
              }
              disabled={disabled || !canUndoAll}
              onClick={() => run("undo")}
              className="h-7 rounded-md px-2.5 text-[11px] text-content/50 hover:bg-content/5 hover:text-content disabled:opacity-35"
            >
              {uiT("Undo")}
            </button>
            <button
              type="button"
              title={
                busy
                  ? uiT(
                      "Keep and undo are unavailable while the session is running",
                    )
                  : uiT("Keep all session changes and dismiss this card")
              }
              disabled={disabled}
              onClick={() => run("keep")}
              className="h-7 rounded-md px-2.5 text-[11px] text-content/50 hover:bg-content/5 hover:text-content disabled:opacity-35"
            >
              {uiT("Keep")}
            </button>
            <button
              type="button"
              title={uiT("Review changes")}
              onClick={() => onOpenDiff(undefined, { sessionId, cwd })}
              className="h-7 rounded-md border border-content/12 bg-content/8 px-2.5 text-[11px] font-medium text-content/75 hover:bg-content/12 hover:text-content"
            >
              {uiT("Review")}
            </button>
          </div>
        </div>
        {workspaceShared ? (
          <p className="px-3 pb-2 text-[11px] text-content/60">
            {uiT("Other sessions were active in this workspace. These changes may include their edits; undo is disabled.")}
          </p>
        ) : null}
        <div className="scrollbar-none max-h-64 overflow-y-auto border-t border-stroke py-1">
          <ul>{files.slice(0, 3).map(fileRow)}</ul>
          <AnimatedCollapse expanded={expanded}>
            {() => <ul>{files.slice(3).map(fileRow)}</ul>}
          </AnimatedCollapse>
        </div>
        {files.length > 3 ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className="flex h-8 w-full items-center gap-1.5 border-t border-stroke px-3 text-left text-[11px] text-content/45 hover:bg-content/3 hover:text-content/70"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <span>
              {expanded
                ? uiT("Show fewer files")
                : uiT(hiddenFileCount === 1 ? "Show {count} more file" : "Show {count} more files", {
                    count: String(hiddenFileCount),
                  })}
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FileRow({
  file,
  sessionId,
  cwd,
  onOpenDiff,
}: {
  file: CheckpointFile;
  sessionId: string;
  cwd: string;
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string },
  ) => void;
}) {
  const name = basename(file.relative);
  return (
    <button
      type="button"
      title={file.relative}
      onClick={() => onOpenDiff(file.path, { sessionId, cwd })}
      className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-content/65 hover:bg-content/3 hover:text-content"
    >
      <FileTypeIcon name={name} isDir={false} size={15} />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
        {file.relative}
      </span>
      <DiffCounts file={file} />
    </button>
  );
}

function DiffCounts({ file }: { file: CheckpointFile }) {
  return (
    <span className="flex shrink-0 gap-2 font-sans text-[11px] font-semibold tabular-nums">
      <span className="text-emerald-400">+{formatInteger(file.additions)}</span>
      <span className="text-red-400">-{formatInteger(file.deletions)}</span>
    </span>
  );
}
