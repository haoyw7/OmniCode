import type { HostSessionSummary } from "../features/connections/model/protocol";
import { archivedMobileSessions, sortMobileSessions } from "./sessionList";

export type MobileSessionFilter =
  | "all"
  | "working"
  | "needsInput"
  | "completed"
  | "archived";

export const MOBILE_SESSION_FILTERS: readonly MobileSessionFilter[] = [
  "all",
  "working",
  "needsInput",
  "completed",
  "archived",
];

/** Untranslated labels; callers pass them through `t()` at display time. */
export const MOBILE_SESSION_FILTER_LABELS: Record<MobileSessionFilter, string> = {
  all: "All",
  working: "Working",
  needsInput: "Needs input",
  completed: "Completed",
  archived: "Archived",
};

function matches(session: HostSessionSummary, filter: MobileSessionFilter): boolean {
  switch (filter) {
    case "working":
      return session.status === "running";
    case "needsInput":
      return !!session.needsInput;
    case "completed":
      return (
        session.status !== "running" &&
        !session.needsInput &&
        !!session.lastCompletedRunId
      );
    default:
      return true;
  }
}

/** Archived rows only appear under their own filter; the rest keep list order. */
export function filterMobileSessions(
  sessions: readonly HostSessionSummary[],
  filter: MobileSessionFilter,
): HostSessionSummary[] {
  if (filter === "archived") return archivedMobileSessions(sessions);
  return sortMobileSessions(sessions).filter((session) => matches(session, filter));
}
