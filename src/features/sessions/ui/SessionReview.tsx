import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ChevronDown, ChevronRight, FileDiff } from "../../../shared/ui/icons";
import { useEffect, useReducer, useRef, useState } from "react";
import type { CheckpointFile, CheckpointStatus } from "../../../contracts/checkpoint";
import { keepSessionChanges, sessionCheckpointStatus, subscribeReviewChanged, undoSessionChanges } from "../model/checkpoint";
import { invalidateProjectFiles } from "../../connections/files/model/fileIndex";
import { invalidateWatchedFiles } from "../../connections/files/model/fileWatch";
import { basename, notifyGitChanged, subscribeGitChanged } from "../../../platform/tauri/fs";
import { formatInteger } from "../../../shared/lib/numbers";
import { FileTypeIcon } from "../../../shared/ui/FileTypeIcon";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";

type Props = {
  sessionId: string;
  cwd: string;
  turnId?: string;
  historical?: boolean;
  enabled?: boolean;
  busy?: boolean;
  undoLocked?: boolean;
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string; turnId?: string },
  ) => void;
};

export function SessionReview({
  sessionId,
  cwd,
  turnId,
  historical = false,
  enabled = true,
  busy = false,
  undoLocked = false,
  onOpenDiff,
}: Props) {
  const visible = useSurfaceVisibility();
  const { t: uiT } = useTranslation();
  const [files, setFiles] = useState<CheckpointFile[]>([]);
  const [recordedTurnId, setRecordedTurnId] = useState<string>();
  const reviewTurnId = historical ? turnId ?? recordedTurnId : recordedTurnId;
  const [hostLocked, setHostLocked] = useState(false);
  const [workspaceShared, setWorkspaceShared] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string>();
  const [restore, setRestore] = useState<{ message?: string }>();
  const [actionError, setActionError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [othersExpanded, setOthersExpanded] = useState(false);
  const [acting, setActing] = useState<"keep" | "undo" | null>(null);
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const filesRef = useRef(files);
  filesRef.current = files;

  // The Host decides what may be restored; a partly finished restore stays
  // visible until Undo is retried, even when no file differs any more.
  const applyStatus = (status: CheckpointStatus) => {
    setFiles(status.files);
    setHostLocked(!!status.undoLocked);
    setWorkspaceShared(!!status.workspaceShared);
    setUnavailableReason(status.undoUnavailableReason);
    setRestore(status.restorePending ? { message: status.restoreMessage } : undefined);
  };

  useEffect(() => {
    setFiles([]);
    setRecordedTurnId(undefined);
    setUnavailableReason(undefined);
    setRestore(undefined);
    setActionError(undefined);
    setError(undefined);
    setExpanded(false);
    setOthersExpanded(false);
  }, [sessionId, cwd]);

  useEffect(() => {
    if (busy) {
      setFiles([]);
      setRestore(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }
    if (!enabled || !visible || !cwd || cwd === "~") return;
    if (historical && !reviewTurnId) return;
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
      void (historical && reviewTurnId
        ? sessionCheckpointStatus(sessionId, cwd, undefined, reviewTurnId)
        : sessionCheckpointStatus(sessionId, cwd))
        .then((status) => {
          if (stale) return;
          applyStatus(status);
          if (status.turnId) setRecordedTurnId(status.turnId);
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
  }, [enabled, visible, cwd, sessionId, busy, revision, historical, historical ? reviewTurnId : undefined]);

  // External files changed in the workspace during the turn without an edit
  // event from this session: shell writes or another agent in the checkout.
  const own = files.filter((file) => !file.external);
  const others = files.filter((file) => file.external);
  // Without own edits, the external files are the card's only list; folding
  // them under an otherwise empty header would hide what changed.
  const attributed = own.length > 0;
  const primary = attributed ? own : others;
  const secondary = attributed ? others : [];
  useEffect(() => {
    if (primary.length <= 3) setExpanded(false);
  }, [primary.length]);
  useEffect(() => {
    if (secondary.length === 0) setOthersExpanded(false);
  }, [secondary.length]);

  if (busy) return null;
  const notice = error ?? actionError;
  const loadNotice = notice ? (
    <div
      className="flex items-center gap-2 px-3 py-2 text-[11px] text-content/60"
      role="status"
      title={notice}
    >
      <span className="flex-1">
        {error ? uiT("Couldn’t load session changes") : uiT(notice)}
      </span>
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
  if (files.length === 0 && !restore) {
    // Status reads also run on focus and Git notifications. They discover
    // whether a review exists, so an empty result must not flash a loading card.
    return loadNotice ? (
      <div className="pt-1 pb-2 font-sans" data-session-review-shell>
        <div className="desktop-card rounded-xl border border-content/12" data-session-review-border>
          {loadNotice}
        </div>
      </div>
    ) : null;
  }

  const disabled = busy || historical || acting != null;
  const locked = undoLocked || hostLocked || workspaceShared;
  // Retrying a restore only finishes the files; the Host never rewinds the
  // conversation twice and verifies each file itself.
  const canUndoAll = restore
    ? !undoLocked && !hostLocked
    : !locked && !unavailableReason && attributed && own.every((file) => file.undoable);
  const keepBlocked = !!restore;
  const hiddenFileCount = primary.length - 3;
  const totals = sumChanges(primary);
  const externalHint = uiT(
    "Not from this session's edit tools, such as shell commands or other sessions. Can't be undone.",
  );

  const run = (action: "keep" | "undo") => {
    if (disabled || (action === "undo" ? !canUndoAll : keepBlocked)) return;
    setActing(action);
    setActionError(undefined);
    const op =
      action === "keep"
        ? keepSessionChanges(sessionId, cwd)
        : undoSessionChanges(sessionId, cwd);
    const previous = filesRef.current.map((file) => file.path);
    void op
      .then((status) => {
        applyStatus(status);
        notifyGitChanged();
        invalidateWatchedFiles(previous);
        invalidateProjectFiles(cwd);
      })
      .catch((reason: unknown) => {
        setActionError(String(reason).replace(/^Error: /, ""));
        refresh();
      })
      .finally(() => setActing(null));
  };
  const openDiff: Props["onOpenDiff"] = (path) =>
    onOpenDiff(path, { sessionId, cwd, ...(reviewTurnId ? { turnId: reviewTurnId } : {}) });
  const fileRow = (file: CheckpointFile) => (
    <li key={file.relative}>
      <FileRow
        file={file}
        sessionId={sessionId}
        cwd={cwd}
        onOpenDiff={openDiff}
      />
    </li>
  );

  return (
    <div className="pt-1 pb-2 font-sans" data-session-review-shell>
      <div
        className="desktop-card overflow-hidden rounded-xl border border-content/12"
        data-session-review
        data-session-review-border
      >
        {loadNotice}
        <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-content/8 text-content/55">
            <FileDiff className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-content/80">
              {restore && primary.length === 0 ? uiT("Undo needs to finish") : uiT(
                attributed
                  ? primary.length === 1 ? "Changed {count} file" : "Changed {count} files"
                  : primary.length === 1 ? "Workspace changed {count} file" : "Workspace changed {count} files",
                { count: String(primary.length) },
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
            {!historical && (
              <>
                {attributed || restore ? (
                  <button
                    type="button"
                    title={
                      busy
                        ? uiT(
                            "Keep and undo are unavailable while the session is running",
                          )
                        : restore
                          ? canUndoAll
                            ? uiT("Retry restoring this turn's workspace files")
                            : uiT("Undo is unavailable while another session is running in this project")
                        : canUndoAll
                          ? uiT("Undo all session changes")
                          : unavailableReason
                            ? uiT(unavailableReason)
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
                    {restore ? uiT("Retry Undo") : uiT("Undo")}
                  </button>
                ) : null}
                <button
                  type="button"
                  title={
                    busy
                      ? uiT(
                          "Keep and undo are unavailable while the session is running",
                        )
                      : keepBlocked
                        ? uiT("Finish restoring the conversation checkpoint before keeping changes.")
                        : uiT("Keep all session changes and dismiss this card")
                  }
                  disabled={disabled || keepBlocked}
                  onClick={() => run("keep")}
                  className="h-7 rounded-md px-2.5 text-[11px] text-content/50 hover:bg-content/5 hover:text-content disabled:opacity-35"
                >
                  {uiT("Keep")}
                </button>
              </>
            )}
            <button
              type="button"
              title={uiT("Review changes")}
              data-session-review-border
              onClick={() => openDiff()}
              className="h-7 rounded-md border border-content/12 bg-content/8 px-2.5 text-[11px] font-medium text-content/75 hover:bg-content/12 hover:text-content"
            >
              {uiT("Review")}
            </button>
          </div>
        </div>
        {restore ? (
          <p className="px-3 pb-2 text-[11px] text-content/60" role="status" data-session-review-restore>
            {uiT(restore.message ?? "Conversation history was rolled back. Retry Undo to finish restoring workspace files.")}
          </p>
        ) : !attributed ? (
          <p className="px-3 pb-2 text-[11px] text-content/50">{externalHint}</p>
        ) : unavailableReason && !historical ? (
          <p className="px-3 pb-2 text-[11px] text-content/60" data-session-review-unavailable>
            {uiT(unavailableReason)}
          </p>
        ) : workspaceShared ? (
          <p className="px-3 pb-2 text-[11px] text-content/60">
            {uiT("Other sessions were active in this workspace. These changes may include their edits; undo is disabled.")}
          </p>
        ) : null}
        {primary.length > 0 ? (
          <div className="scrollbar-none max-h-64 overflow-y-auto border-t border-stroke py-1" data-session-review-border>
            <ul>{primary.slice(0, 3).map(fileRow)}</ul>
            <AnimatedCollapse expanded={expanded}>
              {() => <ul>{primary.slice(3).map(fileRow)}</ul>}
            </AnimatedCollapse>
          </div>
        ) : null}
        {primary.length > 3 ? (
          <button
            type="button"
            aria-expanded={expanded}
            data-session-review-border
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
        {secondary.length > 0 ? (
          <>
            <button
              type="button"
              aria-expanded={othersExpanded}
              data-session-review-border
              data-session-review-others
              title={externalHint}
              onClick={() => setOthersExpanded((open) => !open)}
              className="flex h-8 w-full min-w-0 items-center gap-1.5 border-t border-stroke px-3 text-left text-[11px] text-content/45 hover:bg-content/3 hover:text-content/70"
            >
              {othersExpanded ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {uiT("Other workspace changes ({count})", {
                  count: String(secondary.length),
                })}
              </span>
              <DiffCounts file={sumChanges(secondary)} />
            </button>
            <AnimatedCollapse expanded={othersExpanded}>
              {() => (
                <div className="scrollbar-none max-h-64 overflow-y-auto pb-1">
                  <p className="px-3 pb-1 text-[11px] text-content/45">{externalHint}</p>
                  <ul>{secondary.map(fileRow)}</ul>
                </div>
              )}
            </AnimatedCollapse>
          </>
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
    session?: { sessionId: string; cwd: string; turnId?: string },
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

function sumChanges(files: CheckpointFile[]) {
  return files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function DiffCounts({ file }: { file: Pick<CheckpointFile, "additions" | "deletions"> }) {
  return (
    <span className="flex shrink-0 gap-2 font-sans text-[11px] font-semibold tabular-nums">
      <span className="text-emerald-400">+{formatInteger(file.additions)}</span>
      <span className="text-red-400">-{formatInteger(file.deletions)}</span>
    </span>
  );
}
