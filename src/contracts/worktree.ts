export type Worktree = {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
  missing: boolean;
  dirty: boolean | null;
  unpushed: number | null;
  sessionIds: string[];
  log?: string[];
};
export type Worktrees = { worktrees: Worktree[]; defaultRoot: string };
export type WorktreeRemoval = { sessionIds: string[]; projectCwd: string };
/** Live `git worktree add` output while `git.worktreeCreate` with a `progressId` runs. */
export const HOST_WORKTREE_PROGRESS_CAPABILITY = "git.worktreeProgress.v1";
export type WorktreeProgress = { lines: string[]; offset: number; done: boolean };
