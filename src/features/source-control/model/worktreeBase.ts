import type { GitBranches } from "../../../platform/tauri/fs";

/** Keep a chosen source; otherwise prefer the repository's local main branch. */
export function resolveWorktreeBase(
  base: string | undefined,
  branches: GitBranches | null | undefined,
  current?: string,
): string | undefined {
  if (base && base !== "HEAD") return base;
  const main = branches?.branches.find(
    (branch) => !branch.remote && branch.name === "main",
  );
  return main?.name || current || branches?.current || base || undefined;
}
