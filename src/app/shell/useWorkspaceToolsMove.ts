import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { createDragGhost, suppressTextSelection } from "../../shared/lib/drag";
import { paneEdgeFromPoint, type PaneEdge } from "../../features/workspace/model/layout";

/** Move the retained tools panel between workspace edges without remounting it. */
export function useWorkspaceToolsMove({
  enabled, layout, panel, onMove,
}: {
  enabled: boolean;
  layout: RefObject<HTMLDivElement | null>;
  panel: RefObject<HTMLElement | null>;
  onMove: (side: PaneEdge) => void;
}) {
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState<PaneEdge | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  useEffect(() => { if (!enabled) stop.current?.(); }, [enabled]);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!enabled || event.button !== 0 || stop.current || !layout.current || !panel.current) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const source = panel.current.querySelector<HTMLElement>('[data-ui="app-header"]') ?? panel.current;
    const bounds = layout.current.getBoundingClientRect();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let frame: number | null = null;
    let latest = { x: startX, y: startY };
    let ghost: ReturnType<typeof createDragGhost> | undefined;
    const previousCursor = document.body.style.cursor;
    const restoreSelection = suppressTextSelection();
    const targetAt = (x: number, y: number) =>
      x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom
        ? null : paneEdgeFromPoint(x, y, bounds);
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        active = true;
        ghost = createDragGhost(source, startX, startY);
        document.body.style.cursor = "grabbing";
        setMoving(true);
      }
      latest = { x: ev.clientX, y: ev.clientY };
      if (frame === null) frame = requestAnimationFrame(() => {
        frame = null;
        ghost?.move(latest.x, latest.y);
        setTarget(targetAt(latest.x, latest.y));
      });
    };
    const finish = (side: PaneEdge | null) => {
      if (!stop.current) return;
      stop.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      handle.removeEventListener("lostpointercapture", cancel);
      ghost?.dispose();
      restoreSelection();
      document.body.style.cursor = previousCursor;
      setMoving(false);
      setTarget(null);
      try { handle.releasePointerCapture(pointerId); } catch { /* already released */ }
      if (active && side) onMoveRef.current(side);
    };
    const up = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId === pointerId) finish(targetAt(ev.clientX, ev.clientY));
    };
    const cancel = () => finish(null);
    const cancelPointer = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId === pointerId) cancel();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
    };
    stop.current = cancel;
    handle.setPointerCapture(pointerId);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    handle.addEventListener("lostpointercapture", cancel);
  };
  return { moving, target, onPointerDown };
}
