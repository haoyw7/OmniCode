import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { pathKey } from "../../../shared/lib/paths";
import { queryClient } from "../../../shared/lib/queryClient";
import { gitKeys, installGitQueryInvalidation, isGitCwd } from "../model/gitQueries";
import { listWorktrees } from "../model/worktrees";

/** Share cached working copies between settings and composers. Revalidation
 * never clears the last successful result, including across unmounts. */
export function useProjectWorktrees(cwd: string, enabled = true) {
  const active = enabled && isGitCwd(cwd);
  if (active) installGitQueryInvalidation();
  const queryKey = gitKeys.worktrees(pathKey(cwd));
  const { data, error, refetch } = useQuery(
    {
      queryKey,
      queryFn: () => listWorktrees(cwd),
      enabled: active,
      // Worktree lists only change through Git; keep them through unmounts.
      gcTime: Infinity,
    },
    queryClient,
  );
  const refresh = useCallback(async () => {
    if (!active) return false;
    const result = await refetch();
    return result.isSuccess && !result.isRefetchError;
  }, [active, refetch]);
  return active
    ? { data, error: error ? String(error) : undefined, refresh }
    : { data: undefined, error: undefined, refresh };
}
