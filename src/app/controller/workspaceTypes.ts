import type { CiRepairRequest } from "../../features/inbox/model/ciRepair";
import type { NoteComposerCard, OrchestrationProposal, HandoffComposerCard, Attachment, ComposerTurnOptions, LinkedWorkItem, PlanBuildTarget, SecondOpinionMeta } from "../../contracts/session";
import { type ControlOutcome } from "../../domain/orchestrationRuntime";

import { type SessionSummary } from "../../features/sessions/data/sessionStore";


import { type FollowUpBehavior } from "../../features/settings/model/settings";
import { type ResumedWorkspace } from "../model/appLifecycle";
import { type SubmissionAcceptance } from "../model/submissionAcceptance";
import type { InstalledUpdate } from "../model/updateNotice";
import { type WindowTransferPayload } from "../model/windowTransfer";

export type LinkedWorkItemPanelState = {
  item: LinkedWorkItem;
  sessionId: string;
  cwd: string;
};

export type SubmitOptions = ComposerTurnOptions & {
  ciRepair?: CiRepairRequest;
  /** Saved alongside the user turn; does not replace the submitted prompt. */
  ciContext?: string;
  secondOpinion?: SecondOpinionMeta;
  followUpBehavior?: FollowUpBehavior;
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  queuedMessageId?: string;
  planBlockId?: string;
  buildTarget?: PlanBuildTarget;
  managed?: boolean;
  orchestrationRetry?: OrchestrationProposal;
  appRequestId?: string;
  onSettled?: (outcome: ControlOutcome) => void;
  /** Generate a fresh title even when this is not the session's first turn. */
  refreshTitle?: boolean;
  /** Internal guard for the retry after resolving a renamed project. */
  projectLocationReady?: boolean;
};

export type Submit = (
  sessionId: string,
  text: string,
  attachments?: Attachment[],
  options?: SubmitOptions,
) => SubmissionAcceptance;

export type AppProps = {
  windowTransfer?: WindowTransferPayload | null;
  resumed?: ResumedWorkspace | null;
  installedUpdate?: InstalledUpdate | null;
  history?: SessionSummary[];
  historyCwd?: string | null;
};
