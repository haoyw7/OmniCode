import { projectKey, projectName } from "../../shared/lib/paths";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../workspace/model/tabGroups";
import { useTabGroupLogos } from "./hooks/useTabGroupLogos";
import { ProjectLogoIcon } from "./ui/ProjectLogoIcon";
import { ProjectMascot } from "./ui/ProjectMascot";
import { usePreferenceState } from "../settings/model/usePreferenceState";

/** The icon the activity bar shows: custom logo, else the project mascot. */
export function ProjectScopeIcon({ path }: { path: string }) {
  const logos = useTabGroupLogos();
  const [colors] = usePreferenceState(loadTabGroupColors);
  const [customColors] = usePreferenceState(loadTabGroupCustomColors);
  const [mascots] = usePreferenceState(loadTabGroupMascots);
  const key = projectKey(path);
  const name = projectName(path);
  const logoPath = resolveTabGroupLogo(key, logos);
  if (logoPath) {
    return (
      <ProjectLogoIcon
        path={logoPath}
        className="size-4 rounded-sm"
        imageClassName="size-4"
      />
    );
  }
  return (
    <ProjectMascot
      project={name}
      color={resolveTabGroupColor(key, colors, customColors, name)}
      name={resolveTabGroupMascot(key, mascots)}
      className="size-3.5"
    />
  );
}
