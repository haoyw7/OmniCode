import { setRemoteCommandRunner, setLocalWorkspaceRunner } from "../../../platform/tauri/fs";
import { remoteMachineFor, remoteRequest } from "./connections";
import { parseRemotePath, remotePath, sharedHostEnvironment, sharedProjects, ensureSharedProject, remoteProjectFor, rememberProjectMove } from "./remoteProjects";
import { wslPath, type WslProjectMachine } from "../../../shared/lib/wslPaths";
import { knownProjectPaths, isLocalProject } from "../../projects/model/recents";
import { HOST_ATTACHMENT_READ_CAPABILITY } from "../../../contracts/hostMedia";
import { loadRemoteHostDescriptor } from "./remoteHostMetadata";

/** File commands a connected machine answers exactly as this computer does
 * (see host/workspace-commands.ts). */
const HOST_COMMANDS = new Set([
  "list_dir",
  "list_project_files",
  "read_text_file",
  "read_binary_file",
  "inspect_paths",
  "read_file_base64",
  "read_attachment_chunk",
  "read_file_preview",
  "write_text_file",
  "stat_files",
  "create_path",
  "rename_path",
  "delete_path",
  "copy_path",
  "move_path",
  "git_diff_index",
  "git_diff_files",
  "git_diff_stats",
  "git_file_diff",
  "git_stage_contents",
  "git_stage_file",
  "git_unstage_file",
  "git_discard_file",
  "git_discard_all",
  "git_stage_all",
  "git_unstage_all",
  "git_commit",
  "git_head_message",
  "git_push",
  "git_pull",
  "git_sync",
  "git_pr_status",
  "git_pr_create",
  "git_history",
  "git_commit_files",
  "git_commit_file_diff",
  "git_base_diff_files",
  "git_base_file_diff",
  "git_staged_context",
  "git_range_context",
  "git_branches",
  "git_checkout",
  "git_create_branch",
  "git_stash",
  "git_worktrees",
  "search_project",
]);
/** Arguments that hold paths; everything else is passed through untouched. */
const PATH_ARGS = ["path", "cwd", "parent", "from", "destParent", "paths"];
/** Commands whose string result is a path. */
const PATH_RESULTS = new Set([
  "create_path",
  "rename_path",
  "copy_path",
  "move_path",
]);
/** Commands whose result entries carry a `path`. */
const ENTRY_RESULTS = new Set(["list_dir", "list_project_files", "stat_files", "inspect_paths"]);

const UNAVAILABLE = "This isn’t available for projects on another machine yet.";
const OUTDATED =
  "Update OmniCode Host in Connections settings to use this project’s files.";

async function requireAttachmentReads(command: string, machineId: string, environmentId: string) {
  if (!["inspect_paths", "read_file_base64"].includes(command)) return;
  const descriptor = await loadRemoteHostDescriptor(machineId, environmentId);
  if (!descriptor.capabilities.includes(HOST_ATTACHMENT_READ_CAPABILITY)) throw new Error(OUTDATED);
}

/** Runs a file command whose paths are `remote://` paths on the machine that
 * owns them, translating paths both ways so callers never see host paths. */
export async function runRemoteCommand(
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!HOST_COMMANDS.has(command)) throw new Error(UNAVAILABLE);
  let environmentId: string | undefined;
  let executionMachine: WslProjectMachine | undefined;
  const toHost = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(toHost);
    if (typeof value !== "string") return value;
    const parsed = parseRemotePath(value);
    if (!parsed || (environmentId && (parsed.environmentId !== environmentId ||
        parsed.machine?.distribution !== executionMachine?.distribution)))
      throw new Error(
        "Files can only be copied or moved within one machine.",
      );
    environmentId = parsed.environmentId;
    executionMachine = parsed.machine;
    return parsed.hostPath;
  };
  const hostArgs = Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      PATH_ARGS.includes(key)
        ? toHost(value)
        : key === "options" && value && typeof value === "object" && !Array.isArray(value)
          ? { ...value, cwd: toHost((value as Record<string, unknown>).cwd) }
          : value,
    ]),
  );
  if (!environmentId) throw new Error(UNAVAILABLE);
  const env = environmentId;
  const machine = await remoteMachineFor(env);
  if (!machine)
    throw new Error("This project’s machine isn’t connected on this computer.");
  await requireAttachmentReads(command, machine.id, env);
  let result: unknown;
  try {
    result = await remoteRequest(machine.id, "workspace.run", {
      command,
      args: hostArgs,
      ...(executionMachine ? { machine: executionMachine } : {}),
    });
  } catch (reason) {
    if (/Unsupported (host method|remote operation)/i.test(String(reason)))
      throw new Error(OUTDATED);
    throw reason;
  }
  const fromHost = (path: string) => executionMachine ? wslPath(executionMachine.distribution, path) : remotePath(env, path);
  if (command === "rename_path" && typeof args.path === "string" && typeof result === "string") {
    const previous = remoteProjectFor(args.path);
    if (previous?.projectId) rememberProjectMove(previous, { id: previous.projectId, cwd: result, name: result.split(/[\\/]/).at(-1) ?? result, machine: previous.machine });
  }
  if (PATH_RESULTS.has(command) && typeof result === "string")
    return fromHost(result);
  if (ENTRY_RESULTS.has(command) && Array.isArray(result))
    return result.map((entry: { path: string }) => ({
      ...entry,
      path: fromHost(entry.path),
    }));
  if ((command === "git_diff_index" || command === "git_diff_files") && result && typeof result === "object") {
    const index = result as { files: { path: string }[] };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return {
      ...index,
      files: index.files.map((file) => ({
        ...file,
        path: fromHost(`${root}/${file.path}`),
      })),
    };
  }
  if (command === "git_file_diff" && result && typeof result === "object") {
    const diff = result as { path: string };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return { ...diff, path: fromHost(`${root}/${diff.path}`) };
  }
  if (command === "git_commit_files" && Array.isArray(result)) {
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return result.map((file: { path: string }) => ({
      ...file,
      path: fromHost(`${root}/${file.path}`),
    }));
  }
  if (command === "git_base_diff_files" && result && typeof result === "object") {
    const diff = result as { files: { path: string }[] };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return {
      ...diff,
      files: diff.files.map((file) => ({ ...file, path: fromHost(`${root}/${file.path}`) })),
    };
  }
  if (
    (command === "git_commit_file_diff" || command === "git_base_file_diff") &&
    result &&
    typeof result === "object"
  ) {
    const diff = result as { path: string };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return { ...diff, path: fromHost(`${root}/${diff.path}`) };
  }
  if (command === "search_project" && result && typeof result === "object") {
    const search = result as { matches: { path: string }[] };
    return {
      ...search,
      matches: search.matches.map((match) => ({ ...match, path: fromHost(match.path) })),
    };
  }
  if (command === "git_worktrees" && result && typeof result === "object") {
    const worktrees = result as { defaultRoot: string; worktrees: { path: string }[] };
    return {
      ...worktrees,
      defaultRoot: fromHost(worktrees.defaultRoot),
      worktrees: worktrees.worktrees.map((tree) => ({ ...tree, path: fromHost(tree.path) })),
    };
  }
  return result;
}

setRemoteCommandRunner(runRemoteCommand);

const localPathKey = (path: string) => {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
};
const localWorktrees = new Set<string>();

export function ownsLocalWorkspaceCommand(command: string, args: Record<string, unknown>): boolean {
  if (!HOST_COMMANDS.has(command)) return false;
  // Commands with a working directory are always project operations. Pure file
  // operations are owned only inside registered projects and their worktrees.
  const cwd = args.cwd ?? (args.options as { cwd?: unknown } | undefined)?.cwd;
  if (typeof cwd === "string" && cwd !== "~" && cwd.length > 0) return true;
  const roots = [...sharedProjects().filter(p => !p.machine).map(p => localPathKey(p.cwd)),
    ...knownProjectPaths().filter(isLocalProject).map(localPathKey), ...localWorktrees];
  return PATH_ARGS.some(key => {
    const values = Array.isArray(args[key]) ? args[key] as unknown[] : [args[key]];
    return values.some(value => typeof value === "string" && roots.some(root => {
      const path = localPathKey(value);
      return path === root || path.startsWith(`${root}/`);
    }));
  });
}

export async function runLocalWorkspaceCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  if (!HOST_COMMANDS.has(command)) throw new Error(UNAVAILABLE);
  const environment = sharedHostEnvironment();
  if (!environment) throw new Error("Shared conversation service is not connected");
  const machine = await remoteMachineFor(environment);
  if (!machine) throw new Error("Shared conversation service is not connected");
  await requireAttachmentReads(command, machine.id, environment);
  const cwd = args.cwd ?? (args.options as { cwd?: unknown } | undefined)?.cwd;
  if (typeof cwd === "string" && !localWorktrees.has(localPathKey(cwd))) await ensureSharedProject(cwd);
  if (typeof cwd !== "string") {
    const candidates = knownProjectPaths().filter(isLocalProject);
    const roots = new Set<string>();
    for (const key of PATH_ARGS) for (const value of Array.isArray(args[key]) ? args[key] as unknown[] : [args[key]]) {
      if (typeof value !== "string") continue;
      const path = localPathKey(value);
      const root = candidates.filter(candidate => path === localPathKey(candidate) || path.startsWith(`${localPathKey(candidate)}/`))
        .sort((a, b) => b.length - a.length)[0];
      if (root) roots.add(root);
    }
    for (const root of roots) await ensureSharedProject(root);
  }
  const result = await remoteRequest<unknown>(machine.id, "workspace.run", { command, args });
  if (command === "rename_path" && typeof args.path === "string" && typeof result === "string") {
    const previous = sharedProjects().find(project => localPathKey(project.cwd) === localPathKey(String(args.path)));
    if (previous) rememberProjectMove(previous, { id: previous.projectId, cwd: result, name: result.split(/[\\/]/).at(-1) ?? result });
  }
  if (command === "git_worktrees" && result && typeof result === "object") {
    for (const tree of (result as { worktrees: { path: string }[] }).worktrees) localWorktrees.add(localPathKey(tree.path));
  }
  // Host Git DTOs use relative paths; native desktop DTOs carry absolute paths.
  const absolute = (path: string) => `${String(cwd).replace(/[\\/]+$/, "")}/${path}`;
  if (result && typeof result === "object" && ["git_diff_index", "git_diff_files", "git_base_diff_files"].includes(command)) {
    const index = result as { files: { path: string }[] };
    return { ...index, files: index.files.map(file => ({ ...file, path: absolute(file.path) })) };
  }
  if (result && typeof result === "object" && ["git_file_diff", "git_commit_file_diff", "git_base_file_diff"].includes(command)) {
    const diff = result as { path: string };
    return { ...diff, path: absolute(diff.path) };
  }
  if (command === "git_commit_files" && Array.isArray(result))
    return result.map(file => ({ ...file, path: absolute(file.path) }));
  return result;
}

setLocalWorkspaceRunner(runLocalWorkspaceCommand, ownsLocalWorkspaceCommand);
