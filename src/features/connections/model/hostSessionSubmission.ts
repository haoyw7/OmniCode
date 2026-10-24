import type { SubmissionMetadata, SubmissionOutcome, Attachment, ComposerTurnOptions, Session, OrchestrationProposal, WorktreeCreation } from "../../../contracts/session";


import { sessionExecutionCwd } from "../../../domain/session";
import { titleStateFor } from "../../../domain/titlePolicy";
import { loadFollowUpBehavior } from "../../settings/model/settings";
import { sharedSessionBackend } from "../../sessions/data/sharedSessionBackend";
import { requestedProviderAccountId, supportsProviderAccounts, workBuddyAccountIdForModel } from "../../providers/model/providerAccounts";
import { persistWorktreeCreation, startWorktreeCreation, completeWorktreeCreation, appendWorktreeCreationLog, failWorktreeCreation } from "../../../domain/worktreeCreation";
import { dispatchRemoteCommand, loadRemoteSessionText, remoteMachineFor, remoteRequest, remoteSessionFor, remoteSessionScopeFor, rememberRemoteSession, rememberRemotePendingExecutionCwd, pendingRemoteCommand, REMOTE_HISTORY_CHANGE } from "./connections";
import { ensureSharedProject, parseRemotePath, remoteProjectFor, type RemoteProject } from "./remoteProjects";
import { uploadRemoteAttachments } from "./remoteAttachments";
import { createWorktreeWithProgress } from "./hostWorktrees";
import { loadRemoteHostDescriptor } from "./remoteHostMetadata";
import type { HostCommand, HostSession, HostWorktree, RemoteAttachment } from "../../../contracts/protocol";
import { CommandOutcomeClient } from "../../../client/commandOutcome";

const outcomes = new CommandOutcomeClient<string>({
  key: machineId => machineId,
  request: (machineId, method, params) => remoteRequest(machineId, method, params),
});

/** Controller callers and pane callers use the same Host submission context. */
export type HostSubmissionOptions = ComposerTurnOptions & SubmissionMetadata & {
  ciRepair?: { prompt: string };
  followUpBehavior?: "queue" | "steer";
  queuedMessageId?: string;
  planBlockId?: string;
  orchestrationRetry?: OrchestrationProposal;
  onSettled?: (outcome: SubmissionOutcome) => void;
  /** Share the UI's optimistic identity with the durable Host command. */
  commandId?: string;
  /** Live state of a new worktree, keyed to the send command whose message it belongs under. */
  onWorktreeCreation?: (creation: WorktreeCreation, commandId: string) => void;
};

export function hostSubmissionCommand(session: Session, id: string, text: string,
  attachments: RemoteAttachment[], options: HostSubmissionOptions = {},
  commandId: string = crypto.randomUUID()): Extract<HostCommand, { type: "send" | "compact" }> {
  if (text.trim().toLowerCase() === "/compact" && !attachments.length && !options.draftBlockId &&
      !options.resendEdited && (!options.intent || options.intent === "default"))
    return { type: "compact", commandId, sessionId: id };
  const retryProposalBlockId = options.retryProposalBlockId ?? (options.orchestrationRetry &&
    session.blocks.find(block => block.orchestration === options.orchestrationRetry ||
      block.orchestration && JSON.stringify(block.orchestration) === JSON.stringify(options.orchestrationRetry))?.id);
  return {
    type: "send", commandId, sessionId: id, text, attachments,
    intent: options.intent ?? "default",
    followUpBehavior: options.questionAnswer ? "steer" : options.queueReturnPosition ? "queue" : options.followUpBehavior ?? loadFollowUpBehavior(),
    questionAnswer: options.questionAnswer, queueReturnPosition: options.queueReturnPosition,
    draftBlockId: options.draftBlockId, planBlockId: options.planBlockId,
    queuedMessageId: options.queuedMessageId, retryProposalBlockId,
    refreshTitle: options.refreshTitle, managed: options.managed,
    appRequestId: options.appRequestId, secondOpinion: options.secondOpinion,
    noteCard: options.noteCard === undefined ? session.noteCard : options.noteCard,
    handoffCard: options.handoffCard === undefined ? session.handoffCard : options.handoffCard,
    ciContext: options.ciRepair?.prompt ?? options.ciContext,
    promptOverride: options.ciRepair?.prompt ?? options.promptOverride,
    displayText: options.displayText,
    buildTarget: options.buildTarget, resendEdited: options.resendEdited,
  };
}

async function route(session: Session) {
  let project = remoteProjectFor(session.cwd);
  if (!project || project.local && !project.projectId) project = await ensureSharedProject(session.cwd);
  const machine = await remoteMachineFor(project.environmentId);
  if (!machine) throw new Error("Shared conversation service is not ready. Your message was not sent.");
  const scope = remoteSessionScopeFor(session.id);
  if (scope && (scope.environmentId !== project.environmentId || scope.projectId !== project.projectId))
    throw new Error("This conversation is not attached to its Host");
  return { project, machine };
}

const preparing = new Set<string>();
export const isHostSubmissionPreparing = (id: string) => preparing.has(id);

/** Accepted commands and their completion survive closing/unmounting the pane. */
export async function submitHostSession(session: Session, text: string, attachments: Attachment[] = [],
  options: HostSubmissionOptions = {}, onSnapshot?: (snapshot: HostSession) => void): Promise<boolean> {
  if (preparing.has(session.id)) return false;
  preparing.add(session.id);
  let accepted = false;
  let settled = false;
  const observeCompletion = !!options.onSettled || !!(options.resendEdited && options.onResendRejected);
  const settle = observeCompletion ? (outcome: SubmissionOutcome) => {
    if (settled) return;
    settled = true;
    if (options.resendEdited && typeof outcome.providerRewound === "boolean")
      options.onResendRejected?.({ providerRewound: outcome.providerRewound });
    options.onSettled?.(outcome);
  } : undefined;
  try {
    const { project, machine } = await route(session);
    const descriptor = await loadRemoteHostDescriptor(machine.id, machine.environmentId);
    if (session.inboxAsk && !descriptor.capabilities.includes("sessions.inbox.v1"))
      throw new Error("Update the Host to discuss inbox items in this conversation.");
    const required = [
      ...(attachments.length ? ["attachments.upload"] : []),
      ...(["plan", "build"].includes(options.intent ?? "") ? ["sessions.plan"] : []),
      ...(options.intent === "orchestrate" || options.orchestrationRetry || options.retryProposalBlockId ? ["sessions.orchestration"] : []),
      ...(options.draftBlockId ? ["sessions.draft"] : []),
      ...(options.queuedMessageId || options.queueReturnPosition ? ["sessions.queue"] : []),
      ...(observeCompletion ? ["sessions.outcome.v1"] : []),
    ];
    if (required.some(capability => !descriptor.capabilities.includes(capability)))
      throw new Error("Update the Host to submit this conversation action.");
    // A legacy Host must never silently discard managed completion or user cards.
    const extended = options.onSettled || options.managed || options.ciRepair || options.ciContext ||
      options.secondOpinion || options.noteCard || session.noteCard || options.handoffCard || session.handoffCard ||
      options.buildTarget || options.resendEdited || options.appRequestId || options.promptOverride || options.displayText;
    if (extended && !descriptor.capabilities.includes("sessions.submit.v1"))
      throw new Error("Update the Host to submit this conversation action.");
    const id = remoteSessionFor(session.id) ?? (sharedSessionBackend()?.ownsSession(session.id) ? session.id : undefined);
    if (pendingRemoteCommand(project.key, machine.environmentId, id ?? null, session.id))
      throw new Error("Resolve the pending conversation request before sending another message.");
    const uploaded = options.draftBlockId ? [] : await uploadRemoteAttachments(machine.id, attachments);
    const command = hostSubmissionCommand(session, id ?? "", text, uploaded, options, options.commandId);
    let targetId = id;
    if (!targetId) {
      let executionCwd = parseRemotePath(sessionExecutionCwd(session))?.hostPath ?? sessionExecutionCwd(session);
      if (session.workspaceMode === "worktree") {
        const creationId = crypto.randomUUID();
        let creation = startWorktreeCreation(session.worktreeBase ?? "HEAD", creationId);
        const report = (next: WorktreeCreation) => { creation = next; options.onWorktreeCreation?.(next, command.commandId); };
        report(creation);
        let tree: HostWorktree;
        try {
          const branch = await remoteRequest<string>(machine.id, "git.worktreeName", {
            projectId: project.projectId, cwd: executionCwd, harness: session.harness,
            message: text || attachments.map(file => file.name).join(", "),
          });
          tree = await createWorktreeWithProgress<HostWorktree>(machine.id, descriptor.capabilities, {
            projectId: project.projectId, cwd: executionCwd, branch,
            base: session.worktreeBase ?? "HEAD", existing: false,
          }, line => report(appendWorktreeCreationLog(creation, creationId, line)));
        } catch (error) {
          report(failWorktreeCreation(creation, creationId, error instanceof Error ? error.message : String(error)));
          throw error;
        }
        report(completeWorktreeCreation(creation, creationId, tree.path));
        if (command.type === "send") command.worktreeCreation = persistWorktreeCreation(creation);
        executionCwd = tree.path;
        rememberRemotePendingExecutionCwd(session.id, executionCwd);
      }
      const providerAccountId = supportsProviderAccounts(session.harness)
        ? session.providerAccountId ?? requestedProviderAccountId(session.harness, project.cwd) : undefined;
      const create: Extract<HostCommand, { type: "create" }> = {
        type: "create", commandId: crypto.randomUUID(), projectId: project.projectId,
        executionCwd, harness: session.harness, model: session.model,
        modelSettings: session.modelSettings, runtimeMode: session.runtimeMode,
        ...(session.inboxAsk ? { inboxAsk: session.inboxAsk } : {}),
        ...(project.local ? { providerAccountId: session.harness === "workbuddy"
          ? workBuddyAccountIdForModel(session.model, providerAccountId) : providerAccountId } : {}),
      };
      const receipt = await dispatchRemoteCommand(machine.id, project.key, machine.environmentId, create, session.id, command);
      targetId = receipt.sessionId;
      const currentBinding = remoteSessionFor(session.id);
      if (!currentBinding || currentBinding === targetId) rememberBinding(session.id, targetId, project);
      accepted = true;
    } else {
      await dispatchRemoteCommand(machine.id, project.key, machine.environmentId, command, session.id);
      accepted = true;
    }
    window.dispatchEvent(new Event(REMOTE_HISTORY_CHANGE));
    // Completion observation belongs to the command, never a React effect whose
    // cleanup would orphan a managed caller when its pane closes.
    const report = onSnapshot ? (snapshot: HostSession) => {
      const binding = remoteSessionFor(session.id);
      if (!binding || binding === targetId) onSnapshot(snapshot);
    } : undefined;
    void observeSubmission(machine.id, targetId, command.type === "send" ? command.queuedMessageId ?? command.commandId : command.commandId, settle, report)
      .catch(error => settle?.({ status: "failed", text: "", error: String(error) }));
    if (!id && titleStateFor(session).source === "manual")
      await remoteRequest(machine.id, "sessions.update", { projectId: project.projectId, sessionId: targetId, title: session.title });
    return true;
  } catch (error) {
    if (accepted) {
      // A post-acceptance presentation failure must not invite a duplicate send.
      return true;
    }
    options.onResendRejected?.({ providerRewound: false });
    settle?.({ status: "failed", text: "", error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally { preparing.delete(session.id); }
}

function rememberBinding(shellId: string, hostId: string, project: RemoteProject) {
  rememberRemoteSession(shellId, hostId, project);
  if (project.local) {
    sharedSessionBackend()?.rememberSession(hostId, project.key);
    sharedSessionBackend()?.rememberSession(shellId, project.key);
  }
}

async function observeSubmission(machineId: string, sessionId: string, commandId: string,
  settle?: HostSubmissionOptions["onSettled"], report?: (snapshot: HostSession) => void) {
  if (!settle) {
    if (report) report(await loadRemoteSessionText(machineId, sessionId));
    return;
  }
  // Hidden callers observe only this command's bounded completion summary.
  // Fetch the transcript once after completion if the workspace needs it.
  const outcome = await outcomes.wait(machineId, sessionId, commandId);
  try {
    if (report) report(await loadRemoteSessionText(machineId, sessionId));
  } finally {
    // A failed display refresh cannot turn a completed Host task into failure.
    settle(outcome);
  }
}

/** Await the Host's stopped projection before callers remove session resources. */
export async function stopHostConversation(session: Session): Promise<HostSession | undefined> {
  const { project, machine } = await route(session);
  const id = remoteSessionFor(session.id) ?? (sharedSessionBackend()?.ownsSession(session.id) ? session.id : undefined);
  if (!id) return;
  let snapshot = await loadRemoteSessionText(machine.id, id);
  if (snapshot.orchestration && ["active", "paused"].includes(snapshot.orchestration.status)) {
    const orchestration = snapshot.orchestration;
    await dispatchRemoteCommand(machine.id, project.key, machine.environmentId, {
      type: "orchestration", action: "stop", commandId: crypto.randomUUID(),
      projectId: project.projectId, sessionId: orchestration.leadId, orchestrationId: orchestration.id,
    }, session.id);
    do { snapshot = await loadRemoteSessionText(machine.id, id, snapshot, 25_000); }
    while (snapshot.orchestration?.id === orchestration.id && ["active", "paused"].includes(snapshot.orchestration.status));
  }
  const runId = snapshot.runId;
  if (runId) {
    await dispatchRemoteCommand(machine.id, project.key, machine.environmentId, {
      type: "cancel", commandId: crypto.randomUUID(), sessionId: id, runId,
    }, session.id);
    do { snapshot = await loadRemoteSessionText(machine.id, id, snapshot, 25_000); }
    while (snapshot.runId === runId && snapshot.status === "running");
  }
  if (snapshot.status === "running" || snapshot.session.busy)
    throw new Error("Session is unavailable or already running");
  return snapshot;
}

export async function deleteHostConversation(session: Session): Promise<void> {
  const snapshot = await stopHostConversation(session);
  if (!snapshot) return;
  const { project, machine } = await route(session);
  const id = snapshot.session.id;
  await remoteRequest(machine.id, "sessions.delete", { projectId: project.projectId, sessionId: id });
  rememberRemoteSession(session.id);
}

export async function switchHostConversationAccount(session: Session, providerAccountId: string): Promise<void> {
  const { project, machine } = await route(session);
  const descriptor = await loadRemoteHostDescriptor(machine.id, machine.environmentId);
  if (!descriptor.capabilities.includes("sessions.switchAccount"))
    throw new Error("Update the Host to submit this conversation action.");
  const sessionId = remoteSessionFor(session.id) ?? (sharedSessionBackend()?.ownsSession(session.id) ? session.id : undefined);
  if (!sessionId) throw new Error("This conversation is not attached to its Host");
  await remoteRequest(machine.id, "sessions.switchAccount", { projectId: project.projectId, sessionId, providerAccountId });
  window.dispatchEvent(new Event(REMOTE_HISTORY_CHANGE));
}

/** Explicit UI edits read the owner projection, dispatch once, then read its result. */
export async function mutateHostSession(session: Session,
  command: (snapshot: HostSession, commandId: string) => HostCommand,
  capability: string): Promise<HostSession> {
  const { project, machine } = await route(session);
  const descriptor = await loadRemoteHostDescriptor(machine.id, machine.environmentId);
  if (!descriptor.capabilities.includes(capability))
    throw new Error("Update the Host to submit this conversation action.");
  const sessionId = remoteSessionFor(session.id) ?? (sharedSessionBackend()?.ownsSession(session.id) ? session.id : undefined);
  if (!sessionId) throw new Error("This conversation is not attached to its Host");
  const before = await loadRemoteSessionText(machine.id, sessionId);
  if (before.projectId !== project.projectId || before.session.id !== sessionId)
    throw new Error("This conversation is not attached to its Host");
  await dispatchRemoteCommand(machine.id, project.key, machine.environmentId, command(before, crypto.randomUUID()), session.id);
  const after = await loadRemoteSessionText(machine.id, sessionId, before);
  window.dispatchEvent(new Event(REMOTE_HISTORY_CHANGE));
  return after;
}
