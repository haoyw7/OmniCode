import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createDragGhost, suppressTextSelection } from "../../../shared/lib/drag";
import { beginPaneResize } from "../../../shared/lib/paneResize";
import { layoutLeaves, movePane, type LayoutNode, type PaneEdge } from "../model/layout";
import { paneDropFromDrag } from "../model/paneDrop";

export type PaneDrag = {
  fromId: string;
  overId: string | null;
  edge: PaneEdge;
  offsets: Map<string, string>;
  insertion: CSSProperties | null;
};

type DragSession<External extends string> = {
  container: HTMLElement;
  source: HTMLElement;
  fromId: string;
  layout: LayoutNode;
  targets?: { id: string; rect: DOMRect }[];
  onFocus?: () => void;
  onMove: (from: string, to: string, edge: PaneEdge, layout: LayoutNode) => void;
  externalTarget?: (x: number, y: number, bounds: DOMRect) => External | null;
  onExternalPreview?: (target: External | null) => void;
  onExternalDrop?: (target: External) => void;
};

/** One pointer lifecycle, full-card ghost and layout preview for workspace panes. */
export function usePaneDrag<External extends string = never>() {
  const [state, setState] = useState<PaneDrag | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const pendingRelease = useRef(new Set<() => void>());
  useEffect(() => () => {
    cancelRef.current?.();
    for (const release of pendingRelease.current) release();
    pendingRelease.current.clear();
  }, []);

  const start = useCallback((event: ReactPointerEvent<HTMLElement>, session: DragSession<External>) => {
    if (event.button !== 0) return;
    cancelRef.current?.();
    event.preventDefault();
    event.stopPropagation();
    const { container, source, fromId, layout: base } = session;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const baseLeaves = layoutLeaves(base);
    const bounds = container.getBoundingClientRect();
    const targets = session.targets ?? Array.from(container.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !!element.dataset.paneId)
      .map(element => ({ id: element.dataset.paneId!, rect: element.getBoundingClientRect() }));
    const cardBounds = (source.querySelector<HTMLElement>("[data-pane-card-frame]") ?? source).getBoundingClientRect();
    const centerOffset = {
      x: cardBounds.left + cardBounds.width / 2 - startX,
      y: cardBounds.top + cardBounds.height / 2 - startY,
    };
    let active = false;
    let ended = false;
    let ghost: ReturnType<typeof createDragGhost> | undefined;
    let releaseResize: (() => void) | undefined;
    let current: PaneDrag | null = null;
    let candidate = base;
    let external: External | null = null;
    const previousCursor = document.body.style.cursor;
    // Capture on the stable layout, not a heading that can move during preview.
    container.setPointerCapture(pointerId);
    const restoreSelection = suppressTextSelection();
    const update = (x: number, y: number) => {
      external = session.externalTarget?.(x, y, bounds) ?? null;
      const over = external ? null : paneDropFromDrag(targets, { x, y }, {
        x: x + centerOffset.x, y: y + centerOffset.y,
        width: cardBounds.width, height: cardBounds.height,
      }, fromId);
      ghost?.move(x, y);
      session.onExternalPreview?.(external);
      const overId = over?.id ?? null;
      const edge = over?.edge ?? "left";
      if (current && current.overId === overId && current.edge === edge) return;
      candidate = over && over.id !== fromId ? movePane(base, fromId, over.id, edge) : base;
      const nextRects = new Map(layoutLeaves(candidate).map(leaf => [leaf.id, leaf.rect]));
      const changesSize = baseLeaves.some(({ id, rect }) => {
        const next = nextRects.get(id)!;
        return Math.abs(rect.w - next.w) > 1e-7 || Math.abs(rect.h - next.h) > 1e-7;
      });
      const offsets = new Map<string, string>();
      if (!changesSize) {
        for (const { id, rect } of baseLeaves) {
          const next = nextRects.get(id)!;
          offsets.set(id, `${(next.x - rect.x) * bounds.width}px ${(next.y - rect.y) * bounds.height}px`);
        }
      }
      const next = nextRects.get(fromId)!;
      const horizontal = edge === "top" || edge === "bottom";
      const insertion: CSSProperties | null = !over || over.id === fromId ? null : horizontal
        ? { left: bounds.left + next.x * bounds.width,
            top: bounds.top + (edge === "top" ? next.y : next.y + next.h) * bounds.height - (edge === "top" ? 0 : 3),
            width: next.w * bounds.width, height: 3 }
        : { left: bounds.left + (edge === "left" ? next.x : next.x + next.w) * bounds.width - (edge === "left" ? 0 : 3),
            top: bounds.top + next.y * bounds.height, width: 3, height: next.h * bounds.height };
      current = { fromId, overId, edge, offsets, insertion };
      setState(current);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        active = true;
        ghost = createDragGhost(source, startX, startY, { className: "pane-drag-ghost", preserveContent: true });
        releaseResize = beginPaneResize();
        document.body.style.cursor = "grabbing";
        session.onFocus?.();
      }
      update(ev.clientX, ev.clientY);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (active) update(ev.clientX, ev.clientY);
      finish(true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(false);
    };
    const onLostCapture = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(false);
    };
    const onBlur = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    };
    function finish(commit: boolean) {
      if (ended) return;
      ended = true;
      cancelRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      container.removeEventListener("lostpointercapture", onLostCapture);
      restoreSelection();
      document.body.style.cursor = previousCursor;
      ghost?.dispose();
      setState(null);
      session.onExternalPreview?.(null);
      try { container.releasePointerCapture(pointerId); } catch { /* already released */ }
      try {
        if (active && commit) {
          if (external) session.onExternalDrop?.(external);
          else if (current?.overId && current.overId !== fromId)
            session.onMove(fromId, current.overId, current.edge, candidate);
        }
      } finally {
        // Commit geometry before fitting PTYs; cancellations can release immediately.
        const release = releaseResize;
        if (release && active && commit) {
          pendingRelease.current.add(release);
          requestAnimationFrame(() => { pendingRelease.current.delete(release); release(); });
        } else release?.();
      }
    }
    cancelRef.current = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    container.addEventListener("lostpointercapture", onLostCapture);
  }, []);

  return { state, start, cancelRef };
}
