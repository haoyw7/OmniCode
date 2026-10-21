import { createContext } from "react";
import { useActiveDragPayload, useDropTarget } from "../../shared/ui/primitives/Sortable";

export const SidebarPinDropContext = createContext<(() => void) | null>(null);
export const InsidePinnedSectionContext = createContext(false);

export function useSidebarPinDrop(enabled: boolean) {
  const payload = useActiveDragPayload();
  const drop = useDropTarget({
    disabled: !enabled,
    accepts: value => (value.type === "sidebar-session" || value.type === "sidebar-project") && !value.pinned && typeof value.onPin === "function",
    onDrop: value => { if (typeof value.onPin === "function") value.onPin(); },
  });
  return {
    isOver: drop.isOver,
    ref: (node: HTMLElement | null) => drop.ref(payload?.insidePins ? node?.querySelector<HTMLElement>("[data-sidebar-section-header]") ?? null : node),
  };
}
