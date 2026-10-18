import { animate, motionValue, styleEffect, type AnimationPlaybackControlsWithThen } from "motion/react";
import { springs, immediateTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const REPLY_DISTANCE = 64;
const TIME_DISTANCE = 88;

/** Rows are in document order; do not measure the entire history on touch. */
function visibleRows(log: HTMLElement) {
  const viewport = log.getBoundingClientRect();
  const children = log.children;
  let low = 0,
    high = children.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (children[middle].getBoundingClientRect().bottom < viewport.top)
      low = middle + 1;
    else high = middle;
  }
  const rows: HTMLElement[] = [];
  for (let index = low; index < children.length; index++) {
    const row = children[index];
    if (row.getBoundingClientRect().top > viewport.bottom) break;
    if (
      row instanceof HTMLElement &&
      row.classList.contains("assistant-message-row")
    )
      rows.push(row);
  }
  return rows;
}

function measureRow(row: HTMLElement) {
  const width = row.clientWidth;
  const user = row.classList.contains("assistant-message-row-user");
  const parts = Array.from(row.children)
    .filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        !child.matches(".assistant-swipe-time, .assistant-swipe-reply"),
    )
    .map((node) => ({
      node,
      x: motionValue(0),
      slack: user ? 0 : Math.max(0, width - node.offsetWidth),
    }));
  const cleanups = parts.map(({ node, x }) => styleEffect([node], { x }));
  const time = row.querySelector<HTMLElement>(".assistant-swipe-time");
  const indicator = row.querySelector<HTMLElement>(".assistant-swipe-reply");
  const timeX = motionValue(0), opacity = motionValue(0);
  if (time) cleanups.push(styleEffect([time], { x: timeX, opacity }));
  if (indicator) cleanups.push(styleEffect([indicator], { opacity }));
  return {
    row,
    parts,
    timeX, opacity, cleanups,
    time: row.querySelector<HTMLElement>(".assistant-swipe-time"),
    indicator: row.querySelector<HTMLElement>(".assistant-swipe-reply"),
  };
}

/** Follow the finger without rerendering the history or its streaming Markdown. */
export function useBotMessageSwipe({
  log,
  active,
  replyDisabled,
  onReply,
  cancelHold,
}: {
  log: RefObject<HTMLDivElement | null>;
  active: boolean;
  replyDisabled: boolean;
  onReply: (id: string) => void;
  cancelHold: () => void;
}) {
  const latest = useRef({ replyDisabled, onReply, cancelHold });
  useLayoutEffect(() => {
    latest.current = { replyDisabled, onReply, cancelHold };
  });
  useEffect(() => {
    const element = log.current;
    if (!active || !element) return;
    let swipe:
      | {
          id: number;
          x: number;
          y: number;
          distance: number;
          row: HTMLElement | null;
          mode?: "reply" | "time";
          rows: ReturnType<typeof measureRow>[];
          painted?: number;
        }
      | undefined;
    let suppressClickUntil = 0;
    const settling = new Set<AnimationPlaybackControlsWithThen>();
    const cleanSettled = new Set<() => void>();
    const cancelSettling = () => {
      for (const playback of settling) playback.stop();
      settling.clear();
      for (const cleanup of cleanSettled) cleanup();
      cleanSettled.clear();
    };
    const reset = () => {
      const previous = swipe;
      swipe = undefined;
      delete element.dataset.messageSwipe;
      for (const item of previous?.rows ?? []) {
        const { row, parts, time, indicator, timeX, opacity, cleanups } = item;
        delete row.dataset.messageSwipe; delete row.dataset.replyReady;
        const values = [...parts.map(part => part.x), timeX, opacity];
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          // Flush pending effect writes before detaching and restoring inline styles.
          for (const { node } of parts) styleEffect.flush(node);
          if (time) styleEffect.flush(time);
          if (indicator) styleEffect.flush(indicator);
          for (const cancel of cleanups) cancel();
          for (const value of values) value.destroy();
          for (const { node } of parts) node.style.removeProperty("transform");
          time?.style.removeProperty("transform"); time?.style.removeProperty("opacity"); indicator?.style.removeProperty("opacity");
          cleanSettled.delete(cleanup);
        };
        cleanSettled.add(cleanup);
        const playback = values.map(value => animate(value, 0, reducedMotionQuery().matches ? immediateTransition : springs.drawer));
        playback.forEach(value => settling.add(value));
        void Promise.all(playback).then(() => { playback.forEach(value => settling.delete(value)); cleanup(); });
      }
      if (previous && element.hasPointerCapture?.(previous.id))
        element.releasePointerCapture(previous.id);
    };
    const begin = (event: PointerEvent) => {
      if (swipe) {
        latest.current.cancelHold();
        reset();
        return;
      }
      suppressClickUntil = 0;
      if (
        event.pointerType === "mouse" ||
        event.button !== 0 ||
        !(event.target instanceof Element) ||
        !element.contains(event.target)
      )
        return;
      // Every point in the log can reveal times. Only right-swipe replies
      // exclude controls and horizontal code/table scrollers.
      let row = event.target.closest<HTMLElement>("[data-reply-id]");
      if (
        event.target.closest(
          "a, button, input, textarea, select, pre, table, [contenteditable=true], [role=slider]",
        )
      )
        row = null;
      for (
        let child: Element | null = event.target;
        row && child && child !== element;
        child = child.parentElement
      ) {
        if (
          child.scrollWidth > child.clientWidth &&
          /auto|scroll/.test(getComputedStyle(child).overflowX)
        ) {
          row = null;
          break;
        }
      }
      cancelSettling();
      swipe = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        distance: 0,
        rows: [],
        row,
      };
    };
    const paint = () => {
      const current = swipe;
      if (!current?.mode || current.painted === current.distance) return;
      current.painted = current.distance;
      const distance = current.distance;
      for (const { row, parts, time, indicator, timeX, opacity } of current.rows) {
        // These properties do not inherit into Markdown descendants. No
        // geometry reads or history walks belong in the animation frame.
        for (const { x: position, slack } of parts) {
          const x =
            current.mode === "reply"
              ? distance
              : -Math.max(0, distance - slack);
          position.set(x);
        }
        if (current.mode === "time" && time) {
          timeX.set(94 - distance);
          opacity.set(distance / TIME_DISTANCE);
        } else if (indicator) {
          opacity.set(Math.min(1, distance / REPLY_DISTANCE));
          const ready = String(distance >= REPLY_DISTANCE);
          if (row.dataset.replyReady !== ready) row.dataset.replyReady = ready;
        }
      }
    };
    const move = (event: PointerEvent) => {
      const current = swipe;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.mode) {
        if (Math.hypot(dx, dy) <= 10) return;
        latest.current.cancelHold();
        if (
          Math.abs(dx) <= Math.abs(dy) * 1.2 ||
          (dx > 0 && (!current.row || latest.current.replyDisabled))
        ) {
          reset();
          return;
        }
        current.mode = dx < 0 ? "time" : "reply";
        // Batch all geometry reads before promoting only the visible surfaces.
        current.rows = (
          current.mode === "time" ? visibleRows(element) : [current.row!]
        ).map(measureRow);
        element.dataset.messageSwipe = current.mode;
        for (const { row } of current.rows)
          row.dataset.messageSwipe = current.mode;
        element.setPointerCapture?.(event.pointerId);
        window.getSelection()?.removeAllRanges();
      }
      if (current.mode === "time") {
        current.distance = Math.min(TIME_DISTANCE, Math.max(0, -dx));
      } else if (current.row) {
        current.distance = Math.min(96, Math.max(0, dx));
      }
      paint();
    };
    const end = (event: PointerEvent) => {
      // Touch begins with implicit capture on the bubble. Its bubbling loss
      // when we capture the log is a transfer, not a cancelled swipe.
      if (event.type === "lostpointercapture" && event.target !== element)
        return;
      const current = swipe;
      if (!current || current.id !== event.pointerId) return;
      const replyId =
        event.type === "pointerup" &&
        current.mode === "reply" &&
        event.clientX - current.x >= REPLY_DISTANCE &&
        !latest.current.replyDisabled
          ? current.row?.dataset.replyId
          : undefined;
      if (current.mode) suppressClickUntil = Date.now() + 400;
      reset();
      if (replyId) latest.current.onReply(replyId);
    };
    const holdTouch = (event: TouchEvent) => {
      if (swipe?.mode && event.cancelable) event.preventDefault();
    };
    const swallowClick = (event: MouseEvent) => {
      if (Date.now() >= suppressClickUntil) return;
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    };
    const scroll = () => {
      if (swipe && !swipe.mode) reset();
    };
    document.addEventListener("pointerdown", begin, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", end, true);
    document.addEventListener("pointercancel", end, true);
    element.addEventListener("lostpointercapture", end);
    element.addEventListener("touchmove", holdTouch, { capture: true, passive: false });
    element.addEventListener("click", swallowClick, true);
    element.addEventListener("scroll", scroll);
    return () => {
      reset();
      cancelSettling();
      document.removeEventListener("pointerdown", begin, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", end, true);
      document.removeEventListener("pointercancel", end, true);
      element.removeEventListener("lostpointercapture", end);
      element.removeEventListener("touchmove", holdTouch, true);
      element.removeEventListener("click", swallowClick, true);
      element.removeEventListener("scroll", scroll);
    };
  }, [active, log]);
}
