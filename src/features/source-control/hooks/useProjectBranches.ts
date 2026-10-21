import { useQuery } from "@tanstack/react-query";
import { gitBranches, type GitBranches } from "../../../platform/tauri/fs";
import { queryClient } from "../../../shared/lib/queryClient";
import { gitKeys, installGitQueryInvalidation, isGitCwd } from "../model/gitQueries";

export type ProjectBranchesState = {
  branches: GitBranches | null;
  /** First lookup for this cwd has finished, repo or not. */
  settled: boolean;
};

/** Carry an already loaded snapshot into a separate picker webview before
 * mounting its controls. Subscribing still revalidates against Git. */
export function seedProjectBranches(cwd: string, branches: GitBranches) {
  if (isGitCwd(cwd)) queryClient.setQueryData(gitKeys.branches(cwd), branches);
}

/** Branch list plus whether git has answered yet, for callers that must not
 *  confuse "still looking" with "not a repo". */
export function useProjectBranchesState(
  cwd: string,
  enabled: boolean,
): ProjectBranchesState {
  const active = enabled && isGitCwd(cwd);
  if (active) installGitQueryInvalidation();
  const { data } = useQuery(
    {
      queryKey: gitKeys.branches(cwd),
      // A folder outside Git is a settled answer, not an error.
      queryFn: () => gitBranches(cwd).catch(() => null),
      enabled: active,
      // Seeded snapshots still revalidate when a picker mounts.
      refetchOnMount: "always",
    },
    queryClient,
  );
  return active && data !== undefined
    ? { branches: data, settled: true }
    : { branches: null, settled: false };
}

export function useProjectBranches(
  cwd: string,
  enabled: boolean,
): GitBranches | null {
  return useProjectBranchesState(cwd, enabled).branches;
}
