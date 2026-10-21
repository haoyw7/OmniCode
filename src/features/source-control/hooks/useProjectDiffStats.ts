import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { gitDiffStats, type GitDiffStats } from "../../../platform/tauri/fs";
import { queryClient } from "../../../shared/lib/queryClient";
import { gitKeys, installGitQueryInvalidation, isGitCwd } from "../model/gitQueries";

/** Focus and remount only revalidate stats older than this. */
const RESUME_TTL_MS = 30_000;
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();

function sameStats(a: GitDiffStats | null | undefined, b: GitDiffStats | null) {
  return a?.files === b?.files && a?.additions === b?.additions && a?.deletions === b?.deletions;
}

/** Push stats from a fuller git index (diff pane) so the title-bar badge cannot lag behind. */
export function applyProjectDiffStats(cwd: string, stats: GitDiffStats) {
  if (!isGitCwd(cwd)) return;
  const queryKey = gitKeys.diffStats(cwd);
  // An older read still in flight must not overwrite the fresher index.
  void queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<GitDiffStats | null>(queryKey, (old) => (sameStats(old, stats) ? old : stats));
}

export function useProjectDiffStats(
  cwd: string,
  enabled: boolean,
  activityKey?: string,
): GitDiffStats | null {
  const active = enabled && isGitCwd(cwd);
  if (active) installGitQueryInvalidation();
  useEffect(() => {
    if (!active || activityKey === undefined) return;
    // Host edits need not produce a local watcher event. Coalesce activity
    // across panes of this checkout without querying unrelated projects.
    if (activityTimers.has(cwd)) return;
    activityTimers.set(cwd, setTimeout(() => {
      activityTimers.delete(cwd);
      void queryClient.invalidateQueries({ queryKey: gitKeys.diffStats(cwd) });
    }, 200));
  }, [active, cwd, activityKey]);
  const { data } = useQuery(
    {
      queryKey: gitKeys.diffStats(cwd),
      queryFn: () => gitDiffStats(cwd).catch(() => null),
      enabled: active,
      staleTime: RESUME_TTL_MS,
      structuralSharing: (old, next) =>
        sameStats(old as GitDiffStats | null | undefined, next as GitDiffStats | null) ? old : next,
    },
    queryClient,
  );
  return active ? data ?? null : null;
}
