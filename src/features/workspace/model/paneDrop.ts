import { create } from "zustand";
import { paneEdgeFromPoint, type PaneEdge } from "./layout";

export type PaneDrop = {
  fromId: string;
  overId: string | null;
  edge: PaneEdge;
};

const usePaneDrop = create<{ drop: PaneDrop | null }>(() => ({ drop: null }));

export function setExternalPaneDrop(next: PaneDrop | null) {
  const drop = usePaneDrop.getState().drop;
  if (
    drop?.fromId === next?.fromId &&
    drop?.overId === next?.overId &&
    drop?.edge === next?.edge
  ) {
    return;
  }
  if (drop == null && next == null) return;
  usePaneDrop.setState({ drop: next });
}

export function subscribeExternalPaneDrop(listener: () => void) {
  return usePaneDrop.subscribe(listener);
}

export function getExternalPaneDrop() {
  return usePaneDrop.getState().drop;
}

/** Overlay for a drag that starts outside the pane tree (sidebar cards). */
export function useExternalPaneDrop(enabled = true) {
  return usePaneDrop(state => enabled ? state.drop : null);
}

export function paneDropFromPoint(
  x: number,
  y: number,
): { id: string; edge: PaneEdge } | null {
  const el = document.elementFromPoint(x, y);
  const pane = el?.closest("[data-pane-id]") as HTMLElement | null;
  const id = pane?.dataset.paneId;
  if (!id || !pane) return null;
  return { id, edge: paneEdgeFromPoint(x, y, pane.getBoundingClientRect()) };
}

type PaneDragPoint = { x: number; y: number };
type PaneDragCard = PaneDragPoint & { width: number; height: number };
type PaneDragTarget = {
  id: string;
  rect: { left: number; top: number; width: number; height: number };
};
const PANE_EDGES: readonly PaneEdge[] = ["left", "right", "top", "bottom"];

/** Both grab point and visible card center can nominate a target edge.
 * Compare CSS-pixel distances; equal candidates retain the grab point.
 * A center beyond an edge stays at that edge while its card overlaps. */
export function paneDropFromDrag(
  targets: readonly PaneDragTarget[],
  pointer: PaneDragPoint,
  card: PaneDragCard,
  fromId: string,
): { id: string; edge: PaneEdge } | null {
  let result: { id: string; edge: PaneEdge } | null = null;
  let closest = Infinity;
  const centerInsideTarget = targets.some(({ id, rect }) => id !== fromId && rect.width > 0 && rect.height > 0 &&
    card.x >= rect.left && card.x <= rect.left + rect.width && card.y >= rect.top && card.y <= rect.top + rect.height);
  const pointerInsideTarget = targets.some(({ id, rect }) => id !== fromId && rect.width > 0 && rect.height > 0 &&
    pointer.x >= rect.left && pointer.x <= rect.left + rect.width && pointer.y >= rect.top && pointer.y <= rect.top + rect.height);
  for (const point of [pointer, card]) {
    let pointResult: { id: string; edge: PaneEdge } | null = null;
    let pointClosest = Infinity;
    let pointScore = Infinity;
    for (const { id, rect } of targets) {
      if (id === fromId || rect.width <= 0 || rect.height <= 0) continue;
      const right = rect.left + rect.width;
      const bottom = rect.top + rect.height;
      const pointerInside = pointer.x >= rect.left && pointer.x <= right && pointer.y >= rect.top && pointer.y <= bottom;
      const cardOverlaps = card.x + card.width / 2 > rect.left && card.x - card.width / 2 < right &&
        card.y + card.height / 2 > rect.top && card.y - card.height / 2 < bottom;
      if (!pointerInside && !cardOverlaps) continue;
      if (point === card && !cardOverlaps) continue;
      if (point === card && centerInsideTarget && !(card.x >= rect.left && card.x <= right && card.y >= rect.top && card.y <= bottom)) continue;
      if (point === pointer && pointerInsideTarget && !pointerInside) continue;
      // Nominate the nearest border using actual distances first, so an
      // overlapping card cannot steal the center's target from a nearer pane.
      const dx = Math.max(rect.left - point.x, 0, point.x - right);
      const dy = Math.max(rect.top - point.y, 0, point.y - bottom);
      const inward: Record<PaneEdge, number> = {
        left: point.x - rect.left, right: right - point.x,
        top: point.y - rect.top, bottom: bottom - point.y,
      };
      const distances: Record<PaneEdge, number> = {
        left: inward.left ** 2 + dy ** 2,
        right: inward.right ** 2 + dy ** 2,
        top: inward.top ** 2 + dx ** 2,
        bottom: inward.bottom ** 2 + dx ** 2,
      };
      // Preserve the existing diagonal tie break, then compare actual distances.
      let edge = paneEdgeFromPoint(point.x, point.y, rect);
      for (const candidate of PANE_EDGES) {
        if (distances[candidate] < distances[edge]) edge = candidate;
      }
      if (distances[edge] < pointClosest) {
        pointClosest = distances[edge];
        pointResult = { id, edge };
        // Once the center crosses its nominated edge, extra outward travel
        // must not let the grab point pull the insertion back to another side.
        const normal = point === card ? Math.max(0, inward[edge]) : inward[edge];
        const tangent = edge === "left" || edge === "right" ? dy : dx;
        pointScore = normal ** 2 + tangent ** 2;
      }
    }
    if (pointScore < closest) {
      closest = pointScore;
      result = pointResult;
    }
  }
  return result;
}

/**
 * A split terminal dragged toward the project's terminal dock: over the open
 * dock, or over the bottom band where a closed dock would open.
 */
export type TerminalDockDrop = "dock" | "band" | null;

const useDockDrop = create<{ drop: TerminalDockDrop }>(() => ({ drop: null }));

export function setTerminalDockDrop(next: TerminalDockDrop) {
  if (useDockDrop.getState().drop !== next) useDockDrop.setState({ drop: next });
}

export function useTerminalDockDrop() {
  return useDockDrop(state => state.drop);
}

/** Height of the bottom strip that docks a dragged terminal when no dock is open. */
export const TERMINAL_DOCK_BAND = 56;

/** Whether the point is over the open terminal dock. */
export function overOpenTerminalDock(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  return !!el?.closest("[data-project-terminal-dock]:not([inert] *)");
}

/** An open dock that can receive terminals is on screen. */
export function terminalDockOpen(): boolean {
  return !!document.querySelector(
    "[data-project-terminal-dock]:not([inert] *)",
  );
}
