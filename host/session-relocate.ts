import type { HostSession } from "../src/contracts/protocol";
import { hostWorktrees, type HostWorktree } from "./git-worktrees";
import { appendReadyHandoff, buildDeterministicHandoff } from "../src/domain/handoff";
import { workspacePathKey } from "../src/domain/workspacePaths";
import { machinePath } from "./machine-io";

export type RelocateRequest = { sessionId: string; path: string };

export function parseRelocate(params: Record<string, unknown>): RelocateRequest {
  const sessionId = params.sessionId, path = params.path;
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 256) throw new Error("Invalid session ID");
  if (typeof path !== "string" || !path || path.length > 4096 || path.includes("\0")) throw new Error("Invalid working copy");
  return { sessionId, path };
}

/** The target must be a live checkout registered with the conversation's repository. */
export async function relocationTarget(projectCwd: string, path: string): Promise<HostWorktree> {
  if (!machinePath.isAbsolute(path)) throw new Error("Invalid working copy");
  const listed = await hostWorktrees(projectCwd);
  const tree = listed.worktrees.find(entry => workspacePathKey(entry.path) === workspacePathKey(path));
  if (!tree || tree.missing) throw new Error("This worktree is no longer available. Refresh the picker.");
  return tree;
}

export function alreadyRelocated(value: HostSession, tree: HostWorktree): boolean {
  return !value.session.worktreeRemoved && workspacePathKey(value.session.executionCwd || value.session.cwd) === workspacePathKey(tree.path);
}

/** Same conversation and history; the provider starts fresh with a recap of the old checkout. */
export function relocatedSession(value: HostSession, tree: HostWorktree): HostSession {
  const blank = !value.session.blocks.some(block => block.role === "user");
  const session = blank ? value.session : appendReadyHandoff(value.session, value.session.harness, value.session.harness,
    `The previous working copy was deleted. Continue this conversation in ${tree.path}. Recheck the files before making changes.\n\n${buildDeterministicHandoff(value.session)}`);
  return {
    ...value,
    nativeBinding: undefined,
    nativeStatus: undefined,
    session: {
      ...session,
      worktreeRemoved: undefined,
      executionCwd: tree.path,
      linkedWorktree: !tree.isMain,
      branch: tree.branch ?? undefined,
      providerSessionId: undefined,
      nativeSession: undefined,
      context: undefined,
      pendingSwitch: undefined,
    },
  };
}
