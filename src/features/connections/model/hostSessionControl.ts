import type { Session, UserQuestionReply } from "../../../contracts/session";
import type { ApprovalDecision } from "../../../contracts/harness";

import { dispatchRemoteCommand, loadRemoteSessionText, remoteMachineFor, remoteSessionFor, remoteSessionScopeFor } from "./connections";
import { remoteProjectFor, sessionUsesHost } from "./remoteProjects";
import type { HostCommand } from "../../../contracts/protocol";

type Control =
  | { type: "cancel" }
  | { type: "compact" }
  | { type: "keepQuestionOpen"; requestId: number }
  | { type: "steer"; text: string }
  | { type: "approve"; requestId: number; decision: ApprovalDecision }
  | { type: "answer"; requestId: number; reply: UserQuestionReply };

/** Controls also work for parked workers without a mounted conversation pane. */
export async function controlHostSession(session: Session, control: Control): Promise<void> {
  const project = remoteProjectFor(session.cwd);
  if (!sessionUsesHost(session) || !project)
    throw new Error("Shared conversation service is not connected");
  const sessionId = remoteSessionFor(session.id);
  const scope = remoteSessionScopeFor(session.id);
  if (!sessionId || !scope || scope.environmentId !== project.environmentId
    || (project.projectId && scope.projectId !== project.projectId))
    throw new Error("This conversation is not attached to its Host");
  const machine = await remoteMachineFor(scope.environmentId);
  if (!machine) throw new Error("Shared conversation service is not connected");
  const snapshot = await loadRemoteSessionText(machine.id, sessionId);
  if (snapshot.session.id !== sessionId || snapshot.projectId !== scope.projectId)
    throw new Error("This conversation is not attached to its Host");
  if (control.type !== "compact" && (!snapshot.runId || (control.type === "cancel" && !snapshot.session.busy))) {
    if (control.type === "cancel") return;
    throw new Error("This agent is not running a turn; send it a fresh one with message.");
  }
  const commandId = crypto.randomUUID();
  const command: HostCommand = control.type === "steer"
    ? { type: "send", commandId, sessionId, text: control.text, followUpBehavior: "steer" }
    : control.type === "compact" ? { type: "compact", commandId, sessionId }
    : { ...control, commandId, sessionId, runId: snapshot.runId! };
  if (control.type === "steer" && !snapshot.canSteer)
    throw new Error("This worker cannot receive guidance during its current turn");
  await dispatchRemoteCommand(machine.id, project.key, scope.environmentId, command, session.id);
}
