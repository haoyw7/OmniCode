import { remoteMachineFor, remoteRequest } from "./connections";
import {
  ensureSharedProject,
  parseRemotePath,
  remoteProjectFor,
  sharedHostEnvironment,
} from "./remoteProjects";
import type { HostDescriptor } from "../../../contracts/protocol";

/** Inbox network access and saved credentials belong to the local Host. */
export async function inboxHostCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  let project;
  if (typeof args?.cwd === "string") {
    const known = remoteProjectFor(args.cwd);
    if (known?.projectId) project = known;
    else if (!parseRemotePath(args.cwd))
      project = await ensureSharedProject(args.cwd);
    else throw new Error("Remote project is not connected");
  }
  const environment = project?.environmentId ?? sharedHostEnvironment();
  if (!environment)
    throw new Error("Shared conversation service is not connected");
  const machine = await remoteMachineFor(environment);
  if (!machine) throw new Error("Shared conversation service is not connected");
  const provider = command.startsWith("git_github_") ? "github" : command.startsWith("azure_devops_")
    ? "azuredevops"
    : command.split("_", 1)[0];
  const descriptor = await remoteRequest<HostDescriptor>(
    machine.id,
    "environment.describe",
  );
  if (!descriptor.capabilities?.includes(`inbox.${provider}.v1`))
    throw new Error("Update OmniCode Host to use this inbox connection");
  return remoteRequest<T>(machine.id, "inbox.run", {
    command,
    ...(project ? { projectId: project.projectId } : {}),
    args: project ? { ...args, cwd: project.cwd } : (args ?? {}),
  });
}
