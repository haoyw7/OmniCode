import { queryOptions } from "@tanstack/react-query";
import { invalidateAfterChange } from "../../../shared/lib/queryClient";
import { gitDiffIndex, gitPrStatus, gitHistory, gitCommitFiles, gitHeadMessage, gitRangeContext } from "../../../platform/tauri/fs";
import { subscribeGitChanged } from "../../../platform/tauri/fs";
import { subscribeDirsChanged } from "../../connections/files/model/fileTree";

/** Query keys for per-checkout Git reads; everything under `git` refreshes together. */
export const gitKeys = {
  all: ["git"] as const,
  diffIndex: (cwd: string) => ["git", "diffIndex", cwd] as const,
  prStatus: (cwd: string, branch: string | null | undefined) => ["git", "prStatus", cwd, branch] as const,
  history: (cwd: string) => ["git", "history", cwd] as const,
  commitStats: (cwd: string, sha: string) => ["git", "commitStats", cwd, sha] as const,
  branches: (cwd: string) => ["git", "branches", cwd] as const,
  diffStats: (cwd: string) => ["git", "diffStats", cwd] as const,
  fileStatuses: (cwd: string) => ["git", "fileStatuses", cwd] as const,
  worktrees: (key: string) => ["git", "worktrees", key] as const,
  editorBase: (cwd: string, path: string) => ["git", "editorBase", cwd, path] as const,
};

export const gitDiffIndexQuery = (cwd: string) => queryOptions({
  queryKey: gitKeys.diffIndex(cwd), queryFn: () => gitDiffIndex(cwd).catch(() => null),
});
export const gitPrStatusQuery = (cwd: string, branch: string | null | undefined) => queryOptions({
  queryKey: gitKeys.prStatus(cwd, branch), queryFn: () => gitPrStatus(cwd).catch(() => null),
});
export const gitHistoryQuery = (cwd: string) => queryOptions({
  queryKey: gitKeys.history(cwd), queryFn: () => gitHistory(cwd).then((result) => result.commits).catch(() => []),
});
export const gitCommitStatsQuery = (cwd: string, sha: string) => queryOptions({
  queryKey: gitKeys.commitStats(cwd, sha), staleTime: Infinity,
  queryFn: async () => (await gitCommitFiles(cwd, sha)).reduce((sum, file) => ({
    files: sum.files + 1, additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions,
  }), { files: 0, additions: 0, deletions: 0 }),
});

export function isGitCwd(cwd: string): boolean {
  return Boolean(cwd) && cwd !== "~";
}

let installed = false;

/** Refresh mounted Git reads when the watcher reports HEAD, index or tree changes.
 *  Hidden windows only mark them stale; the focus refetch picks them up. */
export function installGitQueryInvalidation() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  subscribeGitChanged(() => void invalidateAfterChange(gitKeys.all));
  subscribeDirsChanged(() => void invalidateAfterChange(["git", "fileStatuses"]));
}

export const gitHeadMessageQuery = (cwd: string) => queryOptions({
  queryKey: ["git", "headMessage", cwd], queryFn: () => gitHeadMessage(cwd),
});
export const gitRangeContextQuery = (cwd: string) => queryOptions({
  queryKey: ["git", "rangeContext", cwd], queryFn: () => gitRangeContext(cwd),
});
