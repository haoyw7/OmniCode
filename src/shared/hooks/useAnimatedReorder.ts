import { animate, cancelFrame, frame as motionFrame, type AnimationPlaybackControls } from "motion/react";
import { duration as motionDuration, immediateTransition, panelTransition } from "../motion/tokens";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { reducedMotionQuery } from "../lib/reducedMotion";
import { flushSync } from "react-dom";
import { createDragGhost, setGrabbing, suppressTextSelection } from "../lib/drag";
import { moveItem } from "../lib/reorder";

export type ReorderExternalDrop<T extends string> = {
  /** Return true while the pointer is over an external drop target. */
  onMove: (id: T, event: globalThis.PointerEvent) => boolean;
  /** Return true when the external target consumed the drop. */
  onDrop: (id: T, event: globalThis.PointerEvent) => boolean;
  onEnd?: (id: T) => void;
};

/** Pointer distance from a scroller edge at which reorder auto-scroll starts. */
const AUTO_SCROLL_EDGE = 40;
/** Auto-scroll speed in pixels per frame once the pointer reaches the edge. */
const AUTO_SCROLL_MAX_SPEED = 14;

function nearestScroller(element: HTMLElement, axis: "x" | "y") {
  for (
    let node = element.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (
      !(axis === "x"
        ? node.scrollWidth > node.clientWidth
        : node.scrollHeight > node.clientHeight)
    )
      continue;
    const style = getComputedStyle(node);
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

export type ReorderOptions<T extends string> = {
  activationDistance?: number;
  collapsedSize?: (id: T, node: HTMLElement) => number | undefined;
  /** Lift this part of the item into a free-moving, unclipped pointer preview. */
  floatingPreview?: (id: T, node: HTMLElement) => HTMLElement;
};

/** Direct manipulation for a row or column, optionally compacting the dragged item. */
export function useAnimatedReorder<T extends string>(
  ids: T[],
  onReorder: (ids: T[], movedId: T) => void,
  axis: "x" | "y" = "x",
  externalDrop?: ReorderExternalDrop<T>,
  options?: ReorderOptions<T>,
) {
  const nodes = useRef(new Map<T, HTMLElement>());
  const [draggingId, setDraggingId] = useState<T | null>(null);
  const latest = useRef({ ids, onReorder, externalDrop, options });
  useLayoutEffect(() => {
    latest.current = { ids, onReorder, externalDrop, options };
  }, [ids, onReorder, externalDrop, options]);
  const cleanup = useRef<(() => void) | null>(null);
  const finishSettling = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  const orderKey = ids.join("\0");

  useLayoutEffect(() => () => cleanup.current?.(), [orderKey]);

  const setItemRef = useCallback((id: T, node: HTMLElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const onItemPointerDown = useCallback(
    (
      id: T,
      event: ReactPointerEvent,
      gestureExternalDrop?: ReorderExternalDrop<T>,
    ) => {
      if (event.button !== 0) return;
      finishSettling.current?.();
      if (cleanup.current) return;
      // A new press is a click candidate, even immediately after a previous drag.
      suppressClickUntil.current = 0;
      const items = latest.current.ids;
      const from = items.indexOf(id);
      const external = () => gestureExternalDrop ?? latest.current.externalDrop;
      if (from < 0 || (items.length < 2 && !external())) return;
      const elements = items.map((item) => nodes.current.get(item));
      if (elements.some((element) => !element)) return;
      const tabs = elements as HTMLElement[];
      // Measure once: animated positions must not affect the drop calculation.
      const rects = tabs.map((element) => {
        const rect = element.getBoundingClientRect();
        const start = axis === "x" ? rect.left : rect.top;
        const size = axis === "x" ? rect.width : rect.height;
        return { start, size, end: start + size };
      });
      const transform = (offset: number) =>
        axis === "x"
          ? `translate3d(${offset}px, 0, 0)`
          : `translate3d(0, ${offset}px, 0)`;
      const coordinate = axis === "x" ? "clientX" : "clientY";
      const handle = tabs[from];
      const scrollProperty = axis === "x" ? "scrollLeft" : "scrollTop";
      const scrollParents: { element: HTMLElement; start: number }[] = [];
      for (
        let element = handle.parentElement;
        element;
        element = element.parentElement
      ) {
        scrollParents.push({ element, start: element[scrollProperty] });
      }
      const pointerId = event.pointerId;
      const startPosition = event[coordinate];
      const reducedMotion = reducedMotionQuery().matches;
      const duration = reducedMotion ? 0 : motionDuration.panel * 1000;
      const animations = new Map<HTMLElement, AnimationPlaybackControls>();
      function setTransform(element: HTMLElement, offset: number, complete?: () => void) {
        const target = transform(offset);
        const previous = animations.has(element) && typeof getComputedStyle === "function"
          ? getComputedStyle(element).transform || transform(0)
          : element.style.transform || transform(0);
        animations.get(element)?.stop();
        element.style.transform = target;
        if (!duration) { complete?.(); return; }
        const controls = animate(element, { transform: [previous, target] }, { ...panelTransition, onComplete: complete });
        animations.set(element, controls);
      }
      let restoreSelection: (() => void) | undefined;
      let previewSource: HTMLElement | undefined;
      let ghost: ReturnType<typeof createDragGhost> | undefined;
      let active = false;
      let collapsedLayout = false;
      let settling = false;
      let destination = from;
      let frame = 0;
      let pointerPosition = startPosition;
      let overExternalTarget = false;
      const scroller = nearestScroller(handle, axis);
      let autoScrollFrame = 0;

      function releasePointer() {
        for (const element of tabs) delete element.dataset.reordering;
        delete handle.dataset.dragging;
        if (restoreSelection) {
          restoreSelection();
          restoreSelection = undefined;
          setGrabbing(false);
        }
        if (handle.hasPointerCapture(pointerId))
          handle.releasePointerCapture(pointerId);
      }

      function reset() {
        window.removeEventListener("pointerdown", onNextPointerDown, true);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", onCancel);
        window.removeEventListener("scroll", onScroll, true);
        for (const [element, controls] of animations) {
          controls.stop();
          // Clear Motion's stored value as well as the gesture's inline style.
          animate(element, { transform: "none" }, immediateTransition);
        }
        animations.clear();
        cancelFrame(paintFrame);
        stopAutoScroll();
        for (const element of tabs) {
          element.style.removeProperty("transition");
          element.style.removeProperty("transform");
          delete element.dataset.settling;
        }
        releasePointer();
        ghost?.dispose();
        ghost = undefined;
        delete handle.dataset.reorderFloating;
        if (active) suppressClickUntil.current = performance.now() + 400;
        external()?.onEnd?.(id);
        cleanup.current = null;
        finishSettling.current = null;
        setDraggingId(null);
      }

      // Where each item starts once the list is reordered. Items keep their own
      // sizes and each slot keeps its original gap, so a tall item pushes its
      // neighbours by its own size rather than theirs.
      function reorderedStarts(to: number) {
        const order = moveItem(
          rects.map((_, index) => index),
          from,
          to,
        );
        const starts = new Array<number>(rects.length);
        let position = rects[0].start;
        order.forEach((index, slot) => {
          starts[index] = position;
          const gap =
            slot < rects.length - 1 ? rects[slot + 1].start - rects[slot].end : 0;
          position += rects[index].size + gap;
        });
        return starts;
      }

      function preview(to: number) {
        const starts = collapsedLayout ? null : reorderedStarts(to);
        for (let index = 0; index < tabs.length; index++) {
          if (index === from) continue;
          if (collapsedLayout) {
            // Expanded siblings keep their own sizes while making room for only
            // the compact dragged item and the adjacent gap.
            const offset =
              index > from && index <= to
                ? rects[from].start - rects[from + 1].start
                : index >= to && index < from
                  ? rects[from].end - rects[from - 1].end
                  : 0;
            setTransform(tabs[index], offset);
            continue;
          }
          setTransform(tabs[index], starts![index] - rects[index].start);
        }
      }

      function paint(moveHandle = true) {
        frame = 0;
        // Scroll moves the original slots without changing their layout order.
        const scrollOffset = scrollParents.reduce(
          (offset, { element, start }) =>
            offset + element[scrollProperty] - start,
          0,
        );
        const offset = Math.max(
          rects[0].start - rects[from].start,
          Math.min(
            pointerPosition - startPosition + scrollOffset,
            rects[rects.length - 1].end - rects[from].end,
          ),
        );
        if (moveHandle && !ghost) {
          handle.style.transform = transform(offset);
        }
        const center = rects[from].start + rects[from].size / 2 + offset;
        const next = rects.reduce((nearest, rect, index) => {
          const distance = Math.abs(center - rect.start - rect.size / 2);
          const previous = rects[nearest];
          return distance <
            Math.abs(center - previous.start - previous.size / 2)
            ? index
            : nearest;
        }, from);
        if (next !== destination) {
          destination = next;
          preview(next);
        }
      }

      function autoScrollSpeed() {
        if (!scroller) return 0;
        const rect = scroller.getBoundingClientRect();
        const start = axis === "x" ? rect.left : rect.top;
        const end = axis === "x" ? rect.right : rect.bottom;
        const edge = Math.min(AUTO_SCROLL_EDGE, (end - start) / 4);
        if (pointerPosition < start + edge)
          return -AUTO_SCROLL_MAX_SPEED *
            Math.min(1, (start + edge - pointerPosition) / edge);
        if (pointerPosition > end - edge)
          return AUTO_SCROLL_MAX_SPEED *
            Math.min(1, (pointerPosition - end + edge) / edge);
        return 0;
      }

      function stopAutoScroll() {
        cancelFrame(autoScroll);
        autoScrollFrame = 0;
      }

      function autoScroll() {
        autoScrollFrame = 0;
        if (!scroller || !active || settling || overExternalTarget) return;
        const speed = autoScrollSpeed();
        if (!speed) return;
        const previous = scroller[scrollProperty];
        const limit =
          axis === "x"
            ? scroller.scrollWidth - scroller.clientWidth
            : scroller.scrollHeight - scroller.clientHeight;
        scroller[scrollProperty] = Math.max(0, Math.min(limit, previous + speed));
        if (scroller[scrollProperty] === previous) return;
        // Update the drop slots even while the pointer is held still at an edge.
        cancelFrame(paintFrame);
        paint();
        autoScrollFrame = 1;
        motionFrame.update(autoScroll);
      }

      function paintFrame() { paint(); }
      function onScroll() {
        if (active && !settling && !overExternalTarget && !frame) {
          frame = 1;
          motionFrame.render(paintFrame);
        }
      }

      function onMove(ev: globalThis.PointerEvent) {
        if (ev.pointerId !== pointerId || settling) return;
        // The button is already up but its pointerup never reached us: drop
        // the drag instead of leaving the item stuck to the cursor.
        if (
          ev.type === "pointermove" &&
          ev.pointerType === "mouse" &&
          ev.buttons === 0
        ) {
          stop(false);
          return;
        }
        pointerPosition = ev[coordinate];
        if (!active) {
          if (
            (external() || latest.current.options?.floatingPreview
              ? Math.hypot(ev.clientX - event.clientX, ev.clientY - event.clientY)
              : Math.abs(pointerPosition - startPosition)) <
            (latest.current.options?.activationDistance ?? 5)
          )
            return;
          active = true;
          previewSource = latest.current.options?.floatingPreview?.(id, handle);
          if (previewSource) {
            // Snapshot before the disclosure closes, retaining the grab point.
            ghost = createDragGhost(previewSource, event.clientX, event.clientY);
            handle.dataset.reorderFloating = "true";
          }
          const collapsedSize = latest.current.options?.collapsedSize?.(
            id,
            handle,
          );
          if (
            collapsedSize !== undefined &&
            collapsedSize >= 0 &&
            collapsedSize <= rects[from].size
          ) {
            collapsedLayout = true;
            const delta = rects[from].size - collapsedSize;
            rects[from].size = collapsedSize;
            rects[from].end -= delta;
            for (let index = from + 1; index < rects.length; index++) {
              rects[index].start -= delta;
              rects[index].end -= delta;
            }
          }
          flushSync(() => setDraggingId(id));
          handle.setPointerCapture(pointerId);
          restoreSelection = suppressTextSelection();
          setGrabbing(true);
          for (const element of tabs) {
            element.dataset.reordering = "true";
          }
          handle.style.transition = "none";
          handle.dataset.dragging = "true";
        }
        // The visual follows both coordinates, even outside this list or while
        // an external drop target owns the gesture. Only sorting is axis-bound.
        ghost?.move(ev.clientX, ev.clientY);
        overExternalTarget =
          external()?.onMove(id, ev) ?? false;
        if (overExternalTarget) {
          cancelFrame(paintFrame);
          frame = 0;
          stopAutoScroll();
          preview(from);
          return;
        }
        // Keep the newest position when several input events arrive in one frame.
        if (!frame) { frame = 1; motionFrame.render(paintFrame); }
        if (!autoScrollFrame && autoScrollSpeed()) {
          autoScrollFrame = 1;
          motionFrame.update(autoScroll);
        }
      }

      function stop(commit: boolean, event?: globalThis.PointerEvent) {
        if (settling) return;
        if (!active) {
          reset();
          return;
        }
        if (commit && event && external()?.onDrop(id, event)) {
          reset();
          return;
        }
        settling = true;
        cancelFrame(paintFrame);
        stopAutoScroll();
        if (commit) paint(false);
        handle.dataset.settling = "true";
        releasePointer();
        suppressClickUntil.current = performance.now() + duration + 400;
        const to = commit ? destination : from;
        preview(to);
        const offset = collapsedLayout
          ? to > from
            ? rects[to].end - rects[from].end
            : rects[to].start - rects[from].start
          : reorderedStarts(to)[from] - rects[from].start;
        if (ghost && previewSource) {
          const rect = previewSource.getBoundingClientRect();
          ghost.settle(
            rect.left + (axis === "x" ? offset : 0),
            rect.top + (axis === "y" ? offset : 0),
            panelTransition,
          );
        }
        const finish = () => {
          // Clear the preview and commit the order before the next browser paint.
          flushSync(() => {
            reset();
            if (commit && to !== from)
              latest.current.onReorder(moveItem(items, from, to), id);
          });
        };
        finishSettling.current = finish;
        if (duration === 0) finish();
        else {
          // Commit before a new press can change the list, including close buttons.
          window.addEventListener("pointerdown", onNextPointerDown, true);
          setTransform(handle, offset, finish);
        }
      }

      function onNextPointerDown() {
        finishSettling.current?.();
      }

      function onUp(ev: globalThis.PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        onMove(ev);
        stop(true, ev);
      }
      function onCancel() {
        stop(false);
      }
      function onKey(ev: KeyboardEvent) {
        if (ev.key === "Escape") {
          ev.preventDefault();
          stop(false);
        }
      }

      cleanup.current = reset;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
      window.addEventListener("blur", onCancel);
      window.addEventListener("scroll", onScroll, true);
    },
    [axis],
  );

  const consumeClick = useCallback(
    () => performance.now() < suppressClickUntil.current,
    [],
  );
  return { draggingId, setItemRef, onItemPointerDown, consumeClick };
}
