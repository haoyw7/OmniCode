import {
  isRemoteProjectPath,
  REMOTE_PROJECT_PREFIX,
} from "../../projects/model/recents";
import type { HostProject, RemoteMachine } from "./protocol";
import type { Session } from "../../sessions/model/session";
import { parseWslPath, wslPath, type WslProjectMachine } from "../../../shared/lib/wslPaths";

/** Every conversation in a Host project runs there, including imported native ones. */
export const sessionUsesHost = (session: Pick<Session, "cwd" | "inboxAsk">) =>
  !session.inboxAsk && !!remoteProjectFor(session.cwd);

/** A rail project whose folder lives on another machine. */
export type RemoteProject = {
  key: string;
  environmentId: string;
  /** The host's ID for this folder. */
  projectId: string;
  /** The folder's path on the host. */
  cwd: string;
  /** Host on this computer; files and terminals keep their native paths. */
  local?: boolean;
  machine?: WslProjectMachine;
};

const KEY = "monocode.remote-projects.v2";
export const REMOTE_PROJECTS_CHANGED = "monocode:remote-projects-changed";

const slashed = (path: string) => path.replace(/\\/g, "/");
let localEnvironment: string | undefined;
let localMachineId: string | undefined;
const localProjects = new Map<string, RemoteProject>();
const openingProjects = new Map<string, Promise<RemoteProject>>();
export const sharedHostEnvironment = () => localEnvironment;
export const sharedHostMachineId = () => localMachineId;
export const isSharedHostMachine = (machine: Pick<RemoteMachine, "id" | "environmentId">) =>
  machine.id === localMachineId || machine.environmentId === localEnvironment;
export const sharedProjects = () => [...localProjects.values()];
const localKey = (cwd: string) => slashed(cwd).replace(/\/+$/, "") || "/";
export const sharedProjectKey = (project: Pick<HostProject, "cwd" | "machine">) =>
  project.machine?.kind === "wsl" ? wslPath(project.machine.distribution, project.cwd).replace(/\/+$/, "") : localKey(project.cwd);

/** Path to hand file/Git/terminal UI while keeping account ownership on this Host. */
export function projectPath(project: Pick<RemoteProject, "environmentId" | "local" | "machine">, path: string): string {
  return project.machine?.kind === "wsl" ? wslPath(project.machine.distribution, path)
    : project.local ? path : remotePath(project.environmentId, path);
}
export function configureSharedHost(environmentId: string | undefined, projects: HostProject[], machineId?: string) {
  const changed = localEnvironment !== environmentId;
  localEnvironment = environmentId;
  localMachineId = machineId;
  if (changed || !environmentId) localProjects.clear();
  if (!environmentId) return;
  for (const project of projects) localProjects.set(sharedProjectKey(project), {
    key: sharedProjectKey(project), cwd: project.cwd, environmentId,
    projectId: project.id, local: true, ...(project.machine ? { machine: project.machine } : {}) });
}
export async function ensureSharedProject(cwd: string): Promise<RemoteProject> {
  const wsl = parseWslPath(cwd);
  const key = wsl ? sharedProjectKey({ cwd: wsl.hostPath, machine: wsl.machine }) : localKey(cwd);
  const known = localProjects.get(key);
  if (known) return known;
  if (!localEnvironment) throw new Error("Shared conversation service is not connected");
  const pending = openingProjects.get(key);
  if (pending) return pending;
  const environmentId = localEnvironment;
  const request = (async () => {
    const { remoteMachineFor, remoteRequest } = await import("./connections");
    const machine = await remoteMachineFor(environmentId);
    if (!machine) throw new Error("Shared conversation service is not connected");
    const project = await remoteRequest<HostProject>(machine.id, "projects.open", {
      cwd: wsl?.hostPath ?? cwd, ...(wsl ? { machine: wsl.machine } : {}),
    });
    const value = { key, cwd: project.cwd, environmentId, projectId: project.id, local: true,
      ...(project.machine ? { machine: project.machine } : {}) };
    localProjects.set(key, value);
    window.dispatchEvent(new Event(REMOTE_PROJECTS_CHANGED));
    return value;
  })();
  openingProjects.set(key, request);
  try { return await request; } finally { openingProjects.delete(key); }
}

export function remoteProjectKey(environmentId: string, cwd: string): string {
  return remotePath(environmentId, slashed(cwd).replace(/\/+$/, ""));
}

/** How this app addresses a path on another machine: under that machine's
 * `remote://<environment>/` root, so every file view can tell where it lives. */
export function remotePath(environmentId: string, hostPath: string): string {
  const path = slashed(hostPath);
  // Keep the second leading slash of a Windows UNC path.
  return `${REMOTE_PROJECT_PREFIX}${environmentId}/${path.startsWith("//") ? path.slice(1) : path.replace(/^\/+/, "")}`;
}

/** The machine and host path behind a `remote://` path. */
export function parseRemotePath(
  path: string,
): { environmentId: string; hostPath: string; machine?: WslProjectMachine } | undefined {
  const wsl = parseWslPath(path);
  if (wsl) return { environmentId: localEnvironment ?? "", ...wsl };
  if (!isRemoteProjectPath(path)) return undefined;
  const rest = slashed(path).slice(REMOTE_PROJECT_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined;
  const hostPath = rest.slice(slash + 1);
  return {
    environmentId: rest.slice(0, slash),
    // Windows hosts keep their drive letter and UNC prefix; POSIX paths regain their root.
    hostPath: /^[A-Za-z]:(\/|$)/.test(hostPath) ? hostPath : `/${hostPath}`,
  };
}

function readAll(): Record<string, RemoteProject> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object"
      ? (value as Record<string, RemoteProject>)
      : {};
  } catch {
    return {};
  }
}

/** The remote path git operations should run in for the active session: the
 * checkout the tab itself points at — the attached host session's work path
 * or a worktree picked before the first message (`tabCwd`, a host path) —
 * then the session's own work path when it differs from the project root (a
 * linked worktree), not the terminal tab's cwd, which follows the shell a
 * session was launched from rather than the repo its changes live in. The
 * sidebar's Changes panel resolves the same order, so a diff opens in the
 * checkout whose files the panel lists. */
export function remoteSessionGitCwd(
  project: Pick<RemoteProject, "environmentId" | "cwd" | "local" | "machine">,
  gitCwd: string | undefined,
  projectRoot: string,
  tabCwd?: string,
): string {
  // Shared Hosts on this machine still use native filesystem commands.
  if (project.local && !project.machine) return gitCwd ?? project.cwd;
  if (tabCwd)
    return parseRemotePath(tabCwd)
      ? tabCwd
      : projectPath(project, tabCwd);
  if (gitCwd && parseRemotePath(gitCwd)) return gitCwd;
  return projectPath(
    project,
    gitCwd && gitCwd !== projectRoot ? gitCwd : project.cwd,
  );
}

export function remoteProjectFor(path: string): RemoteProject | undefined {
  const wsl = parseWslPath(path);
  if (wsl) {
    const key = sharedProjectKey({ cwd: wsl.hostPath, machine: wsl.machine });
    return localEnvironment ? localProjects.get(key) ?? {
      key, cwd: wsl.hostPath, machine: wsl.machine, projectId: "", environmentId: localEnvironment, local: true,
    } : undefined;
  }
  if (!isRemoteProjectPath(path)) return localEnvironment && path && path !== "~"
    ? localProjects.get(localKey(path)) ?? { key: localKey(path), cwd: path,
      projectId: "", environmentId: localEnvironment, local: true }
    : undefined;
  const key = slashed(path).replace(/\/+$/, "");
  const projects = readAll();
  return projects[key] ?? Object.values(projects).find(
    (project) => remoteProjectKey(project.environmentId, project.cwd) === key,
  );
}

export function rememberRemoteProject(
  environmentId: string,
  project: HostProject,
): RemoteProject {
  const remote: RemoteProject = {
    key: remoteProjectKey(environmentId, project.cwd),
    environmentId,
    projectId: project.id,
    cwd: project.cwd,
  };
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...readAll(), [remote.key]: remote }),
    );
  } catch {
    /* the rail entry still works for this session */
  }
  window.dispatchEvent(new Event(REMOTE_PROJECTS_CHANGED));
  return remote;
}

export function remoteProjectsOn(environmentId: string): RemoteProject[] {
  return Object.values(readAll()).filter(
    (project) => project.environmentId === environmentId,
  );
}
