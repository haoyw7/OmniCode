import type { CiRepairRequest } from "../../features/inbox/model/ciRepair";
import { type NoteComposerCard } from "../../features/notes";
import { type ControlOutcome } from "../../features/orchestration/model/orchestration";
import { type OrchestrationProposal } from "../../features/orchestration/model/orchestrationPlan";
import { type SessionSummary } from "../../features/sessions/data/sessionStore";
import { type HandoffComposerCard } from "../../features/sessions/model/handoff";
import {
  type Attachment,
  type ComposerTurnOptions,
  type LinkedWorkItem,
  type PlanBuildTarget,
  type SecondOpinionMeta,
} from "../../features/sessions/model/session";
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
