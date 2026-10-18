import { ProjectLogoIcon } from "../../features/projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { projectKey, projectName } from "../../shared/lib/paths";
import {
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";

/** Shared project identity for the activity bar and the project list. */
export function ProjectAvatar({
  path,
  busy = false,
  colors,
  customColors,
  logos,
  mascots,
  className = "size-5",
}: {
  path: string;
  busy?: boolean;
  colors: Record<string, number>;
  customColors: Record<string, string>;
  logos: ReturnType<typeof useTabGroupLogos>;
  mascots: Record<string, string>;
  className?: string;
}) {
  const key = projectKey(path);
  const seed = projectName(path);
  const logo = resolveTabGroupLogo(key, logos);
  return logo && !busy ? (
    <ProjectLogoIcon
      path={logo}
      className={`${className} rounded-sm`}
      imageClassName={className}
    />
  ) : (
    <ProjectMascot
      project={seed}
      color={resolveTabGroupColor(key, colors, customColors, seed)}
      name={resolveTabGroupMascot(key, mascots)}
      active={busy}
      className={className}
    />
  );
}
