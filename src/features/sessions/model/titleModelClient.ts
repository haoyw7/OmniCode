import {
  remoteMachineFor,
  remoteRequest,
} from "../../connections/model/connections";
import {
  remoteProjectFor,
  sharedHostMachineId,
} from "../../connections/model/remoteProjects";
import type { GeneratedSessionTitle } from "./sessionTitle";

/** Desktop title requests use the same configured API and credential owner as Host sessions. */
export async function generateConfiguredSessionTitle(
  cwd: string,
  message: string,
): Promise<GeneratedSessionTitle | null> {
  return generateConfigured(cwd, message, "titleModel.generate");
}

export async function generateConfiguredWorktreeName(
  cwd: string,
  message: string,
): Promise<string | null> {
  return generateConfigured(cwd, message, "titleModel.generateBranch");
}

async function generateConfigured<T>(
  cwd: string,
  message: string,
  method: string,
): Promise<T | null> {
  const project = remoteProjectFor(cwd);
  const machineId = project
    ? (await remoteMachineFor(project.environmentId))?.id
    : sharedHostMachineId();
  if (!machineId) return null;
  return remoteRequest(machineId, method, { message });
}
