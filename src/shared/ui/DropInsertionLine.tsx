import { createPortal } from "react-dom";
import type { HTMLAttributes } from "react";
import { LAYER } from "../lib/layers";

export type InsertionBounds = { left: number; top: number; width: number; height: number };

/** A viewport marker above DragOverlay, outside clipped and isolated surfaces. */
export function DropInsertionLine({ rect, edge, ...props }: {
  rect: InsertionBounds | null;
  edge: "left" | "right" | "top" | "bottom";
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "style">) {
  if (!rect) return null;
  const horizontal = edge === "top" || edge === "bottom";
  return createPortal(<div {...props} data-ui="drop-insertion-line" aria-hidden="true" style={{
    position: "fixed", pointerEvents: "none", borderRadius: 2,
    background: "var(--user-accent-color, var(--color-accent))",
    left: edge === "right" ? rect.left + rect.width - 3 : rect.left,
    top: edge === "bottom" ? rect.top + rect.height - 3 : rect.top,
    width: horizontal ? rect.width : 3, height: horizontal ? 3 : rect.height,
    zIndex: LAYER.dragHint,
  }} />, document.body);
}
