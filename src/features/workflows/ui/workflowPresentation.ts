import { createContext, useContext, type ReactNode } from "react";
import type { HarnessId, Session } from "../../../contracts/session";
import type { ApprovalDecision } from "../../../contracts/harness";

export type WorkflowRuntimeDraft = { harness: HarnessId; model: string; modelSettings: Record<string, string> };

export type WorkflowPresentation = {
  renderRuntimePicker(props: {
    runtime: WorkflowRuntimeDraft;
    cwd: string;
    onChange: (runtime: WorkflowRuntimeDraft) => void;
  }): ReactNode;
  renderTranscript(props: {
    session: Session;
    visible: boolean;
    onApproval: (requestId: number, decision: ApprovalDecision) => void;
    onOpenFile?: (path: string) => void;
  }): ReactNode;
};

export const WorkflowPresentationContext = createContext<WorkflowPresentation | null>(null);
export const useWorkflowPresentation = () => useContext(WorkflowPresentationContext);
