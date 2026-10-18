import { useMemo, type RefObject } from "react";
import type { HostProject, HostSessionSummary } from "../features/connections/model/protocol";
import { Folder } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import { MobileSheet, SHEET_WIDTH } from "./MobileSheet";
import { sortMobileProjects } from "./sessionList";
import { useMobileSessionLists } from "./sessionListStore";

export function MobileHomeMenu({
  open,
  anchor,
  projects,
  projectsPending,
  projectsUnavailable,
  foreground,
  loadSessions,
  cachedSessions,
  onClose,
  onProject,
}: {
  open: boolean;
  anchor: RefObject<HTMLButtonElement | null>;
  projects: HostProject[];
  projectsPending: boolean;
  projectsUnavailable: boolean;
  foreground: boolean;
  loadSessions: (projectId: string) => Promise<HostSessionSummary[]>;
  cachedSessions: (projectId: string) => HostSessionSummary[] | undefined;
  onClose: () => void;
  onProject: (project: HostProject) => void;
}) {
  const { t } = useTranslation();
  const idsKey = JSON.stringify(projects.map((project) => project.id));
  const { histories } = useMobileSessionLists({
    idsKey, enabled: open && foreground, visible: open, loadSessions, cachedSessions,
  });

  const orderedProjects = useMemo(() => sortMobileProjects(
    projects,
    (id) => histories[id]?.sessions ?? [],
  ), [projects, histories]);

  return (
    <MobileSheet
      open={open}
      title="Projects"
      placement="anchor"
      anchor={anchor}
      align="center"
      side="bottom"
      width={SHEET_WIDTH.list}
      onClose={onClose}
    >
      <div className="mobile-project-options">
        {orderedProjects.map((project) => (
          <button
            type="button"
            className="mobile-sheet-row"
            key={project.id}
            onClick={() => {
              onClose();
              onProject(project);
            }}
          >
            <Folder size={22} />
            <span className="mobile-sheet-row-text">
              <strong>{project.name}</strong>
              <small>{project.machine?.kind === "wsl" ? `WSL · ${project.machine.distribution} · ${project.cwd}` : project.cwd}</small>
            </span>
          </button>
        ))}
        {!projects.length && (
          <p className="mobile-sheet-hint" role="status">
            {t(projectsUnavailable ? "Couldn’t load projects"
              : projectsPending ? "Loading projects…" : "No projects found")}
          </p>
        )}
      </div>
    </MobileSheet>
  );
}
