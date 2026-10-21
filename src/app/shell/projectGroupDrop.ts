import { createContext } from "react";
import { useDropTarget } from "../../shared/ui/primitives/Sortable";
import { pathKey } from "../../shared/lib/paths";
import { loadProjectGroupAssignments, loadProjectGroups, setProjectGroupAssignment, updateProjectGroup } from "../../features/projects/model/projectGroups";
import { loadPinnedProjects, savePinnedProjects } from "../../features/projects/model/recents";

export const SidebarProjectGroupContext = createContext<string | undefined>(undefined);

export function useProjectGroupDrop(groupId: string) {
  return useDropTarget({
    accepts: payload => payload.type === "sidebar-project" && typeof payload.path === "string" && payload.groupId !== groupId,
    onDrop: payload => {
      if (typeof payload.path !== "string" || !loadProjectGroups().some(group => group.id === groupId)) return;
      const path = payload.path;
      setProjectGroupAssignment(path, groupId);
      if (loadProjectGroupAssignments()[pathKey(path)] !== groupId) return;
      const pins = loadPinnedProjects();
      const next = pins.filter(pin => pathKey(pin) !== pathKey(path));
      if (next.length !== pins.length) savePinnedProjects(next);
      updateProjectGroup(groupId, group => ({ ...group, collapsed: false }));
    },
  });
}
