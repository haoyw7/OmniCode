import { useLayoutEffect, type RefObject } from "react";



export type PrependScrollAnchor = { turn: Element; top: number | null };

/**
 * Hold the reader's place while turns above the viewport change height. The
 * scroller opts out of native scroll anchoring, so late markdown, image or
 * disclosure sizing above the viewport needs an explicit correction. Loaded
 * turns use their real heights; scrolling alone must not cause corrections.
 */
export function useTurnScrollAnchor(
  el: HTMLDivElement | null,
  enabled: boolean,
  stickToBottom: RefObject<boolean>,
  onAdjust: (el: HTMLElement) => void,
  prependAnchor: RefObject<PrependScrollAnchor | null>,
) {
  useLayoutEffect(() => {
    const inner = el?.firstElementChild;
    if (!enabled || !el || !inner) return;
    const heights = new WeakMap<Element, number>();
    const resize = new ResizeObserver((entries) => {
      // A parked transcript's scroller is detached and measures zero.
      if (!el.isConnected) return;
      const viewportTop = el.getBoundingClientRect().top;
      let shift = 0;
      let precedingDelta = 0;
      const prepend = prependAnchor.current;
      prependAnchor.current = null;
      const handoff =
        prepend?.top != null && prepend.turn.isConnected &&
        !stickToBottom.current &&
        // Scrolling up into the new page releases the old reading position.
        prepend.top - el.scrollTop < el.clientHeight;
      let beforePrependAnchor = handoff;
      if (handoff) {
        // Content coordinates retain any intervening user scroll. This also
        // covers a boundary turn partly visible in the old load-button space.
        shift = prepend.turn.getBoundingClientRect().top - viewportTop +
          el.scrollTop - prepend.top!;
        precedingDelta = shift;
      }
      const byTurn = new Map(entries.map((entry) => [entry.target, entry]));
      // The callback's entries can arrive out of order. Later turns already
      // include earlier height corrections in their current layout position.
      for (const turn of inner.children) {
        if (turn === prepend?.turn) beforePrependAnchor = false;
        const entry = byTurn.get(turn);
        if (!entry) continue;
        const height =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const previous = heights.get(entry.target);
        heights.set(entry.target, height);
        // The handoff already includes the inserted prefix. Old turns still
        // need their own correction if they resize above the reading position.
        if (beforePrependAnchor || previous === undefined || stickToBottom.current) continue;
        // Only turns that sat wholly above the view. A turn the reader is
        // looking at grows downward from where they are reading.
        const top = entry.target.getBoundingClientRect().top - precedingDelta;
        if (top + previous <= viewportTop) shift += height - previous;
        precedingDelta += height - previous;
      }
      if (shift) {
        el.scrollTop += shift;
        onAdjust(el);
      }
    });
    let observed = new WeakSet<Element>();
    const observeTurns = () => {
      for (const turn of inner.children) {
        if (observed.has(turn) || !turn.classList.contains("transcript-turn"))
          continue;
        observed.add(turn);
        resize.observe(turn);
      }
    };
    const mutations = new MutationObserver((records) => {
      // Removal is rare (a rewind or edit), so start over rather than hold
      // detached turns. Re-observed turns report the height already stored.
      if (records.some((record) => record.removedNodes.length > 0)) {
        resize.disconnect();
        observed = new WeakSet();
      }
      observeTurns();
    });
    mutations.observe(inner, { childList: true });
    observeTurns();
    return () => {
      prependAnchor.current = null;
      mutations.disconnect();
      resize.disconnect();
    };
  }, [el, enabled, stickToBottom, onAdjust, prependAnchor]);
}
