import { Omi } from "../../shared/ui/branding/Omi";
import { projectMascot } from "../../features/projects/model/projectMascots";
import { useProjectLogoSource } from "../../features/projects/model/useProjectLogoSource";
import { ProjectLogoIcon } from "../../shared/ui/ProjectLogoIcon";

import { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { projectKey, projectName } from "../../shared/lib/paths";
import { resolveTabGroupColor, resolveTabGroupLogo, resolveTabGroupMascot } from "../../features/workspace/model/tabGroups";

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
  const resolveProjectLogoSrc = useProjectLogoSource();
  const key = projectKey(path);
  const seed = projectName(path);
  const logo = resolveTabGroupLogo(key, logos);
  return logo && !busy ? (
    <ProjectLogoIcon
      src={resolveProjectLogoSrc(logo)}
      className={`${className} rounded-sm`}
      imageClassName={className}
    />
  ) : (
    <Omi compact
      expression={projectMascot(seed, resolveTabGroupMascot(key, mascots)).name}
      style={{ color: resolveTabGroupColor(key, colors, customColors, seed) || undefined }}
      
      animated={busy}
      className={className}
    />
  );
}
