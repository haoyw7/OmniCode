import { hasComposerDraftContent } from "../../features/sessions/model/draftCache";
import {
  isReusableDraftSession,
  type Session,
} from "../../features/sessions/model/session";
import {
  closeLeaf,
  leafIds,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";

/** Stronger than "no user messages": only disposable, untouched conversations. */
export function isDisposableEmptySession(session: Session): boolean {
  return (
    isReusableDraftSession(session) &&
    !hasComposerDraftContent(session.id) &&
    !session.automationId &&
    !session.workflowRunId &&
    !session.workflowRuns &&
    !session.quickLaunchAccepted &&
    !session.backgroundTasks?.length &&
    !session.editingQueuedMessageId &&
    !session.usageLimit
  );
}

export function tabHasSessionResources(tab: WorkspaceTab): boolean {
  return !!(
    tab.editorPanes.length ||
    tab.terminalPanes?.length ||
    tab.diffOpen
  );
}

/** Remove only departed panes; never close their files, terminals or siblings. */
export function pruneDepartedEmptySessions(
  tabs: WorkspaceTab[],
  departedIds: ReadonlySet<string>,
  canDiscard: (id: string) => boolean,
): { tabs: WorkspaceTab[]; removedIds: string[] } {
  const removable = new Set<string>();
  for (const id of departedIds) {
    const owners = tabs.filter((tab) => leafIds(tab.layout).includes(id));
    if (
      owners.length &&
      owners.every((tab) => !tabHasSessionResources(tab)) &&
      canDiscard(id)
    ) {
      removable.add(id);
    }
  }
  if (!removable.size) return { tabs, removedIds: [] };
  return {
    tabs: tabs.flatMap((tab) => {
      let next: WorkspaceTab | null = tab;
      for (const id of leafIds(tab.layout)) {
        if (next && removable.has(id)) next = closeLeaf(next, id);
      }
      return next ? [next] : [];
    }),
    removedIds: [...removable],
  };
}

/**
 * A new conversation the user started and typed into but left unsent. New
 * session returns to it instead of opening a second blank one, unless that
 * draft is the pane already in front of the user.
 */
export function pendingNewSessionDraft(
  sessions: readonly Session[],
  tabs: readonly WorkspaceTab[],
  matches: (session: Session) => boolean,
  focusedId: string | undefined,
): { session: Session; tab: WorkspaceTab } | undefined {
  for (const session of sessions) {
    if (
      session.id === focusedId ||
      !matches(session) ||
      !isReusableDraftSession(session) ||
      !hasComposerDraftContent(session.id)
    ) {
      continue;
    }
    const tab = tabs.find((entry) => leafIds(entry.layout).includes(session.id));
    if (tab) return { session, tab };
  }
  return undefined;
}
