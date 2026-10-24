import type { HarnessId } from "../../../contracts/session";
import { PROVIDER_AUXILIARY_CAPABILITY, type ProviderAuxiliaryRequest, type ProviderAuxiliaryResult, type ProviderAuxiliaryView } from "../../../contracts/providerAuxiliary";
import { remoteMachineFor, remoteRequest } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { ensureSharedProject, parseRemotePath, remoteProjectFor } from "../../connections/model/remoteProjects";
import type { PrContent } from "../../../domain/gitText";
import { selectedProviderAccountId, supportsProviderAccounts } from "./providerAccounts";

async function generate(cwd: string, fields: Pick<ProviderAuxiliaryRequest, "operation" | "harness" | "message">,
  signal?: AbortSignal): Promise<ProviderAuxiliaryResult> {
  signal?.throwIfAborted();
  let project = remoteProjectFor(cwd);
  if (!project?.projectId && !cwd.startsWith("remote://")) project = await ensureSharedProject(cwd);
  if (!project?.projectId) throw new Error("Shared conversation service is not connected");
  const machine = await remoteMachineFor(project.environmentId);
  if (!machine) throw new Error("Shared conversation service is not connected");
  const descriptor = await loadRemoteHostDescriptor(machine.id, project.environmentId);
  if (!descriptor.capabilities.includes(PROVIDER_AUXILIARY_CAPABILITY))
    throw new Error("This Host does not support auxiliary text generation. Update the Host to continue.");
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  const scope = { requestId, projectId: project.projectId };
  const cancel = () => { void remoteRequest(machine.id, "providers.auxiliary.cancel", scope).catch(() => undefined); };
  let rejectAborted: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
  const onAbort = () => { cancel(); rejectAborted?.(signal?.reason ?? new Error("Text generation cancelled")); };
  signal?.addEventListener("abort", onAbort, { once: true });
  const harness = fields.harness as HarnessId | undefined;
  try {
    const task = (async () => {
      let value = await remoteRequest<ProviderAuxiliaryView>(machine.id, "providers.auxiliary.start", {
        ...scope, cwd: parseRemotePath(cwd)?.hostPath ?? cwd, ...fields,
        ...(harness && supportsProviderAccounts(harness) ? { providerAccountId: selectedProviderAccountId(harness, cwd) } : {}),
      });
      while (value.status === "running") {
        signal?.throwIfAborted();
        value = await remoteRequest<ProviderAuxiliaryView>(machine.id, "providers.auxiliary.read", scope);
      }
      if (value.status === "completed") return value.result;
      if (value.status === "failed") throw new Error(value.error);
      throw new Error("Text generation cancelled");
    })();
    if (signal?.aborted) onAbort();
    return await Promise.race([task, aborted]);
  } catch (error) {
    // Ambiguous start/read failures also cancel the device-owned job. Its
    // tombstone prevents a delayed start response from orphaning a provider.
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function generateCommitMessage(cwd: string, harness?: HarnessId, signal?: AbortSignal): Promise<string> {
  const value = await generate(cwd, { operation: "commit", harness }, signal);
  if (value.operation !== "commit") throw new Error("Unexpected text generation response");
  return value.message;
}

export async function generatePrContent(cwd: string, harness?: HarnessId): Promise<PrContent & { base: string; head: string }> {
  const value = await generate(cwd, { operation: "pullRequest", harness });
  if (value.operation !== "pullRequest") throw new Error("Unexpected text generation response");
  return value;
}

export async function generateHostBranchName(harness: HarnessId, cwd: string, message: string): Promise<string | null> {
  const value = await generate(cwd, { operation: "branch", harness, message });
  if (value.operation !== "branch") throw new Error("Unexpected text generation response");
  return value.branch;
}
