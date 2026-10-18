import { useEffect, useRef, type PointerEvent, type MouseEvent } from "react";

/** Touch/pen context actions that yield to scrolling and suppress the following tap. */
export function useLongPress<T extends HTMLElement>(onLongPress: (target: HTMLElement) => void, enabled = true) {
  const press = useRef<{ id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const triggered = useRef(false);
  const cancel = () => { if (press.current) clearTimeout(press.current.timer); press.current = undefined; };
  useEffect(() => { if (!enabled) cancel(); return cancel; }, [enabled]);
  return {
    onPointerDown: (event: PointerEvent<T>) => {
      cancel(); triggered.current = false;
      if (!enabled || event.button !== 0 || event.pointerType === "mouse" || !event.isPrimary) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
      if (!target || !event.currentTarget.contains(target)) return;
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
        triggered.current = true;
        onLongPress(target);
      }, 450) };
    },
    onPointerMove: (event: PointerEvent<T>) => {
      const current = press.current;
      if (current?.id === event.pointerId && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: (event: MouseEvent<T>) => {
      if (triggered.current) { event.preventDefault(); event.stopPropagation(); triggered.current = false; }
    },
    onContextMenuCapture: (event: MouseEvent<T>) => {
      cancel();
      if (triggered.current) { event.preventDefault(); event.stopPropagation(); }
    },
  };
}
