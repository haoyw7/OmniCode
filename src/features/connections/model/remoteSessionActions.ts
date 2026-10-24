import type { Attachment, PlanBuildTarget } from "../../../contracts/session";
import type { ApprovalDecision } from "../../../contracts/harness";
import type { UserQuestionReply } from "../../../contracts/session";
import type { HostSubmissionOptions } from "./hostSessionSubmission";

type RemoteActions = {
  buildPlan: (blockId: string, target?: PlanBuildTarget) => void;
  submit: (text: string, attachments: Attachment[], options?: HostSubmissionOptions) => boolean | void;
  saveDraft: (text: string, attachments: Attachment[]) => boolean | void;
  stop: () => void;
  compact: () => boolean;
  approve: (requestId: number, decision: ApprovalDecision) => void;
  answer: (requestId: number, reply: UserQuestionReply) => void;
  keepQuestionOpen?: (requestId: number) => void;
  /** Move the Host conversation to another account; false when it cannot. */
  switchAccount: (providerAccountId: string) => boolean;
};

const actions = new Map<string, RemoteActions>();

export function registerRemoteSessionActions(shellId: string, value: RemoteActions) {
  actions.set(shellId, value);
  return () => {
    if (actions.get(shellId) === value) actions.delete(shellId);
  };
}

export function buildRemotePlan(shellId: string, blockId: string, target?: PlanBuildTarget) {
  actions.get(shellId)?.buildPlan(blockId, target);
}

export function remoteSessionActions(shellId: string): RemoteActions | undefined {
  return actions.get(shellId);
}
