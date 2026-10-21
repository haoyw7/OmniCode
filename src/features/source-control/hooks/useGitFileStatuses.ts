import { useQuery } from "@tanstack/react-query";
import { gitDiffIndex, type GitDiffIndex } from "../../../platform/tauri/fs";
import { parentPath } from "../../../shared/lib/paths";
import { queryClient } from "../../../shared/lib/queryClient";
import { gitKeys, installGitQueryInvalidation, isGitCwd } from "../model/gitQueries";

export type GitStatusMap = {
  files: Map<string, string>;
  dirs: Map<string, string>;
};

const STATUS_PRIORITY: Record<string, number> = {
  modified: 3,
  deleted: 2,
  added: 1,
  untracked: 1,
};

const EMPTY: GitStatusMap = { files: new Map(), dirs: new Map() };

function buildStatusMaps(index: GitDiffIndex, cwd: string): GitStatusMap {
  const files = new Map<string, string>();
  const dirs = new Map<string, string>();
  for (const file of index.files) {
    files.set(file.path, file.status);
    const prio = STATUS_PRIORITY[file.status] ?? 0;
    if (prio === 0) continue;
    let dir = parentPath(file.path);
    while (dir.length > cwd.length) {
      const existing = dirs.get(dir);
      const existingPrio = existing ? (STATUS_PRIORITY[existing] ?? 0) : 0;
      if (prio > existingPrio) {
        dirs.set(dir, file.status);
      } else {
        break;
      }
      dir = parentPath(dir);
    }
  }
  return { files, dirs };
}

function sameMaps(
  a: Map<string, string>,
  b: Map<string, string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of b) {
    if (a.get(k) !== v) return false;
  }
  return true;
}

function sameData(a: GitStatusMap, b: GitStatusMap): boolean {
  return sameMaps(a.files, b.files) && sameMaps(a.dirs, b.dirs);
}

export function useGitFileStatuses(
  cwd: string,
  enabled: boolean,
): GitStatusMap {
  const active = enabled && isGitCwd(cwd);
  if (active) installGitQueryInvalidation();
  const { data } = useQuery(
    {
      queryKey: gitKeys.fileStatuses(cwd),
      queryFn: () => gitDiffIndex(cwd).then((index) => buildStatusMaps(index, cwd), () => EMPTY),
      enabled: active,
      // Status maps hold Maps, which default structural sharing cannot compare.
      structuralSharing: (old, next) =>
        old && sameData(old as GitStatusMap, next as GitStatusMap) ? old : next,
    },
    queryClient,
  );
  return active ? data ?? EMPTY : EMPTY;
}
