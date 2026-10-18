import { sanitizeBranchFragment } from "./gitText";

export const WORKTREE_NAME_ERROR =
  "Could not generate a worktree name. Check the title model or agent connection and retry.";

/** Resolve the name before creating either the branch or its working directory. */
export async function generateWorktreeBranch(
  generators: readonly (() => Promise<string | null>)[],
): Promise<string> {
  for (const generate of generators) {
    try {
      const value = await generate();
      const fragment = sanitizeBranchFragment(value ?? "")
        .replace(/^(?:mc|monocode)\//, "")
        .replace(/\//g, "-");
      if (fragment) return `mc/${fragment}`;
    } catch {
      // A configured model can be unavailable while the agent still works.
    }
  }
  throw new Error(WORKTREE_NAME_ERROR);
}

/** Desktop uses the branch slug; Host prefixes that directory name with wt-. */
export function availableWorktreeBranch(
  generated: string,
  branches: readonly string[],
  paths: readonly string[],
): string {
  const folders = new Set(
    paths.map((path) =>
      path.replace(/\\/g, "/").split("/").pop()?.toLowerCase(),
    ),
  );
  const occupied = (name: string) => {
    const slug = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    return (
      branches.some(
        (branch) => branch === name || branch.startsWith(`${name}/`),
      ) ||
      folders.has(slug) ||
      folders.has(`wt-${slug}`)
    );
  };
  let branch = generated;
  for (let suffix = 2; occupied(branch); suffix++)
    branch = `${generated}-${suffix}`;
  return branch;
}
