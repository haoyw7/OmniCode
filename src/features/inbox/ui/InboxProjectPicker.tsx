import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { sameProjectPath, type RecentProject } from "../../projects/model/recents";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";



export type InboxProjectOption = {
  path: string;
  name: string;
  logoPath: string | null;
  mascotName: string | null;
  mascotColor: string;
};

export function inboxProjectOptions(
  projects: RecentProject[],
  logos: ReturnType<typeof useTabGroupLogos>,
): InboxProjectOption[] {
  const mascots = loadTabGroupMascots();
  const colors = loadTabGroupColors();
  const custom = loadTabGroupCustomColors();
  return [...projects]
    .map((project) => {
      const name = projectName(project.path);
      const key = projectKey(project.path);
      return {
        path: project.path,
        name,
        logoPath: resolveTabGroupLogo(key, logos),
        mascotName: resolveTabGroupMascot(key, mascots),
        mascotColor: resolveTabGroupColor(key, colors, custom, name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function InboxProjectMark({
  project,
}: {
  project: Pick<
    InboxProjectOption,
    "name" | "logoPath" | "mascotName" | "mascotColor"
  >;
}) {
  if (project.logoPath) {
    return (
      <ProjectLogoIcon
        path={project.logoPath}
        className="size-3.5 shrink-0 rounded-sm"
        imageClassName="size-3.5"
      />
    );
  }
  return (
    <ProjectMascot
      project={project.name}
      color={project.mascotColor}
      name={project.mascotName}
      className="size-3 shrink-0"
    />
  );
}

export function InboxProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: InboxProjectOption[];
  value: string;
  onChange: (path: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const selected = projects.find(project => sameProjectPath(project.path, value)) ?? projects[0];
  return <SearchableSelect
    label={uiT("Project")} value={selected?.path ?? ""}
    placeholder={uiT("Choose project")} disabled={projects.length === 0}
    searchable={false} variant="pill" onChange={onChange}
    options={projects.map(project => ({ value: project.path, label: project.name, icon: <InboxProjectMark project={project} /> }))}
  />;
}
