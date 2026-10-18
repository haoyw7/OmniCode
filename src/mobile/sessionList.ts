import type {
  HostProject,
  HostSessionSummary,
} from "../features/connections/model/protocol";
import { sessionRecencyAt } from "../features/sessions/model/sessionActivity";

export function sortMobileProjects(
  projects: readonly HostProject[],
  sessionsForProject: (projectId: string) => readonly HostSessionSummary[],
): HostProject[] {
  return projects
    .map((project) => ({
      project,
      updatedAt: sessionsForProject(project.id).reduce(
        (latest, session) =>
          session.archived ? latest : Math.max(latest, sessionRecencyAt(session)),
        0,
      ),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((item) => item.project);
}

export function sortMobileSessions(
  sessions: readonly HostSessionSummary[],
): HostSessionSummary[] {
  return sessions
    .filter((session) => !session.archived)
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        sessionRecencyAt(b) - sessionRecencyAt(a) ||
        a.id.localeCompare(b.id),
    );
}

/** Archived conversations, most recently touched first. */
export function archivedMobileSessions(
  sessions: readonly HostSessionSummary[],
): HostSessionSummary[] {
  return sessions
    .filter((session) => session.archived)
    .sort((a, b) => sessionRecencyAt(b) - sessionRecencyAt(a) || a.id.localeCompare(b.id));
}
