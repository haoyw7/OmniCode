import { invoke } from "@tauri-apps/api/core";
import type { HostProject, RemoteMachine, SshSetup } from "../../contracts/protocol";

export type PreparedDesktopHost = {
  machine: RemoteMachine;
  projects: HostProject[];
  sessions: { id: string; cwd: string; deleted?: boolean; projectId?: string }[];
  retiredSessionIds?: string[];
};

export type SshConfigHost = { alias: string; hostName?: string; user?: string; port?: number };

/** Endpoint credentials and SSH tunnels stay local to the desktop shell. */
export function listDesktopConnections(): Promise<RemoteMachine[]> {
  return invoke("remote_machines");
}

export function pairDesktopConnection(name: string, url: string, token: string): Promise<RemoteMachine> {
  return invoke("remote_connect", { name, url, token });
}

export function removeDesktopConnection(machineId: string): Promise<void> {
  return invoke("remote_disconnect", { machineId });
}

/**
 * CLI path overrides are fixed for this app process; the shell hands the
 * active set to the local Host it launches.
 */
export function activateDesktopProviderBinaryPaths(paths: Record<string, string>): Promise<Record<string, string>> {
  return invoke("harness_runtime_binary_paths", { paths });
}

export function prepareDesktopHost(): Promise<PreparedDesktopHost> {
  return invoke("shared_host_prepare");
}

export function listDesktopSshAliases(): Promise<SshConfigHost[]> {
  return invoke("remote_ssh_config_hosts");
}

export function beginDesktopSshConnection(target: string, name: string, port: number | null): Promise<string> {
  return invoke("remote_ssh_begin", { target, name, port });
}

export function reconnectDesktopSsh(machineId: string, upgrade = false): Promise<string> {
  return invoke("remote_ssh_reconnect", { machineId, ...(upgrade ? { upgrade: true } : {}) });
}

export function pollDesktopSshConnection(jobId: string): Promise<SshSetup> {
  return invoke("remote_ssh_poll", { jobId });
}

export function cancelDesktopSshConnection(jobId: string): Promise<void> {
  return invoke("remote_ssh_cancel", { jobId });
}

export function answerDesktopSshPrompt(jobId: string, promptId: string, answer: string): Promise<void> {
  return invoke("remote_ssh_answer", { jobId, promptId, answer });
}
