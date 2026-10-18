import { frame as motionFrame, cancelFrame, useMotionValue } from "motion/react";
import { motionGeometry } from "../shared/motion/tokens";
import { lightImpact } from "./haptics";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { moveItem } from "../shared/lib/reorder";

type Drag = { id: string; left: number; top: number; width: number };
const HOLD_MS = 400;
const MOVE_SLOP = 8;

/** Touch-first sorting: short taps open actions, swipes scroll, a hold drags. */
export function useQueueDrag(
  ids: string[],
  enabled: boolean,
  onDrop: (id: string, beforeId?: string) => void,
) {
  const [drag, setDrag] = useState<Drag>();
  const [preview, setPreview] = useState<string[]>();
  const previewElement = useRef<HTMLDivElement | null>(null);
  const previewTop = useRef(0);
  const previewY = useMotionValue(0);
  const previewRef = useCallback((element: HTMLDivElement | null) => {
    previewElement.current = element;
    if (element) previewY.set(previewTop.current);
  }, [previewY]);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const suppressUntil = useRef(0);
  const latest = useRef({ ids, enabled, onDrop });
  latest.current = { ids, enabled, onDrop };
  const key = ids.join("\0");
  const cancel = () => {
    cleanup.current?.();
    setDrag(undefined);
    setPreview(undefined);
  };
  useEffect(() => {
    cancel();
  }, [key]);
  useEffect(() => {
    if (!enabled && cleanup.current) cancel();
  }, [enabled]);
  useEffect(() => () => cleanup.current?.(), []);

  const start = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!enabled || ids.length < 2 || event.button !== 0 || cleanup.current)
      return;
    suppressUntil.current = 0;
    const handle = event.currentTarget;
    const list = handle.parentElement!;
    const nodes = [...list.querySelectorAll<HTMLElement>("[data-queue-id]")];
    const from = ids.indexOf(id);
    if (from < 0 || nodes.length !== ids.length) return;
    let rect = handle.getBoundingClientRect();
    let bounds = list.getBoundingClientRect();
    let centers: number[] = [];
    let maxScroll = 0;
    let geometryDirty = true;
    const startX = event.clientX,
      startY = event.clientY,
      scrollStart = list.scrollTop;
    const grabOffset = startY - rect.top;
    const pointerId = event.pointerId;
    let active = false,
      moved = false,
      y = startY,
      order = ids;
    let frame = 0;
    let publishedDrag: Drag | undefined;
    const measure = () => {
      bounds = list.getBoundingClientRect();
      rect = handle.getBoundingClientRect();
      const scrollTop = list.scrollTop;
      centers = [...list.querySelectorAll<HTMLElement>("[data-queue-id]")].map(
        (node) => {
          const slot = node.getBoundingClientRect();
          // Reorder slides translate the rows without moving their layout slots.
          const transform = getComputedStyle(node).transform;
          const translation =
            transform && transform !== "none"
              ? new DOMMatrixReadOnly(transform).m42
              : 0;
          return (
            slot.top - translation - bounds.top + scrollTop + slot.height / 2
          );
        },
      );
      maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
      geometryDirty = false;
    };
    const place = () => {
      if (geometryDirty) measure();
      const center =
        y - grabOffset + rect.height / 2 - bounds.top + list.scrollTop;
      let to = from,
        distance = Infinity;
      centers.forEach((slot, index) => {
        const nextDistance = Math.abs(center - slot);
        if (nextDistance < distance) {
          to = index;
          distance = nextDistance;
        }
      });
      const next = moveItem(ids, from, to);
      // Most moves stay within the same slot; only a new order re-renders.
      if (next.some((entry, index) => entry !== order[index])) {
        order = next;
        setPreview(order);
      }
      const top = y - grabOffset;
      previewTop.current = top;
      previewY.set(top);
      // Finger movement stays outside React; only geometry and order changes
      // need a render of the queue and its glass preview.
      if (
        publishedDrag?.left !== rect.left ||
        publishedDrag.width !== rect.width
      ) {
        publishedDrag = { id, left: rect.left, top, width: rect.width };
        setDrag(publishedDrag);
      }
    };
    const schedule = () => {
      if (active && !frame) { frame = 1; motionFrame.update(tick); }
    };
    const tick = () => {
      frame = 0;
      if (!active) return;
      if (geometryDirty) measure();
      const speed = y < bounds.top + 24 ? -7 : y > bounds.bottom - 24 ? 7 : 0;
      const before = list.scrollTop;
      const next = Math.max(0, Math.min(maxScroll, before + speed));
      if (next !== before) {
        list.scrollTop = next;
      }
      place();
      // A stationary finger only needs more frames while it can scroll.
      const after = list.scrollTop;
      if (after !== before && (speed < 0 ? after > 0 : after < maxScroll))
        schedule();
    };
    const timer = setTimeout(() => {
      if (moved || !latest.current.enabled) return;
      active = true;
      void lightImpact();
      suppressUntil.current = Infinity;
      place();
      schedule();
    }, HOLD_MS);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      y = next.clientY;
      if (next.cancelable) next.preventDefault();
      if (!active) {
        if (Math.hypot(next.clientX - startX, y - startY) > MOVE_SLOP) {
          moved = true;
          clearTimeout(timer);
          list.scrollTop = scrollStart - (y - startY);
        }
        return;
      }
      schedule();
    };
    const stop = (next?: PointerEvent, commit = false) => {
      if (next && next.pointerId !== pointerId) return;
      const wasActive = active;
      // A release can arrive before the coalesced move frame.
      if (commit && wasActive && latest.current.enabled) {
        if (next) y = next.clientY;
        place();
      }
      active = false;
      clearTimeout(timer);
      cancelFrame(tick);
      frame = 0;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", aborted);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", scrolled, true);
      window.visualViewport?.removeEventListener("resize", invalidate);
      window.visualViewport?.removeEventListener("scroll", invalidate);
      observer?.disconnect();
      if (handle.hasPointerCapture?.(pointerId))
        handle.releasePointerCapture(pointerId);
      cleanup.current = undefined;
      if (wasActive || moved) suppressUntil.current = Date.now() + 500;
      setDrag(undefined);
      if (
        commit &&
        wasActive &&
        latest.current.enabled &&
        order.some((entry, index) => entry !== ids[index])
      ) {
        void lightImpact();
        latest.current.onDrop(id, order[order.indexOf(id) + 1]);
      } else setPreview(undefined);
    };
    const up = (next: PointerEvent) => stop(next, true);
    const aborted = (next: PointerEvent) => stop(next);
    const blur = () => stop();
    const keydown = (next: KeyboardEvent) => {
      if (next.key === "Escape") {
        next.preventDefault();
        stop();
      }
    };
    const invalidate = () => {
      geometryDirty = true;
      schedule();
    };
    const scrolled = (next: Event) => {
      if (next.target === list) schedule();
      else invalidate();
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(invalidate);
    observer?.observe(list);
    for (const node of nodes) observer?.observe(node);
    cleanup.current = () => stop();
    handle.setPointerCapture?.(pointerId);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", aborted);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", keydown);
    window.addEventListener("resize", invalidate);
    window.addEventListener("scroll", scrolled, true);
    window.visualViewport?.addEventListener("resize", invalidate);
    window.visualViewport?.addEventListener("scroll", invalidate);
  };
  return {
    drag,
    previewRef,
    previewStyle: { y: previewY, scale: motionGeometry.queueScale },
    order: preview ?? ids,
    start,
    cancel,
    clearPreview: () => setPreview(undefined),
    suppressClick: () => Date.now() < suppressUntil.current,
  };
}
