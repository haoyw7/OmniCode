import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { nestedScrollAbsorbsWheel } from "../../model/transcriptActivity";

/** Whether a scroller keeps following its end after the reader scrolled it. */
export function followsAfterScroll(
  el: HTMLElement,
  previousTop: number,
  following: boolean,
  previousBottom?: number,
): boolean {
  const movement = el.scrollTop - previousTop;
  // A zoomed webview reports fractional offsets that can settle back by a
  // sub-pixel after a pin or glide; that is not the reader scrolling up.
  if (
    movement === 0 ||
    (following && movement > -1) ||
    scrollClampedToBottom(el, previousTop)
  )
    return following;
  // A small downward reversal while reading inside the bottom margin must
  // not restart following. Resume only when the reader reaches the end.
  // A downward move cannot release an existing pin. New output may also land
  // between reaching the old end and the browser delivering its scroll event.
  return (
    movement > 0 &&
    (following ||
      el.scrollHeight - el.scrollTop - el.clientHeight <= 1 ||
      (previousBottom !== undefined &&
        Math.abs(el.scrollTop - previousBottom) <= 1))
  );
}

function scrollClampedToBottom(el: HTMLElement, previousTop: number): boolean {
  const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
  return previousTop > bottom && Math.abs(el.scrollTop - bottom) < 1;
}

/**
 * Keep a live phase body on its newest step. Pinning happens in layout
 * before paint so the window follows without a visible hitch; only a real
 * wheel away from the bottom pauses that.
 */
export function useLivePhaseScroll(
  el: HTMLDivElement | null,
  enabled: boolean,
  /** Changes whenever the content grows; the window re-pins on each change. */
  steps: unknown,
) {
  const stickToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const lastBottom = useRef(0);
  const wasEnabled = useRef(false);

  const rememberScroll = useCallback(() => {
    if (!el) return;
    lastScrollTop.current = el.scrollTop;
    lastBottom.current = Math.max(0, el.scrollHeight - el.clientHeight);
  }, [el]);

  const syncFollowing = useCallback(() => {
    if (!el) return;
    // Reconcile a manual scroll the browser applied before its event fired.
    stickToBottom.current = followsAfterScroll(
      el,
      lastScrollTop.current,
      stickToBottom.current,
      lastBottom.current,
    );
    rememberScroll();
  }, [el, rememberScroll]);

  const pin = useCallback(() => {
    if (!el) return;
    syncFollowing();
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    rememberScroll();
  }, [el, rememberScroll, syncFollowing]);

  useLayoutEffect(() => {
    if (!enabled) {
      wasEnabled.current = false;
      return;
    }
    if (!wasEnabled.current) {
      stickToBottom.current = true;
      rememberScroll();
      wasEnabled.current = true;
    }
    pin();
  }, [el, enabled, pin, rememberScroll, steps]);

  useEffect(() => {
    if (!el || !enabled) return;

    const onScroll = syncFollowing;
    const onWheel = (e: WheelEvent) => {
      if (!nestedScrollAbsorbsWheel(el, e.deltaY)) return;
      if (e.deltaY < 0) stickToBottom.current = false;
      e.stopPropagation();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    const inner = el.firstElementChild;
    const observer = new ResizeObserver(pin);
    observer.observe(el);
    if (inner) observer.observe(inner);
    pin();
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [el, enabled, pin, syncFollowing]);
}
