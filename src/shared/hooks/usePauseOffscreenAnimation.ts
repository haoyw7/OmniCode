import { useAnimationActivity } from "./useAnimationActivity";

const PAUSED = "data-animation-paused";

function updateActivity(element: Element, active: boolean) {
  element.toggleAttribute(PAUSED, !active);
}

function resetActivity(element: Element) {
  element.removeAttribute(PAUSED);
}

/**
 * Pauses an element's looping CSS animations (see `[data-animation-paused]`
 * in index.css) while it is scrolled out of view, its surface/window is hidden,
 * or reduced motion is enabled.
 * WebKit keeps restyling and repainting a running loop even off screen; a
 * small spinner above the fold cost several percent of a core. Paused loops
 * resume from where they stopped instead of replaying missed frames.
 */
export function usePauseOffscreenAnimation<T extends Element>() {
  return useAnimationActivity<T>(updateActivity, resetActivity);
}
