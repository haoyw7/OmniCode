import { remoteMachineFor, remoteRequest } from "./connections";
import { ensureSharedProject, remoteProjectFor, parseRemotePath, projectPath } from "./remoteProjects";
import type { HostDescriptor } from "../../../contracts/protocol";
import { HOST_WORKTREE_PROGRESS_CAPABILITY, type Worktree, type WorktreeProgress, type WorktreeRemoval } from "../../../contracts/worktree";

const PROGRESS_POLL_MS = 250;

/**
 * Creates a worktree on its Host and reports Git's output as it arrives. Hosts
 * without live progress still return the complete log with the created tree.
 */
export async function createWorktreeWithProgress<T extends { log?: string[] }>(
  machineId: string,
  capabilities: readonly string[],
  params: Record<string, unknown>,
  onLine?: (line: string) => void,
): Promise<T> {
  if (!onLine || !capabilities.includes(HOST_WORKTREE_PROGRESS_CAPABILITY)) {
    const tree = await remoteRequest<T>(machineId, "git.worktreeCreate", params);
    for (const line of tree.log ?? []) onLine?.(line);
    return tree;
  }
  const progressId = crypto.randomUUID();
  let offset = 0;
  let reading: Promise<void> | undefined;
  const drain = () => reading ??= remoteRequest<WorktreeProgress>(machineId, "git.worktreeProgress", { progressId, offset })
    .then(progress => {
      if (progress.offset < offset) return;
      offset = progress.offset;
      for (const line of progress.lines) onLine(line);
    }, () => undefined)
    .finally(() => { reading = undefined; });
  const timer = setInterval(() => void drain(), PROGRESS_POLL_MS);
  try {
    const tree = await remoteRequest<T>(machineId, "git.worktreeCreate", { ...params, progressId });
    clearInterval(timer);
    await reading;
    await drain();
    // Lines retained only in the final log (for example after a missed read) still reach the caller.
    for (const line of (tree.log ?? []).slice(offset)) onLine(line);
    return tree;
  } finally {
    clearInterval(timer);
  }
}

export async function hostWorktreeCommand<T>(cwd: string, method: string, args: Record<string, unknown>,
  onLine?: (line: string) => void): Promise<T> {
  let project = remoteProjectFor(cwd);
  if (!project || project.local && !project.projectId) project = await ensureSharedProject(cwd);
  const machine = await remoteMachineFor(project.environmentId);
  if (!machine) throw new Error("Shared conversation service is not connected");
  const descriptor = await remoteRequest<HostDescriptor>(machine.id, "environment.describe");
  const capability = method === "git.worktreeCreate" ? "git.worktreeCreate" : "git.worktreeLifecycle.v1";
  if (!descriptor.capabilities.includes(capability)) throw new Error("Update OmniCode Host to manage working copies");
  const path = typeof args.path === "string" ? parseRemotePath(args.path) : undefined;
  if (path && (path.environmentId !== project.environmentId || path.machine?.distribution !== project.machine?.distribution))
    throw new Error("The working copy belongs to another machine");
  const request = { ...args, ...(path ? { path: path.hostPath } : {}), projectId: project.projectId, cwd: project.cwd };
  const result = method === "git.worktreeCreate"
    ? await createWorktreeWithProgress<Worktree>(machine.id, descriptor.capabilities, request, onLine) as T
    : await remoteRequest<T>(machine.id, method, request);
  if (method === "git.worktreeCreate") {
    const tree = result as Worktree;
    return { ...tree, path: projectPath(project, tree.path) } as T;
  }
  if (method === "git.worktreeRemove") {
    const removed = result as WorktreeRemoval;
    return { ...removed, projectCwd: projectPath(project, removed.projectCwd) } as T;
  }
  return result;
}
