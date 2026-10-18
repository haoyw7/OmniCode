import { useMemo } from "react";
import { projectKey, projectName } from "../../../shared/lib/paths";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";

/** The mascot and colour a project wears, honouring saved tab-group picks. */
export function useProjectMascotAppearance(cwd: string) {
  const project = projectName(cwd);
  const key = projectKey(cwd);
  const appearance = useMemo(
    () => ({
      name: resolveTabGroupMascot(key, loadTabGroupMascots()),
      color: resolveTabGroupColor(
        key,
        loadTabGroupColors(),
        loadTabGroupCustomColors(),
        project,
      ),
    }),
    [key, project],
  );
  return { project, ...appearance };
}
