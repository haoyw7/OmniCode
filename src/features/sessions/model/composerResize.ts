import { duration } from "../../../shared/motion/tokens";

/** Matches the composer's `max-h-40`, so the field stops growing where it clips. */
export const COMPOSER_MAX_HEIGHT = 160;

/** Composer size changes: a quick start that settles softly, on both platforms. */
export const COMPOSER_MOTION_MS = duration.msg * 1000;

type Resizable = {
  style: { height: string };
  scrollHeight: number;
  clientHeight?: number;
  animate?: Element["animate"];
  parentElement?: {
    style: { minHeight: string };
    offsetHeight: number;
  } | null;
};

/** A hidden tab stays mounted with no layout box, so it reports 0 here. */
export function resizeComposer(el: Resizable, maxHeight = COMPOSER_MAX_HEIGHT) {
  if (el.scrollHeight === 0) return;
  // Layout is already clean, so this reads the visible (possibly animating) height.
  const wrapper = el.parentElement;
  const minHeight = wrapper?.style.minHeight ?? "";
  // Measuring at `auto` briefly collapses the composer. Keep its space until
  // the final height is ready so the browser cannot clamp the transcript's
  // scroll position while its viewport temporarily grows.
  if (wrapper) wrapper.style.minHeight = `${wrapper.offsetHeight}px`;
  try {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  } finally {
    if (wrapper) wrapper.style.minHeight = minHeight;
  }
}

/**
 * Typing only adds text, which can never make the field shorter. Grow it from
 * one measurement instead of collapsing it to `auto`, which forces two layouts
 * of the whole window on every keystroke.
 */
export function growComposer(
  el: Resizable & { clientHeight: number },
  maxHeight = COMPOSER_MAX_HEIGHT,
) {
  const height = el.scrollHeight;
  if (height === 0 || height <= el.clientHeight) return;
  const target = `${Math.min(height, maxHeight)}px`;
  // Fast typing keeps hitting a still-growing field. Restarting would stall it.
  if (el.style.height === target) return;
  el.style.height = target;
}

/** True when `next` is `previous` with text inserted and nothing removed. */
export function isInsertion(previous: string, next: string): boolean {
  if (next.length < previous.length) return false;
  let start = 0;
  while (start < previous.length && previous[start] === next[start]) start++;
  if (start === previous.length) return true;
  const tail = previous.length - start;
  return next.endsWith(previous.slice(start)) && next.length - tail >= start;
}
