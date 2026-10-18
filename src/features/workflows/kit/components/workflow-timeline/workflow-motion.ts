import { msgInitial, msgAnimate, msgExit, msgTransition, immediateTransition } from "../../../../../shared/motion/tokens";
import { reducedMotionQuery } from "../../../../../shared/lib/reducedMotion";
/** Shared entry props keep workflow content mounted and readable under reduced motion. */
export function workflowEntry(delayMs?: number) {
  const reduced = reducedMotionQuery().matches;
  return {
    initial: reduced ? false as const : msgInitial,
    animate: msgAnimate,
    exit: msgExit,
    transition: reduced ? immediateTransition : { ...msgTransition, delay: (delayMs ?? 0) / 1000 },
  };
}
export function workflowFade() {
  const reduced = reducedMotionQuery().matches;
  return {
    initial: reduced ? false as const : { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: reduced ? immediateTransition : msgTransition,
  };
}

export function workflowFold(folded: boolean) {
  return {
    initial: false as const,
    animate: { opacity: folded ? 0 : 1, visibility: "visible" as const },
    transitionEnd: { visibility: folded ? "hidden" as const : "visible" as const },
    transition: reducedMotionQuery().matches ? immediateTransition : msgTransition,
  };
}
