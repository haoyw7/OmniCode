import { createContext, type PointerEvent } from "react";
import type { ReorderExternalDrop } from "../../shared/hooks/useAnimatedReorder";

/** Lift only the visible header/card, leaving expanded children in the list. */
export function sidebarDragPreview(_id: string, node: HTMLElement) {
  return (
    node.querySelector<HTMLElement>(
      "[data-sidebar-section-header], [data-project-header], [data-session-card]",
    ) ?? node
  );
}

/** Let shortcut cards share the project list's gesture without losing pane drops. */
export const SidebarEntryReorderContext = createContext<{
  dragging: boolean;
  onPointerDown: (
    event: PointerEvent,
    externalDrop?: ReorderExternalDrop<string>,
  ) => void;
  consumeClick: () => boolean;
} | null>(null);
