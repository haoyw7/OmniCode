import type { GitDiffIndex, GitFileDiff } from "../platform/tauri/fs";
import type { CheckpointStatus } from "../features/sessions/model/checkpoint";
import { translate } from "../shared/i18n/language";
import type { MobileClient } from "./client";
import type { MobileGitSource } from "./mobileGit";

/** Why Undo All is unavailable, if it is. */
export type SessionUndoBlock = "outside" | "locked" | "shared";

/** The edits one conversation made, in the review sheet's index shape. */
export type SessionChangesIndex = GitDiffIndex & { undoBlocked?: SessionUndoBlock; workspaceShared?: boolean };

export type MobileSessionChangesSource = MobileGitSource & {
  keep: () => Promise<void>;
  undo: () => Promise<void>;
};

export function sessionChangesIndex(status: CheckpointStatus): SessionChangesIndex {
  const files = status.files.map((file) => ({
    path: file.relative,
    relative: file.relative,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    staged: false,
    unstaged: true,
  }));
  return {
    branch: null,
    head: null,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    remote: null,
    upstream: null,
    defaultBranch: null,
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
    headPushed: false,
    workspaceShared: status.workspaceShared,
    undoBlocked: status.workspaceShared
      ? "shared"
      : status.undoLocked
        ? "locked"
        : status.files.some((file) => !file.undoable) ? "outside" : undefined,
  };
}

/** Review, Keep and Undo for the edits the Host captured for one conversation. */
export function createMobileSessionChangesSource(
  client: Pick<MobileClient, "connection" | "hasCapability" | "rpc">,
  projectId: string,
  sessionId: string,
): MobileSessionChangesSource | undefined {
  const connection = client.connection;
  if (!connection || connection.disabled || !client.hasCapability("sessions.checkpoint"))
    return;
  const request = async <T>(action: string, path?: string): Promise<T> => {
    const current = () => client.connection === connection && !connection.disabled;
    if (!current()) throw new Error(translate("Host connection changed."));
    const result = await client.rpc<T>("sessions.checkpoint", {
      projectId, sessionId, action, ...(path === undefined ? {} : { path }),
    });
    if (!current()) throw new Error(translate("Host connection changed."));
    return result;
  };
  return {
    loadIndex: async () => sessionChangesIndex(await request<CheckpointStatus>("status")),
    loadDiff: (relative) => request<GitFileDiff>("diff", relative),
    keep: async () => { await request("keep"); },
    undo: async () => { await request("undo"); },
  };
}
