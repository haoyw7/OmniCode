import type { Attachment, ComposerTurnOptions, PlanBuildTarget } from "../../sessions/model/session";
import type { ApprovalDecision, UserQuestionReply } from "../../../integrations/harness";

type RemoteActions = {
  buildPlan: (blockId: string, target?: PlanBuildTarget) => void;
  submit: (text: string, attachments: Attachment[], options?: ComposerTurnOptions) => boolean | void;
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

type InitialSubmission = {
  id: string;
  text: string;
  attachments: Attachment[];
  options?: ComposerTurnOptions;
  startedAt: number;
};
const initialSubmissions = new Map<string, InitialSubmission>();

/** Carries the first message across the projectless composer → Host pane mount. */
export function stageRemoteSessionSubmission(
  shellId: string,
  text: string,
  attachments: Attachment[],
  options?: ComposerTurnOptions,
): boolean {
  if (initialSubmissions.has(shellId)) return false;
  initialSubmissions.set(shellId, {
    id: crypto.randomUUID(), text, attachments, options, startedAt: Date.now(),
  });
  return true;
}

export const pendingRemoteSessionSubmission = (shellId: string) =>
  initialSubmissions.get(shellId);

export function clearRemoteSessionSubmission(shellId: string) {
  initialSubmissions.delete(shellId);
}

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
