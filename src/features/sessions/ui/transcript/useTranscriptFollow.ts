import { syncLiveFooterClip } from "../liveFooterClip";
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { followsAfterScroll } from "./useLivePhaseScroll";
import { innerScrollerTakes } from "../../../../shared/hooks/useLockOverscroll";
import {
  animateToBottom,
  FOLLOW_GLIDE,
  isTranscriptEndVisible,
  jumpingScrollers,
  pinToBottom,
  syncTranscriptViewport,
} from "./scrollAnchor";

const WHEEL_HOLD_MS = 150;

/** Keeps the transcript pinned to its end until the reader scrolls away. */
export function useTranscriptFollow({
  scroller,
  transcriptEnd,
  scrollerEl,
  visible,
  touchScroll,
  promptMotion,
  historyEntries,
  onJumpToBottomChange,
  onJumpToBottomReady,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  transcriptEnd: RefObject<HTMLDivElement | null>;
  scrollerEl: HTMLDivElement | null;
  visible: boolean;
  touchScroll: boolean;
  promptMotion?: "mobile";
  historyEntries?: readonly { id: string; text: string }[];
  onJumpToBottomChange?: (show: boolean) => void;
  onJumpToBottomReady?: (jump: () => void) => void;
}) {
  const stickToBottom = useRef(true);
  // Initial placement pins before paint; subsequent content changes glide,
  // including the first output and the final update after busy clears.
  const glideFollow = useRef(false);
  const followViewport = useRef(0);
  const followWidth = useRef(0);
  const followTurn = useRef<{ element: HTMLElement; top: number } | null>(null);
  useEffect(() => {
    const el = scroller.current;
    glideFollow.current = visible;
    return () => {
      glideFollow.current = false;
      if (el) jumpingScrollers.get(el)?.(false);
    };
  }, [visible]);
  const showJumpRef = useRef(false);
  const distanceFromBottom = useRef(0);
  const scrollGeometry = useRef({ top: 0, height: 0, viewport: 0 });
  const wheelHold = useRef(0);
  const scrollDirection = useRef<"up" | "down" | undefined>(undefined);
  const readerDragging = useRef(false);
  const touchReadingUp = useRef(false);

  const setShowJump = useCallback(
    (show: boolean) => {
      if (showJumpRef.current === show) return;
      showJumpRef.current = show;
      onJumpToBottomChange?.(show);
    },
    [onJumpToBottomChange],
  );

  const syncJumpVisibility = useCallback(
    (el: HTMLElement) => {
      if (!el.isConnected) return;
      el.dataset.followLatest = String(stickToBottom.current);
      syncLiveFooterClip(el);
      setShowJump(
        !stickToBottom.current &&
          !isTranscriptEndVisible(el, transcriptEnd.current),
      );
    },
    [setShowJump],
  );

  const rememberScroll = useCallback((el: HTMLElement) => {
    el.dataset.followLatest = String(stickToBottom.current);
    syncLiveFooterClip(el);
    distanceFromBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    scrollGeometry.current = {
      top: el.scrollTop,
      height: el.scrollHeight,
      viewport: el.clientHeight,
    };
  }, []);

  const pinTranscript = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      pinToBottom(el);
      rememberScroll(el);
    },
    [rememberScroll],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!visible || !historyEntries || !el || !stickToBottom.current) return;
    // Cache refreshes and output received while away are already history.
    // Place them before paint, including when a stream glide was in flight;
    // otherwise the old offset briefly exposes much earlier messages.
    syncTranscriptViewport(el);
    jumpingScrollers.get(el)?.(true);
    pinTranscript(el);
  }, [historyEntries, visible, pinTranscript]);

  const pauseFollowing = useCallback(() => {
    stickToBottom.current = false;
    scrollDirection.current = undefined;
    const el = scroller.current;
    if (!el) return;
    // Manual disclosure is reading intent. Stop any pending glide before the
    // fold changes height, and retain this position through its resize frames.
    rememberScroll(el);
    jumpingScrollers.get(el)?.(false);
    syncJumpVisibility(el);
  }, [rememberScroll, syncJumpVisibility]);

  const syncPinned = useCallback(
    (el: HTMLElement) => {
      // The jump animation owns the offset until it lands or is interrupted.
      if (jumpingScrollers.has(el)) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const previous = scrollGeometry.current;
      const previousBottom = Math.max(0, previous.height - previous.viewport);
      if (touchScroll) {
        const layoutChanged =
          previous.height !== el.scrollHeight ||
          previous.viewport !== el.clientHeight;
        // Reaching the end can precede both new output and its scroll event.
        const reachedPreviousBottom =
          el.scrollTop > previous.top + 1 &&
          Math.abs(el.scrollTop - previousBottom) <= 1;
        // Layout/focus adjustments after a tool result can move the offset
        // without changing the final dimensions. On desktop, wheel, touch and
        // keys release following explicitly; infer a scrollbar/selection drag
        // only while the reader holds the pointer. Keep mobile's offset check.
        if (
          (promptMotion === "mobile" || readerDragging.current) &&
          !layoutChanged &&
          el.scrollTop < previous.top - 1 &&
          !followsAfterScroll(
            el,
            previous.top,
            stickToBottom.current,
            previousBottom,
          )
        )
          stickToBottom.current = false;
        if (
          !stickToBottom.current &&
          !touchReadingUp.current &&
          // A slight downward reversal inside the bottom margin is still
          // reading history. Resume only after reaching the actual end.
          (reachedPreviousBottom ||
            (distance <= 1 &&
              (scrollDirection.current === "down" ||
                (!layoutChanged && el.scrollTop > previous.top + 1))))
        )
          stickToBottom.current = true;
        scrollGeometry.current = {
          top: el.scrollTop,
          height: el.scrollHeight,
          viewport: el.clientHeight,
        };
        distanceFromBottom.current = distance;
        syncJumpVisibility(el);
        return;
      }
      // Content growth can precede a queued event from the previous pin.
      // Browser clamping after layout changes is not reading intent either.
      stickToBottom.current = followsAfterScroll(
        el,
        previous.top,
        stickToBottom.current,
        previousBottom,
      );
      rememberScroll(el);
      syncJumpVisibility(el);
    },
    [rememberScroll, syncJumpVisibility, touchScroll, promptMotion],
  );

  const followTranscript = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const widthChanged = followWidth.current !== el.clientWidth;
      const resized = widthChanged || followViewport.current !== el.clientHeight;
      const turn = el.querySelector<HTMLElement>(".transcript-turn-live");
      const turnTop = turn?.offsetTop ?? 0;
      const historyResized = turn !== null && followTurn.current?.element === turn &&
        Math.abs(followTurn.current.top - turnTop) > 1;
      followTurn.current = turn ? { element: turn, top: turnTop } : null;
      followViewport.current = el.clientHeight;
      followWidth.current = el.clientWidth;
      // Keyboard motion already animates the mobile surface. Its layout
      // handoff must pin before paint, including during a streamed row glide.
      // Wrapping during a panel resize moves the scroll range on every frame.
      // Settle an existing glide before it can chase those changing targets.
      if (widthChanged || (promptMotion === "mobile" && resized) ||
        (historyResized && stickToBottom.current))
        jumpingScrollers.get(el)?.(true);
      // The browser can apply a manual scroll before dispatching its event.
      // Reconcile that offset before a streaming commit or observer pins it.
      syncPinned(el);
      // Directionless trackpad events can precede off-thread scrolling.
      // Wait for the gesture to reveal its direction before pinning again.
      if (!stickToBottom.current || performance.now() < wheelHold.current) return;
      // Live output glides; restored history above the turn settles before
      // paint. Any touch stops the glide where it is.
      const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (
        !resized &&
        !historyResized &&
        glideFollow.current &&
        gap > 0.5
      )
        animateToBottom(el, () => {
          rememberScroll(el);
          syncPinned(el);
        }, FOLLOW_GLIDE);
      else pinTranscript(el);
    },
    [pinTranscript, promptMotion, rememberScroll, syncPinned],
  );

  const jumpToBottom = useCallback(() => {
    stickToBottom.current = true;
    scrollDirection.current = undefined;
    distanceFromBottom.current = 0;
    setShowJump(false);
    const el = scroller.current;
    if (el) el.dataset.followLatest = "true";
    syncTranscriptViewport(el);
    animateToBottom(el, () => {
      if (!el) return;
      rememberScroll(el);
      syncPinned(el);
    });
  }, [rememberScroll, setShowJump, syncPinned]);

  useEffect(() => {
    onJumpToBottomReady?.(jumpToBottom);
  }, [jumpToBottom, onJumpToBottomReady]);

  // A pooled transcript outlives its pane; tell each new owner where it stands.
  useEffect(() => {
    onJumpToBottomChange?.(showJumpRef.current);
  }, [onJumpToBottomChange]);

  useEffect(() => {
    if (!visible || !scrollerEl) return;
    syncPinned(scrollerEl);
    const onScroll = () => {
      if (scrollerEl.isConnected && scrollerEl.clientHeight > 0)
        syncPinned(scrollerEl);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 0) readerDragging.current = true;
    };
    const onPointerEnd = () => {
      // Reconcile the last drag position before its queued scroll event.
      if (readerDragging.current && scrollerEl.isConnected)
        syncPinned(scrollerEl);
      readerDragging.current = false;
    };
    let release: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (innerScrollerTakes(scrollerEl, e)) return;
      touchReadingUp.current = false;
      if (e.deltaY) scrollDirection.current = e.deltaY < 0 ? "up" : "down";
      if (e.deltaY < 0) {
        stickToBottom.current = false;
        syncJumpVisibility(scrollerEl);
      } else if (e.deltaY === 0) {
        wheelHold.current = performance.now() + WHEEL_HOLD_MS;
        clearTimeout(release);
        release = setTimeout(() => {
          if (scrollerEl.isConnected) followTranscript(scrollerEl);
        }, WHEEL_HOLD_MS);
      }
    };
    let touchY: number | undefined;
    const onTouchStart = (event: TouchEvent) => {
      if (promptMotion !== "mobile") readerDragging.current = true;
      touchReadingUp.current = false;
      touchY = event.touches[0]?.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY;
      if (next !== undefined && touchY !== undefined) {
        if (next > touchY + 3) {
          touchReadingUp.current = true;
          scrollDirection.current = "up";
          stickToBottom.current = false;
          syncJumpVisibility(scrollerEl);
        } else if (next < touchY - 3) {
          touchReadingUp.current = false;
          scrollDirection.current = "down";
        }
      }
      touchY = next;
    };
    const onTouchEnd = () => {
      if (promptMotion !== "mobile") onPointerEnd();
      touchY = undefined;
      touchReadingUp.current = false;
      scrollDirection.current = undefined;
    };
    const onKey = (event: KeyboardEvent) => {
      touchReadingUp.current = false;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        scrollDirection.current = "up";
        stickToBottom.current = false;
        syncJumpVisibility(scrollerEl);
      } else if (["ArrowDown", "PageDown", "End"].includes(event.key))
        scrollDirection.current = "down";
    };
    scrollerEl.addEventListener("scroll", onScroll, { passive: true });
    scrollerEl.addEventListener("wheel", onWheel, { passive: true });
    if (touchScroll) {
      if (promptMotion !== "mobile") {
        scrollerEl.addEventListener("pointerdown", onPointerDown, { passive: true });
        window.addEventListener("pointerup", onPointerEnd, { passive: true });
        window.addEventListener("pointercancel", onPointerEnd, { passive: true });
      }
      scrollerEl.addEventListener("touchstart", onTouchStart, {
        passive: true,
      });
      scrollerEl.addEventListener("touchmove", onTouchMove, { passive: true });
      scrollerEl.addEventListener("touchend", onTouchEnd, { passive: true });
      scrollerEl.addEventListener("touchcancel", onTouchEnd, { passive: true });
      scrollerEl.addEventListener("keydown", onKey);
    }
    return () => {
      clearTimeout(release);
      readerDragging.current = false;
      scrollerEl.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      scrollerEl.removeEventListener("scroll", onScroll);
      scrollerEl.removeEventListener("wheel", onWheel);
      scrollerEl.removeEventListener("touchstart", onTouchStart);
      scrollerEl.removeEventListener("touchmove", onTouchMove);
      scrollerEl.removeEventListener("touchend", onTouchEnd);
      scrollerEl.removeEventListener("touchcancel", onTouchEnd);
      scrollerEl.removeEventListener("keydown", onKey);
    };
  }, [
    scrollerEl,
    followTranscript,
    syncJumpVisibility,
    syncPinned,
    visible,
    touchScroll,
    promptMotion,
  ]);

  return {
    stickToBottom,
    distanceFromBottom,
    wheelHold,
    setShowJump,
    syncJumpVisibility,
    rememberScroll,
    pinTranscript,
    followTranscript,
    pauseFollowing,
  };
}
