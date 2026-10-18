import type { HarnessId } from "../../sessions/model/session";
import { generateConfiguredWorktreeName } from "../../sessions/model/titleModelClient";
import { generateHarnessBranchName } from "../../../integrations/harness/core/registry";
import { gitBranches } from "../../../platform/tauri/fs";
import {
  availableWorktreeBranch,
  generateWorktreeBranch,
} from "./worktreeNaming";
import { createWorktree, listWorktrees } from "./worktrees";

export async function createTaskWorktree(
  cwd: string,
  harness: HarnessId,
  message: string,
  base: string,
  progress: Parameters<typeof createWorktree>[4],
  isCurrent: () => boolean,
) {
  let generated: string;
  try {
    generated = await generateWorktreeBranch([
      () => generateConfiguredWorktreeName(cwd, message),
      () =>
        isCurrent()
          ? generateHarnessBranchName(harness, cwd, message)
          : Promise.resolve(null),
    ]);
  } catch (error) {
    if (!isCurrent()) return null;
    throw error;
  }
  if (!isCurrent()) return null;
  const [branches, trees] = await Promise.all([
    gitBranches(cwd),
    listWorktrees(cwd),
  ]);
  if (!isCurrent()) return null;
  const branch = availableWorktreeBranch(
    generated,
    branches.branches
      .filter((branch) => !branch.remote)
      .map((branch) => branch.name),
    trees.worktrees.map((tree) => tree.path),
  );
  return createWorktree(cwd, branch, base, false, progress);
}
