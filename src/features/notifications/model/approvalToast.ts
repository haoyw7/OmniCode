import { type PendingApprovalNotice, pendingApprovalForSession } from "../../../domain/pendingInput";
import { leafIds, type WorkspaceTab } from "../../workspace/model/layout";
import type { Session } from "../../../contracts/session";

/** True when the conversation pane for this session is focused and active. */
export function isSessionConversationFocused(
  sessionId: string,
  activeTabId: string,
  tabs: WorkspaceTab[],
  composerFocused: boolean,
): boolean {
  const tab = tabs.find((entry) => entry.id === activeTabId);
  if (!tab) return false;
  if (!leafIds(tab.layout).includes(sessionId)) return false;
  if (tab.focusedId !== sessionId) return false;
  return composerFocused;
}

export function hiddenApprovalNotices(
  sessions: Session[],
  activeTabId: string,
  tabs: WorkspaceTab[],
  composerFocused: boolean,
): Array<PendingApprovalNotice & { session: Session }> {
  return pendingApprovalNotices(sessions).filter(
    ({ sessionId }) =>
      !isSessionConversationFocused(
        sessionId,
        activeTabId,
        tabs,
        composerFocused,
      ),
  );
}

export function pendingApprovalNotices(
  sessions: Session[],
): Array<PendingApprovalNotice & { session: Session }> {
  const notices: Array<PendingApprovalNotice & { session: Session }> = [];
  for (const session of sessions) {
    if (session.inboxAsk) continue;
    // An orchestrated worker answers to its lead, never to the user directly.
    if (session.orchestrationLeadId) continue;
    const pending = pendingApprovalForSession(session);
    if (!pending) continue;
    notices.push({ ...pending, session });
  }
  return notices;
}
