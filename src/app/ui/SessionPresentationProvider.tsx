import type { ReactNode } from "react";
import { SessionPresentationContext, TranscriptCardsContext, type SessionPresentation, type TranscriptCards } from "../../features/sessions/model/sessionPresentation";
import { BranchPicker } from "../../features/source-control/ui/BranchPicker";
import { WorktreePicker } from "../../features/source-control/ui/WorktreePicker";
import { WorkspacePicker, WorkspaceIdentity, WorktreeBasePicker } from "../../features/workspace/ui/WorkspacePicker";
import { CwdPicker } from "../../features/projects/ui/CwdPicker";
import { SkillPicker } from "../../features/skills/ui/SkillPicker";
import { InboxMiniCard } from "../../features/inbox/ui/InboxMiniCard";
import { NoteMiniCard } from "../../features/notes/ui/NoteMiniCard";
import { LinkedWorkItemUpdateNotice } from "../../features/inbox/ui/LinkedWorkItemUpdateNotice";
import { RemoteSession } from "../../features/connections/ui/RemoteSession";
import { OrchestrationPreview } from "../../features/orchestration/ui/OrchestrationPreview";
import { WorkflowRunCard } from "../../features/workflows/ui/WorkflowRunCard";

const surfaces: SessionPresentation = { BranchPicker, WorktreePicker, WorkspacePicker, WorkspaceIdentity,
  WorktreeBasePicker, CwdPicker, SkillPicker, InboxMiniCard, NoteMiniCard, LinkedWorkItemUpdateNotice, RemoteSession };
const cards: TranscriptCards = { OrchestrationPreview, WorkflowRunCard, NoteMiniCard };

/** The application composes feature views; features own their view implementations. */
export function SessionPresentationProvider({ children }: { children: ReactNode }) {
  return <SessionPresentationContext.Provider value={surfaces}>
    <TranscriptCardsContext.Provider value={cards}>{children}</TranscriptCardsContext.Provider>
  </SessionPresentationContext.Provider>;
}
