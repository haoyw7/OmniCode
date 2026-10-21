import { motion } from "motion/react";
import type { SortableItemState } from "../../../shared/ui/primitives/Sortable";
import { SidebarEntryReorderContext } from "../SidebarEntryReorder";
import type { ProjectListEntry } from "./projectListShared";

export function SidebarEntry({ entry, id, sortable }: { entry: ProjectListEntry; id: string; sortable?: SortableItemState }) {
  const content = typeof entry.content === "function" ? entry.content() : entry.content;
  if (!sortable) return content;
  return <SidebarEntryReorderContext.Provider value={sortable}>
    <motion.div {...sortable.motionProps} ref={sortable.ref} style={sortable.style}
      data-reordering={sortable.sorting || undefined} data-dragging={sortable.dragging || undefined}
      data-sidebar-pinned-entry={id} className="sidebar-pinned-entry relative">
      {content}
    </motion.div>
  </SidebarEntryReorderContext.Provider>;
}
