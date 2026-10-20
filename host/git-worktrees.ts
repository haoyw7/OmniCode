import { machineExec as exec, machineFs, machinePath, assertLocalMachinePath, assertMachinePath, currentMachineIO } from "./machine-io";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";

const options = (cwd: string) => ({
  cwd,
  windowsHide: true,
  timeout: 10_000,
  maxBuffer: 1024 * 1024,
});

function availableSync(path: string): boolean {
  assertLocalMachinePath(path);
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export type HostWorktree = {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  missing: boolean;
  /** Git's own output while a new worktree was created, one line per entry. */
  log?: string[];
};
export type HostWorktrees = { worktrees: HostWorktree[]; defaultRoot: string };

/** Display metadata only: execution directories are not proof of linked worktrees. */
export class HostWorktreeStatus {
  private entries = new Map<string, { expires: number; value: Promise<boolean> }>();

  isLinked(cwd: string): Promise<boolean> {
    const io = currentMachineIO();
    const normalize = (path: string) => {
      const resolved = io.path.resolve(path);
      return io.pathStyle === "win32" ? resolved.toLowerCase() : resolved;
    };
    const key = JSON.stringify([io.key, normalize(cwd)]);
    const cached = this.entries.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = (async () => {
      try {
        const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], options(cwd));
        const root = await io.fs.realpath(stdout.trim());
        const { worktrees } = await hostWorktrees(root);
        return worktrees.some((tree) => !tree.isMain && !tree.missing && normalize(tree.path) === normalize(root));
      } catch {
        // Non-repositories, removed checkouts and unavailable machines have no badge.
        return false;
      }
    })();
    if (this.entries.size >= 256) this.entries.clear();
    this.entries.set(key, { expires: Date.now() + 5_000, value });
    return value;
  }
}

const validatedWorktree = new AsyncLocalStorage<{
  machine: string;
  projectCwd: string;
  requested: unknown;
  cwd: string;
  worktree?: HostWorktree;
}>();

/** Resolve over RPC before entering the synchronous session-creation transaction. */
export async function withValidatedHostWorktree<T>(
  projectCwd: string,
  requested: unknown,
  operation: () => T,
): Promise<T> {
  const machine = currentMachineIO().key;
  const cwd = await resolveHostWorktreeAsync(projectCwd, requested);
  const worktree = cwd !== projectCwd
    ? (await hostWorktrees(projectCwd)).worktrees.find((tree) => tree.path === cwd && !tree.missing)
    : undefined;
  if (cwd !== projectCwd && !worktree) throw new Error("Choose an available worktree of this project");
  return validatedWorktree.run({ machine, projectCwd, requested, cwd, worktree }, operation);
}

function gitOutputLines(text: string): string[] {
  return text
    .split(/[\r\n]/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parse(text: string): HostWorktree[] {
  const trees: HostWorktree[] = [];
  let tree: HostWorktree | undefined;
  for (const field of text.split("\0")) {
    if (field.startsWith("worktree ")) {
      tree = {
        path: field.slice(9),
        branch: null,
        head: "",
        isMain: trees.length === 0,
        missing: false,
      };
      trees.push(tree);
    } else if (tree && field.startsWith("HEAD ")) {
      tree.head = field.slice(5);
    } else if (tree && field.startsWith("branch refs/heads/")) {
      tree.branch = field.slice("branch refs/heads/".length);
    }
  }
  return trees;
}

function registeredSync(cwd: string): HostWorktree[] {
  assertLocalMachinePath(cwd);
  const output = execFileSync(
    "git",
    ["worktree", "list", "--porcelain", "-z"],
    {
      ...options(cwd),
      encoding: "utf8",
    },
  );
  return parse(output).map((tree) => ({
    ...tree,
    path: availableSync(tree.path) ? realpathSync.native(tree.path) : tree.path,
  }));
}

/** Snapshot the selected linked checkout's branch when binding a new session. */
export function hostWorktreeAt(projectCwd: string, path: string): HostWorktree | undefined {
  if (currentMachineIO().key !== "local") {
    const verified = validatedWorktree.getStore();
    if (verified?.machine === currentMachineIO().key && verified.projectCwd === projectCwd && verified.cwd === path)
      return verified.worktree;
    throw new Error("Resolve the WSL worktree before creating a session");
  }
  assertLocalMachinePath(projectCwd);
  return registeredSync(projectCwd).find((tree) => tree.path === path);
}

export function resolveHostWorktree(
  projectCwd: string,
  requested: unknown,
): string {
  assertMachinePath(projectCwd);
  if (requested == null || requested === "" || requested === projectCwd)
    return projectCwd;
  if (currentMachineIO().key !== "local") {
    const verified = validatedWorktree.getStore();
    if (verified?.machine === currentMachineIO().key && verified.projectCwd === projectCwd && verified.requested === requested)
      return verified.cwd;
    throw new Error("Resolve the WSL worktree before creating a session");
  }
  if (
    typeof requested !== "string" ||
    requested.includes("\0") ||
    requested.length > 4096
  )
    throw new Error("Invalid working copy");
  const actual = availableSync(requested) ? realpathSync.native(requested) : requested;
  if (actual === projectCwd) return projectCwd;
  const target = registeredSync(projectCwd).find(
    (tree) => tree.path === actual,
  );
  if (!target || !availableSync(target.path))
    throw new Error("Choose an available worktree of this project");
  return realpathSync.native(target.path);
}

export async function resolveHostWorktreeAsync(
  projectCwd: string,
  requested: unknown,
): Promise<string> {
  if (requested == null || requested === "" || requested === projectCwd)
    return projectCwd;
  if (
    typeof requested !== "string" ||
    requested.includes("\0") ||
    requested.length > 4096
  )
    throw new Error("Invalid working copy");
  const actual = await machineFs.realpath(requested).catch(() => requested);
  if (actual === projectCwd) return projectCwd;
  const listed = await hostWorktrees(projectCwd);
  if (!listed.worktrees.some((tree) => tree.path === actual && !tree.missing))
    throw new Error("Choose an available worktree of this project");
  return actual;
}

export async function hostWorktrees(cwd: string): Promise<HostWorktrees> {
  const { stdout } = await exec(
    "git",
    ["worktree", "list", "--porcelain", "-z"],
    options(cwd),
  );
  const worktrees = await Promise.all(parse(stdout).map(async (tree) => ({
    ...tree,
    path: await machineFs.realpath(tree.path).catch(() => tree.path),
    missing: !(await machineFs.stat(tree.path).then((info) => info.isDirectory(), () => false)),
  })));
  const main = worktrees[0];
  if (!main) throw new Error("No working copies found");
  return {
    worktrees,
    defaultRoot: machinePath.join(machinePath.dirname(main.path), `${machinePath.basename(main.path)}-worktrees`),
  };
}

export async function createHostWorktree(
  cwd: string,
  branch: unknown,
  base: unknown,
  existing: unknown,
  sourceCwd = cwd,
): Promise<HostWorktree> {
  if (
    typeof branch !== "string" ||
    !branch ||
    branch.length > 120 ||
    branch.startsWith("-") ||
    branch.startsWith("@")
  )
    throw new Error("Enter a valid branch name");
  await exec("git", ["check-ref-format", "--branch", branch], options(cwd));
  if (
    typeof base !== "string" ||
    base.length > 255 ||
    typeof existing !== "boolean"
  )
    throw new Error("Invalid worktree base");
  const listed = await hostWorktrees(cwd);
  if (listed.worktrees.some((tree) => tree.branch === branch))
    throw new Error(
      "This branch already has a working copy. Select it from the picker.",
    );
  const slug = `wt-${branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const path = machinePath.join(listed.defaultRoot, slug);
  if (await machineFs.lstat(path).then(() => true, () => false))
    throw new Error(`${path} already exists. Choose another branch name.`);
  const refs = (
    await exec(
      "git",
      ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
      options(cwd),
    )
  ).stdout
    .split("\n")
    .filter(Boolean);
  const source = existing
    ? `refs/heads/${branch}`
    : base === "HEAD"
      ? "HEAD"
      : refs.find(
          (ref) =>
            ref === `refs/heads/${base}` || ref === `refs/remotes/${base}`,
        );
  if (!source || (existing && !refs.includes(source)))
    throw new Error("Choose an available base branch");
  const commit = (
    await exec(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${source}^{commit}`],
      options(sourceCwd),
    )
  ).stdout.trim();
  await machineFs.mkdir(listed.defaultRoot, { recursive: true });
  // Git writes its progress to stderr even when the command succeeds.
  const added = existing
    ? await exec("git", ["worktree", "add", "--", path, branch], options(cwd))
    : await exec(
        "git",
        ["worktree", "add", "--no-track", "-b", branch, "--", path, commit],
        options(cwd),
      );
  const created = (await hostWorktrees(cwd)).worktrees.find(
    (tree) => tree.path === path,
  );
  if (!created)
    throw new Error(
      "Worktree created, but could not be found. Refresh the picker.",
    );
  return { ...created, log: gitOutputLines(added.stderr) };
}

/** Rename only the temporary branch created for this specific worktree. */
export async function renameHostWorktreeBranch(
  cwd: string,
  path: string,
  expectedBranch: string,
  branch: string,
  stillOwned: () => boolean = () => true,
): Promise<HostWorktree> {
  if (!/^(?:oc|mc)\/[a-z0-9]{8}$/.test(expectedBranch))
    throw new Error("This is not an automatically created worktree branch");
  if (
    !branch ||
    branch.length > 120 ||
    branch.startsWith("-") ||
    branch.startsWith("@")
  )
    throw new Error("Enter a valid branch name");
  await exec("git", ["check-ref-format", "--branch", branch], options(cwd));
  const tree = (await hostWorktrees(cwd)).worktrees.find(
    (entry) => entry.path === path && !entry.missing,
  );
  if (!tree || tree.isMain || tree.branch !== expectedBranch)
    throw new Error("The worktree branch has changed");
  if (branch === expectedBranch) return tree;
  if (!stillOwned()) throw new Error("The session no longer owns this branch");
  await exec(
    "git",
    ["branch", "-m", expectedBranch, branch],
    options(tree.path),
  );
  const renamed = (await hostWorktrees(cwd)).worktrees.find(
    (entry) => entry.path === path,
  );
  if (!renamed)
    throw new Error("Branch renamed, but its worktree could not be found");
  return renamed;
}
