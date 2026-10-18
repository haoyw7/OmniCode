import { PresenceBoundary } from "../../../../shared/ui/PresenceBoundary";
import { usePreferenceState } from "../../model/usePreferenceState";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { useEffect, useMemo, useState } from "react";
import { HarnessIcon } from "../../../sessions/ui/HarnessIcon";
import { Button } from "../../../../shared/ui/forms/Button";
import { RemoveProjectDialog } from "../../../projects/ui/RemoveProjectDialog";
import { prettyCwd, projectKey, projectName } from "../../../../shared/lib/paths";
import {
  loadArchivedProjects,
  looksLikeProject,
  subscribeArchivedProjects,
  type ArchivedProject,
} from "../../../projects/model/recents";
import { sessionDisplayTitle } from "../../../sessions/model/session";
import {
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
} from "../../../sessions/model/sessionFilters";
import type { SessionSummary } from "../../../sessions/data/sessionStore";
import { loadTabGroupLabels, resolveTabGroupLabel } from "../../../workspace/model/tabGroups";
import { Group, Row, Toggle } from "../settingsLayout";



function useArchivedProjects(): ArchivedProject[] {
  const [items, setItems] = usePreferenceState(loadArchivedProjects);
  useEffect(
    () => subscribeArchivedProjects(() => setItems(loadArchivedProjects())),
    [],
  );
  return items;
}

function archivedProjectLabel(path: string): string {
  return resolveTabGroupLabel(
    projectKey(path),
    loadTabGroupLabels(),
    projectName(path),
  );
}

export function ArchivePage({
  cwd,
  sessions,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
}: {
  cwd: string;
  sessions: SessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const [filters, setFilters] = usePreferenceState(loadSessionSidebarFilters);
  const [deleting, setDeleting] = useState<ArchivedProject | null>(null);
  const archivedProjects = useArchivedProjects();
  const archived = useMemo(
    () =>
      sessions
        .filter((session) => session.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  const onShowArchived = (showArchived: boolean) => {
    const next = { ...filters, showArchived };
    saveSessionSidebarFilters(next);
    setFilters(next);
  };

  return (
    <>
      <Group
        title={uiT("Archived projects")}
        description={uiT(
          "Archive a project from the project list to keep its chats without listing it in the sidebar.",
        )}
      >
        {archivedProjects.length === 0 ? (
          <p className="px-4 py-3.5 text-[12px] text-content/45">
            {uiT("No archived projects.")}
          </p>
        ) : (
          archivedProjects.map((project) => (
            <div
              key={project.path}
              className="flex items-center gap-3 border-b border-content/5 px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">
                  {archivedProjectLabel(project.path)}
                </div>
                <div className="truncate text-[11px] text-content/40">
                  {prettyCwd(project.path)}
                </div>
              </div>
              {onRestoreProject ? (
                <Button variant="secondary" onClick={() => onRestoreProject(project.path)}>
                  {uiT("Restore")}
                </Button>
              ) : null}
              {onDeleteProject ? (
                <Button variant="danger" onClick={() => setDeleting(project)}>
                  {uiT("Delete")}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </Group>

      <Group
        title={
          looksLikeProject(cwd)
            ? uiT("Archived in {value0}", { value0: String(projectName(cwd)) })
            : uiT("Archived conversations")
        }
      >
        <Row
          id="show-archived"
          label={uiT("Show archived in the sidebar")}
          description={uiT(
            "Keep archived conversations listed alongside the active ones.",
          )}
        >
          <Toggle
            label={uiT("Show archived in the sidebar")}
            on={filters.showArchived}
            onChange={onShowArchived}
          />
        </Row>
        {!looksLikeProject(cwd) ? (
          <p className="px-4 py-3.5 text-[12px] text-content/45">
            {uiT("Open a project to see its archived conversations.")}
          </p>
        ) : archived.length === 0 ? (
          <p className="px-4 py-3.5 text-[12px] text-content/45">
            {uiT("No archived conversations in this project.")}
          </p>
        ) : (
          archived.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-3 border-b border-content/5 px-4 py-2.5 last:border-b-0"
            >
              <HarnessIcon
                harness={session.harness}
                className="size-3.5 shrink-0"
              />
              <button
                type="button"
                onClick={() => onOpenSession(session.id)}
                className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-content"
              >
                {sessionDisplayTitle(session.title, session.harness)}
              </button>
              <span className="shrink-0 text-[11px] text-content/35 tabular-nums">
                {formatDate(session.updatedAt)}
              </span>
              <Button variant="secondary"
                onClick={() => onArchiveSession(session.id, false)}
              >
                {uiT("Unarchive")}
              </Button>
              <Button
                variant="danger"
                onClick={() => onDeleteSession(session.id)}
              >
                {uiT("Delete")}
              </Button>
            </div>
          ))
        )}
      </Group>

      <PresenceBoundary>
      {deleting ? (
        <RemoveProjectDialog
          name={archivedProjectLabel(deleting.path)}
          path={deleting.path}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDeleteProject?.(deleting.path);
            setDeleting(null);
          }}
        />
      ) : null}
      </PresenceBoundary>
    </>
  );
}

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}
