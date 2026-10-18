import { animate, type AnimationPlaybackControlsWithThen } from "motion/react";
import { msgTransition, immediateTransition, duration } from "../../../shared/motion/tokens";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
const PENDING_OPACITY = 0.5;
export type PromptSlide = {
  animations: AnimationPlaybackControlsWithThen[]; duration: number; easing: string;
  finished: Promise<void>; release: () => void; follow: (parts: HTMLElement[]) => boolean;
};
export function confirmPrompt(parts: (HTMLElement | null | undefined)[]) {
  for (const part of parts) if (part) animate([part], { opacity: [PENDING_OPACITY, 1] }, reducedMotionQuery().matches ? immediateTransition : msgTransition);
}
export function slidePromptIn(message: (HTMLElement | null | undefined)[], distance: number, earlier: HTMLElement[] = [], { settle = true }: { settle?: boolean } = {}): PromptSlide | undefined {
  const parts = message.filter((part): part is HTMLElement => !!part);
  if (!parts.length) return undefined;
  const dy = distance > 1 ? distance : 0;
  const transition = reducedMotionQuery().matches ? immediateTransition : msgTransition;
  const animations: AnimationPlaybackControlsWithThen[] = [];
  if (dy) for (const element of [...parts, ...earlier]) animations.push(animate([element], { y: [dy, 0] }, transition));
  if (settle) for (const part of parts) animations.push(animate([part], { opacity: [PENDING_OPACITY, 1] }, transition));
  if (!animations.length) return undefined;
  let released = false, landed = false;
  let resolve: () => void = () => {};
  const finished = new Promise<void>(done => { resolve = done; });
  const lead = animations[0];
  void lead.then(() => { landed = true; resolve(); });
  const release = () => { if (released) return; released = true; for (const animation of animations) animation.complete(); resolve(); };
  const follow = (next: HTMLElement[]) => {
    if (released || landed || !dy) return false;
    for (const element of next) {
      const playback = animate([element], { y: [dy, 0] }, transition);
      playback.time = lead.time;
      animations.push(playback);
    }
    return true;
  };
  return { animations, duration: duration.msg * 1000, easing: "cubic-bezier(0.22, 1, 0.36, 1)", finished, release, follow };
}
