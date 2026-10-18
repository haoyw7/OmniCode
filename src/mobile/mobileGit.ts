import type { GitDiffIndex, GitFileDiff } from "../platform/tauri/fs";
import { translate } from "../shared/i18n/language";
import type { MobileClient } from "./client";

/** Bound to one Host and working copy, including an optional session worktree. */
export type MobileGitSource = {
  loadIndex: () => Promise<GitDiffIndex>;
  loadDiff: (relative: string) => Promise<GitFileDiff>;
};

export function createMobileGitSource(
  client: Pick<MobileClient, "connection" | "hasCapability" | "rpc">,
  projectId: string,
  cwd: string,
): MobileGitSource | undefined {
  const connection = client.connection;
  if (
    !connection ||
    connection.disabled ||
    !cwd ||
    !client.hasCapability("git.index") ||
    !client.hasCapability("git.fileDiff")
  )
    return;
  const request = async <T>(method: string, params: object): Promise<T> => {
    const current = () =>
      client.connection === connection && !connection.disabled;
    if (!current()) throw new Error(translate("Host connection changed."));
    const result = await client.rpc<T>(method, { projectId, cwd, ...params });
    if (!current()) throw new Error(translate("Host connection changed."));
    return result;
  };
  return {
    loadIndex: () => request<GitDiffIndex>("git.index", {}),
    loadDiff: async (path) => {
      // Existing Hosts expose HEAD → index and index → disk. Mobile reviews
      // one combined HEAD → disk diff, including partially staged changes.
      const [staged, working] = await Promise.all([
        request<GitFileDiff>("git.fileDiff", { path, staged: true }),
        request<GitFileDiff>("git.fileDiff", { path, staged: false }),
      ]);
      return {
        ...working,
        original: staged.original,
        binary: staged.binary || working.binary,
        tooLarge: staged.tooLarge || working.tooLarge,
      };
    },
  };
}
