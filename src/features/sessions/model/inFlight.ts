import { leafIds, newTab, type WorkspaceTab } from "../../workspace/model/layout";
import type { DockSide, ProjectTerminalDock } from "../../projects/model/projectTerminal";
import { sessionNeedsInput } from "../../../domain/session";
import { type Session } from "../../../contracts/session";
import type { ProjectReturnMemory } from "../../projects/model/projectReturn";

export const INTERRUPT_MESSAGE =
  "Turn interrupted when OmniCode quit.";

export const CONTINUE_PROMPT = "Continue from where you left off.";

export type InFlightRef = {
  sessionId: string;
  cwd: string;
};

export type ResumedWorkspace = {
  sessions: Session[];
  tabs: WorkspaceTab[];
  activeTabId: string;
  projectCwd: string;
  projectTerminals?: ProjectTerminalDock[];
  projectReturnMemory?: ProjectReturnMemory;
  lastDockSide?: DockSide;
};

/** A turn or approval that would be lost if this webview died. */
export function isInFlightSession(session: Session): boolean {
  return (
    !session.worktreeRemoved && (!!session.busy || sessionNeedsInput(session))
  );
}

export function hasInFlightSessions(sessions: Session[]): boolean {
  return sessions.some(isInFlightSession);
}

/**
 * Busy chats in tab order, then parked ones still running after their tab closed.
 * Only persistable sessions can come back after a real quit.
 */
export function inFlightRefs(
  sessions: Session[],
  tabs: WorkspaceTab[],
): InFlightRef[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const seen = new Set<string>();
  const refs: InFlightRef[] = [];

  const push = (session: Session | undefined) => {
    if (!session || session.inboxAsk || seen.has(session.id)) return;
    if (!isInFlightSession(session) || !canResumeAfterQuit(session)) return;
    seen.add(session.id);
    refs.push({ sessionId: session.id, cwd: session.cwd });
  };

  for (const tab of tabs) {
    for (const id of leafIds(tab.layout)) push(byId.get(id));
  }
  for (const session of sessions) push(session);
  return refs;
}

export function quitWhileBusyMessage(count: number): string {
  if (count === 1) {
    return "1 chat is still running. Quit anyway? It will resume when you reopen OmniCode.";
  }
  return `${count} chats are still running. Quit anyway? They will resume when you reopen OmniCode.`;
}

export function workspaceFromResumed(
  sessions: Session[],
): ResumedWorkspace | null {
  sessions = sessions.filter((session) => !session.inboxAsk);
  if (sessions.length === 0) return null;
  const tabs = sessions.map((session) => newTab(session.id));
  return {
    sessions,
    tabs,
    activeTabId: tabs[0].id,
    projectCwd: sessions[0].cwd,
  };
}

function canResumeAfterQuit(session: Session): boolean {
  return (
    !session.worktreeRemoved &&
    session.cwd !== "~" &&
    session.blocks.some((block) => block.role === "user")
  );
}

