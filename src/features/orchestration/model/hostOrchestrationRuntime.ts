import { hostOrchestrationClient } from "./orchestrationClient";
import { dispatchRemoteCommand, loadRemoteSessionText } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";

function sourceFor(leadId: string) {
  const source = hostOrchestrationClient.reference(leadId);
  if (!source) throw new Error("Connect to the Host before controlling this run.");
  return source;
}

async function hydrate(leadId: string) {
  const source = sourceFor(leadId);
  const snapshot = await loadRemoteSessionText(source.machineId, source.leadId);
  if (snapshot.projectId !== source.project.projectId)
    throw new Error("This conversation is not attached to its Host");
  hostOrchestrationClient.accept(source, snapshot);
  return snapshot;
}

async function control(leadId: string, action: "resume" | "stop" | "cancelTask", taskId?: string) {
  const source = sourceFor(leadId);
  const descriptor = await loadRemoteHostDescriptor(source.machineId, source.project.environmentId);
  if (!descriptor.capabilities.includes("sessions.orchestration"))
    throw new Error("Update the Host to submit this conversation action.");
  const snapshot = await hydrate(leadId);
  if (!snapshot.orchestration) throw new Error("This orchestration run is no longer available.");
  await dispatchRemoteCommand(source.machineId, source.project.key, source.project.environmentId, {
    type: "orchestration", action, commandId: crypto.randomUUID(), projectId: source.project.projectId,
    sessionId: source.leadId, orchestrationId: snapshot.orchestration.id, ...(taskId ? { taskId } : {}),
  }, leadId);
  await hydrate(leadId);
}

/** The default UI runtime is a Host projection and command client, with no scheduler. */
export const hostOrchestrationRuntime = {
  subscribe: hostOrchestrationClient.subscribe,
  snapshot: hostOrchestrationClient.snapshot,
  hydrate,
  resumeBlocker: (leadId: string) => {
    const source = hostOrchestrationClient.reference(leadId);
    const blocker = source && hostOrchestrationClient.view(source, source.leadId)?.resumeBlocker;
    return source && blocker ? {
      id: hostOrchestrationClient.shellId(source, blocker.sessionId), title: blocker.title,
    } : undefined;
  },
  resumeLeadBusy: (leadId: string) => {
    const source = hostOrchestrationClient.reference(leadId);
    return !!(source && hostOrchestrationClient.view(source, source.leadId)?.resumeLeadBusy);
  },
  resume: (id: string) => control(id, "resume"),
  stop: (id: string) => control(id, "stop"),
  cancelTask: (id: string, taskId: string) => control(id, "cancelTask", taskId),
};
