import { projectMascot } from "../model/projectMascots";
import { Omi } from "../../../shared/ui/branding/Omi";

type Props = {
  project: string;
  color?: string;
  name?: string | null;
  className?: string;
  active?: boolean;
};

/** Project identity and color are resolved here; Omi owns the shared artwork. */
export function ProjectMascot({ project, color, name, className = "size-3 shrink-0", active = false }: Props) {
  const mascot = projectMascot(project, name);
  return <Omi compact expression={mascot.name} animated={active} className={className} style={color ? { color } : undefined} />;
}
