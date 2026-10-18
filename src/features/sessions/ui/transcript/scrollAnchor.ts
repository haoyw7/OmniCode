import { animate, motionValue, type AnimationPlaybackControlsWithThen } from "motion/react";
import { msgTransition, springs } from "../../../../shared/motion/tokens";
import { syncLiveFooterClip } from "../liveFooterClip";
import { reducedMotionQuery } from "../../../../shared/lib/reducedMotion";
import { type Block } from "../../model/session";
import { slidePromptIn, type PromptSlide } from "../promptLaunch";



export function turnUserBlock(blocks: Block[], managed = false): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user" && (managed || !block.internal)) return block;
  }
  return undefined;
}

// Keep in sync with the prompt-turn-reveal animation in index.css.


export type PriorTurn = { element: HTMLElement; top: number };

export function measureLastTurn(scroller: HTMLElement | null): PriorTurn | undefined {
  const turns = scroller?.querySelectorAll<HTMLElement>(".transcript-turn");
  const element = turns?.[turns.length - 1];
  return element ? { element, top: element.getBoundingClientRect().top } : undefined;
}

export type PromptRise = {
  stop: () => void;
  /** Hands the motion to the recorded copy of a sending prompt. */
  follow: (blockId: string) => boolean;
};

export function promptRow(scroller: HTMLElement | null, blockId: string) {
  return scroller?.querySelector<HTMLElement>(
    `[data-prompt-anchor="${CSS.escape(blockId)}"]`,
  ) ?? null;
}

export function promptParts(row: HTMLElement | null) {
  return [
    row?.querySelector<HTMLElement>(".user-message-bubble:not([hidden])"),
    row?.querySelector<HTMLElement>(".user-message-media"),
  ];
}

/** Scrolls the sent prompt into its final row with the turns above it. */
export function riseIntoAnchor(
  scroller: HTMLElement | null,
  blockId: string,
  prior?: PriorTurn,
): PromptRise | undefined {
  let row = promptRow(scroller, blockId);
  if (!scroller || !row) return;
  if (reducedMotionQuery().matches) return;
  let turn = row.closest<HTMLElement>(".transcript-turn");
  let stopped = false;
  let started = false;
  let revealMotion: AnimationPlaybackControlsWithThen | undefined;
  let slide: PromptSlide | undefined;
  const reveal = () => {
    if (stopped) return;
    const revealing = turn;
    revealing?.setAttribute("data-prompt-rise", "revealing");
    if (revealing) revealMotion = animate([revealing], { opacity: [0, 1] }, { ...msgTransition, onComplete: () => revealing.removeAttribute("data-prompt-rise") });
  };
  const start = () => {
    if (stopped) return;
    started = true;
    row!.style.removeProperty("visibility");
    slide = scrollIntoAnchor(scroller, row!, turn, prior);
    if (!slide) {
      turn?.removeAttribute("data-prompt-rise");
      return;
    }
    void slide.finished.then(reveal);
  };
  // Let the sibling dock publish its cleared draft height before measuring.
  row.style.visibility = "hidden";
  row.dataset.promptMotion = "smooth";
  turn?.setAttribute("data-prompt-rise", "rising");
  queueMicrotask(start);
  return {
    stop: () => {
      stopped = true;
      slide?.release();
      revealMotion?.stop();
      row?.style.removeProperty("visibility");
      turn?.removeAttribute("data-prompt-rise");
    },
    follow: (nextId) => {
      const next = promptRow(scroller, nextId);
      if (stopped || !next) return false;
      if (started && !slide?.follow(
        promptParts(next).filter((part): part is HTMLElement => !!part),
      ))
        return false;
      row = next;
      row.dataset.promptMotion = "smooth";
      turn = next.closest<HTMLElement>(".transcript-turn");
      if (!started) row.style.visibility = "hidden";
      turn?.setAttribute("data-prompt-rise", "rising");
      return true;
    },
  };
}

/**
 * Moves the sent prompt and the turns above it as one scroll. The prompt
 * starts where it would have followed the previous turn, or just above the
 * dock when there was none to follow.
 */
function scrollIntoAnchor(
  scroller: HTMLElement,
  row: HTMLElement,
  turn: HTMLElement | null,
  prior: PriorTurn | undefined,
): PromptSlide | undefined {
  const [bubble, media] = promptParts(row);
  const moving = bubble ?? media;
  if (!moving) return undefined;
  const view = scroller.getBoundingClientRect();
  const dock = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
  const shift = prior?.element.isConnected && prior.element !== turn
    ? prior.top - prior.element.getBoundingClientRect().top
    : 0;
  const earlier: HTMLElement[] = [];
  if (prior && shift > 1 && prior.top < view.bottom) {
    for (
      let element: Element | null = prior.element, count = 0;
      element instanceof HTMLElement &&
      element.classList.contains("transcript-turn") &&
      count < 4;
      element = element.previousElementSibling, count++
    ) {
      // Turns that stay above the viewport for the whole glide need no motion.
      if (element.getBoundingClientRect().bottom + shift < view.top) break;
      earlier.push(element);
    }
  }
  const distance = shift > 1
    ? shift
    : view.bottom - dock - 8 - moving.getBoundingClientRect().bottom;
  // A sending copy keeps its pending tint until the Host records it.
  return slidePromptIn([bubble, media], distance, earlier, {
    settle: !row.hasAttribute("data-sending"),
  });
}

/** Measure content rather than the anchored turn's blank space or padding. */
export function isTranscriptEndVisible(
  el: HTMLElement,
  end: HTMLElement | null,
): boolean {
  if (!end) return true;
  const style = getComputedStyle(el);
  const top = el.getBoundingClientRect().top + el.clientTop;
  const endTop = end.getBoundingClientRect().top;
  return (
    endTop >= top + (parseFloat(style.scrollPaddingTop) || 0) &&
    endTop <=
      top + el.clientHeight - (parseFloat(style.scrollPaddingBottom) || 0)
  );
}

export function pinToBottom(el: HTMLElement | null) {
  // An animated jump retargets every frame; snapping would cut it short.
  if (!el || jumpingScrollers.has(el)) return;
  el.scrollTop = el.scrollHeight;
}

export const jumpingScrollers = new WeakMap<HTMLElement, (snap: boolean) => void>();
const JUMP_INTERRUPTS = ["wheel", "touchstart", "pointerdown", "keydown"];

/**
 * Glide to the bottom, following content that keeps streaming in. Any reader
 * input stops the glide where it is.
 */
type GlideTiming = { follow?: boolean };
const JUMP_GLIDE: GlideTiming = {};
export const FOLLOW_GLIDE: GlideTiming = { follow: true };
export function animateToBottom(el: HTMLElement | null, done: () => void, _timing: GlideTiming = JUMP_GLIDE) {
  if (!el || jumpingScrollers.has(el)) return;
  const bottom = () => Math.max(0, el.scrollHeight - el.clientHeight);
  if (bottom() - el.scrollTop <= 1 || reducedMotionQuery().matches) { el.scrollTop = el.scrollHeight; done(); return; }
  const position = motionValue(el.scrollTop);
  let playback: AnimationPlaybackControlsWithThen | undefined;
  let ended = false;
  const sync = position.on("change", value => { el.scrollTop = value; syncLiveFooterClip(el); });
  const finish = (snap: boolean) => {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(observeFrame);
    playback?.stop();
    sync(); position.destroy(); observer.disconnect(); mutations.disconnect();
    jumpingScrollers.delete(el);
    for (const type of JUMP_INTERRUPTS) el.removeEventListener(type, interrupt);
    if (snap) el.scrollTop = el.scrollHeight;
    done();
  };
  const interrupt = () => finish(false);
  let target = bottom();
  const track = () => {
    if (ended) return;
    if (!el.isConnected) return finish(false);
    if (reducedMotionQuery().matches) return finish(true);
    const next = bottom();
    if (playback && next === target) return;
    target = next;
    playback?.stop();
    playback = animate(position, target, { ...springs.sheet, onComplete: () => { if (target === bottom()) finish(true); else { playback = undefined; track(); } } });
  };
  const observer = new ResizeObserver(track);
  // A glide can start inside the transcript's resize notification. Register
  // its observers on the next frame: observing an ancestor during delivery
  // makes WebKit report an undelivered ResizeObserver notification.
  const observeFrame = requestAnimationFrame(() => {
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    track();
  });
  const mutations = new MutationObserver(track);
  mutations.observe(el, { subtree: true, childList: true, characterData: true });
  jumpingScrollers.set(el, finish);
  for (const type of JUMP_INTERRUPTS) el.addEventListener(type, interrupt, { passive: true });
  track();
}

const stretchedTurns = new WeakMap<HTMLElement, HTMLElement>();

/**
 * Stretch the live turn within the space below any floating controls. The
 * height goes on the anchored turn itself: a custom property on the scroller
 * would be inherited by every node of the transcript, and changing it
 * restyled all of them on each resize (over 100ms for a long chat).
 */
export function syncTranscriptViewport(el: HTMLElement | null) {
  if (!el || el.clientHeight <= 0) return;
  const anchor = el.querySelector<HTMLElement>(".transcript-turn-anchor");
  const previous = stretchedTurns.get(el);
  if (previous && previous !== anchor) previous.style.removeProperty("min-height");
  if (!anchor) {
    stretchedTurns.delete(el);
    return;
  }
  stretchedTurns.set(el, anchor);
  const inner = el.firstElementChild as HTMLElement | null;
  const pad = inner
    ? Number.parseFloat(getComputedStyle(inner).paddingBottom) || 0
    : 0;
  // pinToBottom uses scrollTop directly, so CSS scroll-padding cannot offset
  // it. Shortening the anchored turn leaves the requested inset above it.
  // The scroller's own bottom padding (a floating composer) also sits below
  // the turn when pinned, so it comes out of the turn's height too.
  const style = getComputedStyle(el);
  const topInset = Number.parseFloat(style.scrollPaddingTop) || 0;
  const bottomInset = Number.parseFloat(style.paddingBottom) || 0;
  const next = `${Math.max(0, el.clientHeight - pad - topInset - bottomInset)}px`;
  if (anchor.style.minHeight === next) return;
  anchor.style.minHeight = next;
}
