import type { Block, Session } from "../contracts/session";
import { toolCallLabel } from "./toolLabel";
export type PendingApprovalNotice = {
  sessionId: string;
  requestId: number;
  label: string;
  kind: "approval" | "question";
  block?: Block;
};

/** Latest undecided approval or clarifying question in a session, if any. */
export function pendingApprovalForSession(
  session: Session,
): PendingApprovalNotice | null {
  if (session.pendingQuestion) {
    return {
      sessionId: session.id,
      requestId: session.pendingQuestion.requestId,
      label:
        session.pendingQuestion.title ||
        session.pendingQuestion.questions[0]?.prompt ||
        "Question",
      kind: "question",
    };
  }
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (!block.approval || block.approval.decided) continue;
    return {
      sessionId: session.id,
      requestId: block.approval.requestId,
      label: toolCallLabel(block, session.cwd),
      kind: "approval",
      block,
    };
  }
  return null;
}
