import { createContext } from "react";
import type { ReorderExternalDrop } from "../../shared/hooks/useAnimatedReorder";
import { createDragLabel } from "../../shared/lib/drag";

/** Reveal the destination through the sidebar's normal disclosure state. */
export const SidebarPinDropContext = createContext<(() => void) | null>(null);

export function combineSidebarDrops(
  ...candidates: (ReorderExternalDrop<string> | undefined)[]
): ReorderExternalDrop<string> | undefined {
  const drops = candidates.filter((drop) => drop !== undefined);
  if (!drops.length) return;
  return {
    // Visit every target so leaving one clears its feedback before entering another.
    onMove: (id, event) =>
      drops.map((drop) => drop.onMove(id, event)).some(Boolean),
    onDrop: (id, event) => drops.some((drop) => drop.onDrop(id, event)),
    onEnd: (id) => drops.forEach((drop) => drop.onEnd?.(id)),
  };
}

export function sidebarPinDrop(
  source: HTMLElement,
  label: string,
  onPin: () => void,
): ReorderExternalDrop<string> | undefined {
  const root = source.closest<HTMLElement>("[data-project-list]");
  const section = root?.querySelector<HTMLElement>(
    '[data-project-section="pinned"]',
  );
  if (!root || !section) return;
  // Ordinary conversations inside a pinned project may move to the section's
  // header, without treating every reorder inside that project as a pin.
  const target = section.contains(source)
    ? section.querySelector<HTMLElement>("[data-sidebar-section-header]")!
    : section;
  let feedback: ReturnType<typeof createDragLabel> | undefined;
  const contains = (node: HTMLElement, event: PointerEvent) => {
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
  const over = (event: PointerEvent) =>
    target?.isConnected &&
    !target.closest("[inert], [hidden]") &&
    contains(root, event) &&
    contains(target, event);
  const clear = () => {
    delete section.dataset.sidebarPinDropTarget;
    feedback?.dispose();
    feedback = undefined;
  };
  return {
    onMove: (_id, event) => {
      if (!over(event)) {
        clear();
        return false;
      }
      section.dataset.sidebarPinDropTarget = "true";
      feedback ??= createDragLabel(label, label);
      feedback.move(event.clientX, event.clientY, true);
      return true;
    },
    onDrop: (_id, event) => {
      if (!over(event)) return false;
      onPin();
      return true;
    },
    onEnd: clear,
  };
}
