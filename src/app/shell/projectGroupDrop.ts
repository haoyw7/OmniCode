import type { ReorderExternalDrop } from "../../shared/hooks/useAnimatedReorder";
import { createDragLabel } from "../../shared/lib/drag";
import { pathKey } from "../../shared/lib/paths";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  setProjectGroupAssignment,
  updateProjectGroup,
} from "../../features/projects/model/projectGroups";
import {
  loadPinnedProjects,
  savePinnedProjects,
} from "../../features/projects/model/recents";

/** Hand a project reorder gesture to a visible group header in this sidebar. */
export function projectGroupDrop(
  source: HTMLElement,
  label: string,
): ReorderExternalDrop<string> | undefined {
  const root = source.closest<HTMLElement>("[data-project-list]");
  if (!root?.querySelector("[data-project-group-header]")) return;
  const sourceGroup = source.closest<HTMLElement>("[data-project-group]")
    ?.dataset.projectGroup;
  let target: HTMLElement | undefined;
  let feedback: ReturnType<typeof createDragLabel> | undefined;

  const containsPoint = (node: HTMLElement, event: PointerEvent) => {
    const rect = node.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      event.clientX >= rect.left &&
      event.clientX < rect.right &&
      event.clientY >= rect.top &&
      event.clientY < rect.bottom
    );
  };
  const targetAt = (event: PointerEvent) => {
    if (!root.isConnected || !containsPoint(root, event)) return;
    return [
      ...root.querySelectorAll<HTMLElement>("[data-project-group-header]"),
    ].find(
      (node) =>
        node.dataset.projectGroupHeader !== sourceGroup &&
        !node.closest("[inert], [hidden]") &&
        containsPoint(node, event),
    );
  };
  const clear = () => {
    if (target) delete target.dataset.projectGroupDropTarget;
    target = undefined;
    feedback?.dispose();
    feedback = undefined;
  };

  return {
    onMove: (_path, event) => {
      const next = targetAt(event);
      if (next !== target) clear();
      if (!next) return false;
      target = next;
      target.dataset.projectGroupDropTarget = "true";
      feedback ??= createDragLabel(label, label);
      feedback.move(event.clientX, event.clientY, true);
      return true;
    },
    onDrop: (path, event) => {
      // Recheck the pointer and current groups: the hovered group may have moved
      // or been removed while this gesture was active.
      const groupId = targetAt(event)?.dataset.projectGroupHeader;
      if (
        !groupId ||
        !loadProjectGroups().some((group) => group.id === groupId)
      ) {
        return false;
      }
      setProjectGroupAssignment(path, groupId);
      if (loadProjectGroupAssignments()[pathKey(path)] === groupId) {
        // A pinned project lives outside groups; moving it into a group also
        // removes its pin so the result is visible in the requested destination.
        const pins = loadPinnedProjects();
        const nextPins = pins.filter((pin) => pathKey(pin) !== pathKey(path));
        if (nextPins.length !== pins.length) savePinnedProjects(nextPins);
        updateProjectGroup(groupId, (group) => ({
          ...group,
          collapsed: false,
        }));
      }
      return true;
    },
    onEnd: clear,
  };
}
