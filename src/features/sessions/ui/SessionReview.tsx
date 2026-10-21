import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ChevronDown, ChevronRight, FileDiff } from "../../../shared/ui/icons";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { checkpointStatusQuery } from "../model/checkpointQueries";
import {
  keepSessionChanges,
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
  const [recording, setRecording] = useState<{ sessionId: string; cwd: string; turnId: string }>();
  const recordedTurnId = recording?.sessionId === sessionId && recording.cwd === cwd ? recording.turnId : undefined;
  const reviewTurnId = historical ? turnId ?? recordedTurnId : recordedTurnId;
  const [expanded, setExpanded] = useState(false);
  const [othersExpanded, setOthersExpanded] = useState(false);
  const queryTurnId = historical ? reviewTurnId : undefined;
  const active = enabled && visible && !busy && !!cwd && cwd !== "~" && (!historical || !!queryTurnId);
  const statusQuery = useQuery({
    ...checkpointStatusQuery(sessionId, cwd, queryTurnId),
    enabled: active,
    placeholderData: (previous, query) => historical && query?.queryKey[2] === sessionId && query.queryKey[3] === cwd && query.queryKey[4] === null && (!previous?.turnId || previous.turnId === queryTurnId)
      ? previous : undefined,
  }, queryClient);
  const files = statusQuery.data?.files ?? [];
  const hostLocked = !!statusQuery.data?.undoLocked;
  const workspaceShared = !!statusQuery.data?.workspaceShared;
  const loading = statusQuery.isFetching;
  const error = errorMessage(statusQuery.error ?? statusQuery.failureReason);
  const refresh = () => { void statusQuery.refetch(); };
  useEffect(() => {
    if (statusQuery.data?.turnId) setRecording({ sessionId, cwd, turnId: statusQuery.data.turnId });
  }, [sessionId, cwd, statusQuery.data?.turnId]);

  const actionMutation = useMutation({
    mutationFn: async (input: { action: "keep" | "undo"; sessionId: string; cwd: string; paths: string[] }) => {
      await queryClient.cancelQueries({ queryKey: checkpointStatusQuery(input.sessionId, input.cwd).queryKey });
      return input.action === "keep"
        ? keepSessionChanges(input.sessionId, input.cwd)
        : undoSessionChanges(input.sessionId, input.cwd);
    },
    onSuccess: (status, input) => {
      queryClient.setQueryData(checkpointStatusQuery(input.sessionId, input.cwd).queryKey, status);
      notifyGitChanged();
      invalidateWatchedFiles(input.paths);
      void invalidateProjectFiles(input.cwd);
    },
    onError: (reason, input) => {
      toast.error(errorMessage(reason));
      void invalidateAfterChange(checkpointStatusQuery(input.sessionId, input.cwd).queryKey);
    },
  }, queryClient);

  useEffect(() => {
    setExpanded(false);
    setOthersExpanded(false);
  }, [sessionId, cwd]);

  useEffect(() => {
    const queryKey = checkpointStatusQuery(sessionId, cwd, queryTurnId).queryKey;
    if (busy) {
      void queryClient.resetQueries({ queryKey, exact: true });
      return;
    }
    if (!active) {
      if (!queryClient.getQueryCache().find({ queryKey, exact: true })?.isActive()) {
        void queryClient.cancelQueries({ queryKey, exact: true });
      }
      return;
    }
    let disposed = false;
    let waiting = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (disposed || waiting || timer != null) return;
      const query = queryClient.getQueryCache().find({ queryKey, exact: true });
      if (query?.state.fetchStatus === "fetching") {
        waiting = true;
        // Native checkpoint reads are serialized. Coalesce all notifications
        // during a read into one follow-up instead of restarting that read.
        void query.promise?.catch(() => {}).then(() => { waiting = false; schedule(); });
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (queryClient.getQueryState(queryKey)?.fetchStatus === "fetching") schedule();
        else void invalidateAfterChange(queryKey);
      }, 200);
    };
    const unsubReview = subscribeReviewChanged((id) => {
      if (!id || id === sessionId) schedule();
    });
    const unsubGit = subscribeGitChanged(() => schedule());
    return () => {
      disposed = true;
      if (timer != null) clearTimeout(timer);
      unsubReview();
      unsubGit();
    };
  }, [active, cwd, sessionId, busy, queryTurnId]);

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
      <div className="pt-1 pb-2 font-sans" data-session-review-shell>
        <div className="desktop-card rounded-xl border border-content/12" data-session-review-border>
          {loadNotice}
        </div>
      </div>
    ) : null;
  }

  const disabled = busy || historical || actionMutation.isPending;
  const locked = undoLocked || hostLocked || workspaceShared;
  const canUndoAll = !locked && attributed && own.every((file) => file.undoable);
  const hiddenFileCount = primary.length - 3;
  const totals = sumChanges(primary);
  const externalHint = uiT(
    "Not from this session's edit tools, such as shell commands or other sessions. Can't be undone.",
  );

  const run = (action: "keep" | "undo") => {
    if (disabled || (action === "undo" && !canUndoAll)) return;
    actionMutation.mutate({ action, sessionId, cwd, paths: files.map((file) => file.path) });
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
              {uiT(
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
                {attributed ? (
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
                ) : null}
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
        {!attributed ? (
          <p className="px-3 pb-2 text-[11px] text-content/50">{externalHint}</p>
        ) : workspaceShared ? (
          <p className="px-3 pb-2 text-[11px] text-content/60">
            {uiT("Other sessions were active in this workspace. These changes may include their edits; undo is disabled.")}
          </p>
        ) : null}
        <div className="scrollbar-none max-h-64 overflow-y-auto border-t border-stroke py-1" data-session-review-border>
          <ul>{primary.slice(0, 3).map(fileRow)}</ul>
          <AnimatedCollapse expanded={expanded}>
            {() => <ul>{primary.slice(3).map(fileRow)}</ul>}
          </AnimatedCollapse>
        </div>
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
