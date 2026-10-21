import { useQuery } from "@tanstack/react-query";
import { queryClient, invalidateAfterChange } from "../../../shared/lib/queryClient";
// Adapted from ZCode (Apache-2.0).
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import {
  gitBaseDiffFiles,
  gitBaseFileDiff,
  gitCommitFileDiff,
  gitCommitFiles,
  gitDiffFiles,
  gitFileDiff,
  subscribeGitChanged,
} from "../../../platform/tauri/fs";
import {
  sessionCheckpointStatus,
  sessionCheckpointFileDiff,
  subscribeReviewChanged,
} from "../../sessions/model/checkpoint";
import {
  ReviewDiffCache,
  reviewCommit,
  reviewScopeKey,
  WORKTREE_REVIEW_SOURCES,
  type ReviewFile,
  type ReviewScope,
  type ReviewSource,
} from "./reviewDiff";

export function useReviewSource(
  cwd: string,
  source: ReviewSource,
  sessionId?: string,
  turnId?: string,
) {
  const visible = useSurfaceVisibility();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const scope = useMemo<ReviewScope>(
    () => ({ cwd, source, sessionId, turnId }),
    [cwd, source, sessionId, turnId],
  );
  const scopeKey = reviewScopeKey(scope);
  const indexKey = ["reviewIndex", scopeKey] as const;
  const index = useQuery({
    queryKey: indexKey, enabled: visible, refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<{ files: ReviewFile[]; workspaceShared?: boolean }> => {
      if (!cwd || cwd === "~" || (source === "session" && !sessionId)) return { files: [] };
      const commit = reviewCommit(source);
      if (commit) return { files: await gitCommitFiles(cwd, commit) };
      if (source === "uncommitted" || source === "branch") return { files: (await gitBaseDiffFiles(cwd, source === "branch" ? "branch" : "head")).files };
      if (source === "session") {
        const status = await (turnId ? sessionCheckpointStatus(sessionId!, cwd, undefined, turnId) : sessionCheckpointStatus(sessionId!, cwd));
        signal.throwIfAborted();
        return { files: status.files, workspaceShared: !!status.workspaceShared };
      }
      const status = await gitDiffFiles(cwd);
      return { files: status.files.filter(file => source === "staged" ? file.staged : file.unstaged)
        .map(file => file.staged && file.unstaged ? { ...file, additions: 0, deletions: 0 } : file) };
    },
  }, queryClient);
  const [cache, setCache] = useState<ReviewDiffCache>();
  // Create the resource in the effect: StrictMode's setup/cleanup replay must not
  // leave a memoized cache permanently disposed.
  useEffect(() => {
    const next = new ReviewDiffCache((request, path) => {
      const commit = reviewCommit(request.source);
      if (commit) return gitCommitFileDiff(request.cwd, commit, path);
      switch (request.source) {
        case "session":
          return sessionCheckpointFileDiff(
            request.sessionId!,
            request.cwd,
            path,
            ...(request.turnId ? [request.turnId] : []),
          );
        case "uncommitted":
          return gitBaseFileDiff(request.cwd, "head", path);
        case "branch":
          return gitBaseFileDiff(request.cwd, "branch", path);
        default:
          return gitFileDiff(
            request.cwd,
            path,
            request.source === "staged" ? "staged" : "unstaged",
          );
      }
    }, redraw);
    setCache(next);
    return () => next.dispose();
  }, [cwd, sessionId, turnId]);
  const refresh = useCallback(
    (sources?: readonly ReviewSource[]) => {
      // A full refresh also reloads the selected commit, e.g. after a rebase.
      const kinds = new Set<ReviewSource>(sources ?? [...WORKTREE_REVIEW_SOURCES, "session", source]);
      for (const kind of kinds)
        cache?.invalidate({ cwd, source: kind, sessionId, turnId });
      redraw();
      for (const kind of kinds) {
        const queryKey = ["reviewIndex", reviewScopeKey({ cwd, source: kind, sessionId, turnId })];
        void queryClient.cancelQueries({ queryKey, exact: true });
        void invalidateAfterChange(queryKey);
      }
    },
    [cache, cwd, sessionId, source, turnId],
  );

  useEffect(() => {
    if (!visible) return;
    // Hidden views miss change notifications; discard their mutable diff
    // contents on reveal as well as reloading the file list below.
    for (const kind of [...WORKTREE_REVIEW_SOURCES, "session"] as const)
      cache?.invalidate({ cwd, source: kind, sessionId, turnId });
  }, [visible, cache, cwd, sessionId, turnId]);

  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          refresh(WORKTREE_REVIEW_SOURCES);
        });
    };
    const gitUnsubscribe = subscribeGitChanged(schedule);
    const reviewUnsubscribe = subscribeReviewChanged((id) => {
      if (!id || id === sessionId) refresh(["session"]);
    });
    const onFocus = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      gitUnsubscribe();
      reviewUnsubscribe();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [visible, refresh, sessionId]);

  const loadDiff = useCallback(
    (path: string) => cache?.load(scope, path),
    [cache, scope],
  );
  const getDiff = (path: string) => cache?.get(scope, path);
  return {
    scopeKey,
    files: index.data?.files ?? (index.isError ? [] : null),
    error: index.error ? String(index.error instanceof Error ? index.error.message : index.error) : undefined,
    workspaceShared: !!index.data?.workspaceShared,
    loading: index.isPending || index.isFetching,
    loadDiff,
    getDiff,
    refresh,
  };
}
