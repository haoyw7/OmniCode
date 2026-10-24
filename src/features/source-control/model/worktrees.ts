import { hostWorktreeCommand } from "../../connections/model/hostWorktrees";
import { appendReadyHandoff, buildDeterministicHandoff } from "../../../domain/handoff";
import { invokeWorkspace, notifyGitChanged } from "../../../platform/tauri/fs";
import { isFilesystemTab, type FilePaneTab } from "../../workspace/model/layout";
import { isEqualOrInside, pathKey } from "../../../shared/lib/paths";
import { isBlankSession } from "../../projects/model/projectReturn";
import { newSession } from "../../sessions/model/session";
import { sessionExecutionCwd } from "../../../domain/session";
import { type Session } from "../../../contracts/session";

import type { Worktree, Worktrees } from "../../../contracts/worktree";

/** Match an execution directory against Git's registered roots, including subdirectories. */
export function registeredWorktreeAt(cwd: string, trees: readonly Worktree[]): Worktree | undefined {
  return trees.filter((tree) => !tree.missing && isEqualOrInside(cwd, tree.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

export const listWorktrees = (cwd: string) =>
  invokeWorkspace<Worktrees>("git_worktrees", { cwd });

export async function createWorktree(
  cwd: string,
  branch: string,
  base: string,
  existing: boolean,
  progress?: { id: string; onLine: (line: string) => void },
) {
  const tree = await hostWorktreeCommand<Worktree>(cwd, "git.worktreeCreate", { branch, base, existing }, progress?.onLine);
  notifyGitChanged();
  return tree;
}

export function temporaryWorktreeBranchName(
  id: string = crypto.randomUUID(),
): string {
  const token = id
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toLowerCase();
  return `oc/${token || Date.now().toString(36)}`;
}

export async function removeWorktree(
  cwd: string,
  path: string,
  force = false,
  keepSessions = false,
) {
  const result = await hostWorktreeCommand<{ sessionIds: string[]; projectCwd: string }>(
    cwd, "git.worktreeRemove",
    { path, force, keepSessions },
  );
  notifyGitChanged();
  return result;
}

/** Read-only preflight; final removal must still recheck for new blockers. */
export const checkWorktreeRemoval: RemoveWorktree = (cwd, path, force) =>
  hostWorktreeCommand(cwd, "git.worktreeCheckRemove", { path, force });

export function assertWorktreeFilesClosed(
  path: string,
  files: readonly FilePaneTab[],
) {
  if (
    files.some(
      (file) =>
        isEqualOrInside(file.cwd, path) ||
        (isFilesystemTab(file) && isEqualOrInside(file.path, path)),
    )
  ) {
    throw new Error(
      "Close the files and terminals open in this worktree first.",
    );
  }
}

export function worktreeSessionIds(
  tree: Worktree,
  sessions: readonly Pick<
    Session,
    "id" | "cwd" | "executionCwd" | "worktreeRemoved"
  >[],
) {
  const ids = new Set(tree.sessionIds);
  for (const session of sessions) {
    // Live sessions override their last saved context.
    ids.delete(session.id);
    if (
      !session.worktreeRemoved &&
      isEqualOrInside(session.executionCwd || session.cwd, tree.path)
    )
      ids.add(session.id);
  }
  return [...ids];
}

export const NO_BRANCH_LABEL = "No branch selected";

/** Keep the transcript and project identity while requiring a new working copy. */
export function detachSessionWorktree<T extends { cwd: string; executionCwd?: string }>(
  session: T,
  projectCwd: string,
  path: string,
) {
  return {
    ...session,
    cwd: isEqualOrInside(session.cwd, path) ? projectCwd : session.cwd,
    executionCwd: session.executionCwd || session.cwd,
    worktreeRemoved: true,
    linkedWorktree: false,
    branch: undefined,
    providerSessionId: undefined,
    context: undefined,
    pendingSwitch: undefined,
    pendingQuestion: undefined,
    busy: false,
    queueStatus: "paused" as const,
  };
}

/** Existing working copies stay bound; removed ones can be replaced in place. */
export function sessionInWorktree(session: Session, tree: Worktree): Session {
  if (
    !session.worktreeRemoved &&
    pathKey(sessionExecutionCwd(session)) === pathKey(tree.path)
  )
    return session;
  const target =
    session.worktreeRemoved && !isBlankSession(session)
      ? appendReadyHandoff(
          session,
          session.harness,
          session.harness,
          `The previous working copy was deleted. Continue this conversation in ${tree.path}. Recheck the files before making changes.\n\n${buildDeterministicHandoff(session)}`,
        )
      : isBlankSession(session)
        ? session
        : {
            ...newSession(
              session.harness,
              session.cwd,
              session.model,
              session.runtimeMode,
              session.modelSettings,
            ),
            providerAccountId: session.providerAccountId,
          };
  return {
    ...target,
    worktreeRemoved: undefined,
    executionCwd: tree.path,
    linkedWorktree: !tree.isMain,
    branch: tree.branch ?? undefined,
    providerSessionId: undefined,
    context: undefined,
    pendingSwitch: undefined,
  };
}

export type RemoveWorktree = (
  cwd: string,
  path: string,
  force: boolean,
  keepSessions?: boolean,
) => Promise<void | { sessionIds: string[]; projectCwd: string }>;
