import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { type Block } from "../../model/session";
import { syncTranscriptViewport } from "./scrollAnchor";
import { type PrependScrollAnchor } from "./useTurnScrollAnchor";

const INITIAL_TURNS = 20;
/**
 * Turns built before a transcript first paints. Every turn in the initial
 * window costs markdown work on open, so paint the latest few (more if they
 * leave the viewport short) and build the rest of the window after.
 */
const FIRST_PAINT_TURNS = 3;
const TURN_PAGE_SIZE = 20;

/** The window of recent turns the transcript renders, grown by Load earlier and reveals. */
export function useTranscriptPaging({
  turns,
  scroller,
  prependAnchor,
  stickToBottom,
  distanceFromBottom,
  wheelHold,
  pinTranscript,
  rememberScroll,
  onRevealReady,
}: {
  turns: Block[][];
  scroller: RefObject<HTMLDivElement | null>;
  prependAnchor: RefObject<PrependScrollAnchor | null>;
  stickToBottom: RefObject<boolean>;
  distanceFromBottom: RefObject<number>;
  wheelHold: RefObject<number>;
  pinTranscript: (el: HTMLElement | null) => void;
  rememberScroll: (el: HTMLElement) => void;
  onRevealReady?: (reveal: (blockId: string) => boolean) => void;
}) {
  const prependHeight = useRef<number | null>(null);
  const [visibleTurnCount, setVisibleTurnCount] = useState(FIRST_PAINT_TURNS);
  const firstVisibleTurn = Math.max(0, turns.length - visibleTurnCount);
  const visibleTurns = turns.slice(firstVisibleTurn);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const visibleTurnCountRef = useRef(visibleTurnCount);
  visibleTurnCountRef.current = visibleTurnCount;

  useLayoutEffect(() => {
    const previousHeight = prependHeight.current;
    const el = scroller.current;
    if (!el) return;
    if (previousHeight == null) {
      // The opening window grows above the screen. Settle the offset in this
      // commit: a scroll event queued by an earlier pin would otherwise read
      // the taller transcript first and unpin it partway up. Inserting turns
      // can also nudge scrollTop; a wheel or touch already releases the pin.
      if (stickToBottom.current) {
        syncTranscriptViewport(el);
        if (performance.now() >= wheelHold.current) pinTranscript(el);
      } else {
        el.scrollTop =
          el.scrollHeight - el.clientHeight - distanceFromBottom.current;
        rememberScroll(el);
      }
      return;
    }
    prependHeight.current = null;
    el.scrollTop += el.scrollHeight - previousHeight;
    rememberScroll(el);
    const anchor = prependAnchor.current;
    if (anchor) {
      // Hand the compensated position to the existing turn observer. Newly
      // inserted content can lay out again before its first resize delivery.
      anchor.top =
        anchor.turn.getBoundingClientRect().top -
        el.getBoundingClientRect().top + el.scrollTop;
    }
  }, [visibleTurnCount, pinTranscript, rememberScroll]);

  // Short turns can leave the first paint with empty space above them, and
  // the rest of the window arriving later would then push everything down.
  // Top up before painting until the viewport is covered.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || el.clientHeight === 0) return;
    if (visibleTurnCount >= Math.min(INITIAL_TURNS, turns.length)) return;
    if (el.scrollHeight > el.clientHeight) return;
    setVisibleTurnCount((count) =>
      Math.min(INITIAL_TURNS, count + FIRST_PAINT_TURNS),
    );
  }, [visibleTurnCount, turns.length]);

  useEffect(() => {
    // Interruptible, so switching away before it finishes costs nothing.
    startTransition(() =>
      setVisibleTurnCount((count) => Math.max(count, INITIAL_TURNS)),
    );
  }, []);

  const prepareToPrepend = useCallback((preserveAnchor = true) => {
    const el = scroller.current;
    if (el) prependHeight.current = el.scrollHeight;
    const turn = preserveAnchor ? el?.querySelector(".transcript-turn") : null;
    prependAnchor.current = turn ? { turn, top: null } : null;
    stickToBottom.current = false;
  }, []);

  const loadEarlier = () => {
    prepareToPrepend();
    setVisibleTurnCount((count) =>
      Math.min(turns.length, count + TURN_PAGE_SIZE),
    );
  };

  const revealBlock = useCallback(
    (blockId: string): boolean => {
      const all = turnsRef.current;
      const index = all.findIndex((turn) =>
        turn.some((block) => block.id === blockId),
      );
      if (index < 0) return false;
      // Even an already-rendered search/outline target replaces the position
      // retained by a preceding Load earlier click.
      prependAnchor.current = null;
      const needed = all.length - index;
      if (needed <= visibleTurnCountRef.current) return true;
      // Search and outline callers choose a new reading position themselves.
      prepareToPrepend(false);
      // Synchronous. The caller finds the turn in the DOM after this call.
      flushSync(() => setVisibleTurnCount(needed));
      return true;
    },
    [prepareToPrepend],
  );

  useEffect(() => {
    onRevealReady?.(revealBlock);
  }, [revealBlock, onRevealReady]);

  return {
    visibleTurnCount,
    firstVisibleTurn,
    visibleTurns,
    turnsRef,
    loadEarlier,
    revealBlock,
  };
}
