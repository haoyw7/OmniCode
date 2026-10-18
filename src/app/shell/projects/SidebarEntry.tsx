import { useMemo, type PointerEvent } from "react";
import { type ReorderExternalDrop } from "../../../shared/hooks/useAnimatedReorder";
import { SidebarEntryReorderContext } from "../SidebarEntryReorder";
import { type ProjectListEntry, type SortableHandle } from "./projectListShared";



export function SidebarEntry({
  entry,
  id,
  sortable,
}: {
  entry: ProjectListEntry;
  id: string;
  sortable?: SortableHandle;
}) {
  const content =
    typeof entry.content === "function" ? entry.content() : entry.content;
  // A fresh value would re-render every memoized card below on each list render.
  const dragging = !!sortable && sortable.draggingId !== null;
  const onItemPointerDown = sortable?.onItemPointerDown;
  const consumeClick = sortable?.consumeClick;
  const reorder = useMemo(
    () =>
      onItemPointerDown && consumeClick
        ? {
            dragging,
            onPointerDown: (
              event: PointerEvent,
              externalDrop?: ReorderExternalDrop<string>,
            ) => onItemPointerDown(id, event, externalDrop),
            consumeClick,
          }
        : null,
    [dragging, onItemPointerDown, consumeClick, id],
  );
  if (!sortable || !reorder) return content;
  return (
    <SidebarEntryReorderContext.Provider value={reorder}>
      <div
        ref={(node) => sortable.setItemRef(id, node)}
        data-sidebar-pinned-entry={id}
        className="reorder-item sidebar-pinned-entry relative"
      >
        {content}
      </div>
    </SidebarEntryReorderContext.Provider>
  );
}
