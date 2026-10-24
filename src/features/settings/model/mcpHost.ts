import {
  HOST_MCP_CAPABILITY, type McpConnection, type McpInspection, type McpJobResult, type McpJobView, type McpOperation, type PiMcpList,
} from "../../../contracts/mcp";
import { remoteMachineFor, remoteRequest } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { ensureSharedProject, parseRemotePath, remoteProjectFor } from "../../connections/model/remoteProjects";

/** MCP configuration and server processes live on the project's Host. */
async function hostScope(cwd: string) {
  let project = remoteProjectFor(cwd);
  if (!project?.projectId && !cwd.startsWith("remote://")) project = await ensureSharedProject(cwd);
  if (!project?.projectId) throw new Error("Shared conversation service is not connected");
  const machine = await remoteMachineFor(project.environmentId);
  if (!machine) throw new Error("Shared conversation service is not connected");
  const descriptor = await loadRemoteHostDescriptor(machine.id, project.environmentId);
  if (!descriptor.capabilities.includes(HOST_MCP_CAPABILITY))
    throw new Error("This Host does not support MCP management. Update the Host to continue.");
  return { machineId: machine.id, projectId: project.projectId, cwd: parseRemotePath(cwd)?.hostPath ?? cwd };
}

export async function discoverMcpServers(cwd: string): Promise<McpConnection[]> {
  const scope = await hostScope(cwd);
  return remoteRequest<McpConnection[]>(scope.machineId, "mcp.discover", { projectId: scope.projectId, cwd: scope.cwd });
}

async function runMcpJob<T extends McpJobResult["operation"]>(cwd: string, operation: McpOperation & { operation: T }): Promise<Extract<McpJobResult, { operation: T }>> {
  const scope = await hostScope(cwd);
  const requestId = crypto.randomUUID();
  let view = await remoteRequest<McpJobView>(scope.machineId, "mcp.start", { ...operation, requestId, projectId: scope.projectId, cwd: scope.cwd });
  // Status waits on the Host, so long sign-ins and inspections need few polls.
  while (view.status === "running") view = await remoteRequest<McpJobView>(scope.machineId, "mcp.status", { requestId });
  if (view.status === "failed") throw new Error(view.error);
  if (view.status === "cancelled") throw new Error("MCP request cancelled");
  if (view.result.operation !== operation.operation) throw new Error("Unexpected MCP response");
  return view.result as Extract<McpJobResult, { operation: T }>;
}

export async function claudeMcpList(cwd: string): Promise<string> {
  return (await runMcpJob(cwd, { operation: "claudeList" })).output;
}

export async function piMcpList(cwd: string): Promise<PiMcpList> {
  return (await runMcpJob(cwd, { operation: "piList" })).report;
}

export async function addMcpServer(cwd: string, input: Omit<Extract<McpOperation, { operation: "add" }>, "operation">): Promise<void> {
  await runMcpJob(cwd, { operation: "add", ...input });
}

export async function removeClaudeMcpServer(cwd: string, input: { name: string; scope: McpConnection["scope"] }): Promise<void> {
  await runMcpJob(cwd, { operation: "remove", ...input });
}

export async function loginMcpServer(cwd: string, input: { provider: McpConnection["provider"]; name: string }): Promise<void> {
  await runMcpJob(cwd, { operation: "login", ...input });
}

export async function inspectHostMcpServer(cwd: string, server: Pick<McpConnection, "provider" | "scope" | "configPath" | "name">): Promise<McpInspection> {
  return (await runMcpJob(cwd, { operation: "inspect", provider: server.provider, scope: server.scope, configPath: server.configPath, name: server.name })).inspection;
}
