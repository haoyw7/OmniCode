import autoAnimate, {
  getTransitionSizes,
  type AnimationController,
  type AutoAnimationPlugin,
} from "@formkit/auto-animate";
import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from "react";
import { autoAnimateOptions } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";

type Coordinates = { top: number; left: number; width: number; height: number };

export const ListReorderMotionContext = createContext(true);

/**
 * AutoAnimate's default keyframes, except that a row which was hidden
 * (`display: none`, so its old box sits at the origin) is not slid in from
 * there: its own disclosure opens it in place.
 */
const listMotion = ((
  el: Element,
  action: "add" | "remove" | "remain",
  // AutoAnimate passes the old box second and the new box third for "remain".
  first?: Coordinates,
  second?: Coordinates,
) => {
  const { duration, easing } = autoAnimateOptions;
  if (action === "add") {
    return new KeyframeEffect(el, [
      { transform: "scale(.98)", opacity: 0 },
      { transform: "scale(0.98)", opacity: 0, offset: 0.5 },
      { transform: "scale(1)", opacity: 1 },
    ], { duration: duration * 1.5, easing: "ease-in" });
  }
  if (action === "remove") {
    return new KeyframeEffect(el, [
      { transform: "scale(1)", opacity: 1 },
      { transform: "scale(.98)", opacity: 0 },
    ], { duration, easing: "ease-out" });
  }
  const oldCoords = first!;
  const newCoords = second!;
  if (!oldCoords.width && !oldCoords.height) return new KeyframeEffect(el, [], { duration: 0 });
  let deltaLeft = oldCoords.left - newCoords.left;
  let deltaTop = oldCoords.top - newCoords.top;
  // An edge that did not move means the element is anchored there.
  if (oldCoords.top + oldCoords.height === newCoords.top + newCoords.height) deltaTop = 0;
  if (oldCoords.left + oldCoords.width === newCoords.left + newCoords.width) deltaLeft = 0;
  const [widthFrom, widthTo, heightFrom, heightTo] = getTransitionSizes(el, oldCoords, newCoords);
  const start: Keyframe = { transform: `translate(${deltaLeft}px, ${deltaTop}px)` };
  const end: Keyframe = { transform: "translate(0, 0)" };
  if (widthFrom !== widthTo) {
    start.width = `${widthFrom}px`;
    end.width = `${widthTo}px`;
  }
  if (heightFrom !== heightTo) {
    start.height = `${heightFrom}px`;
    end.height = `${heightTo}px`;
  }
  return new KeyframeEffect(el, [start, end], { duration, easing });
}) as AutoAnimationPlugin;

function destroyController(controller: AnimationController) {
  // A cancelled Web Animation rejects `finished`; consume it before disposal.
  for (const animation of controller.parent.getAnimations?.({ subtree: true }) ?? []) {
    void animation.finished.catch(() => {});
  }
  if (controller.destroy) controller.destroy();
  else controller.disable();
}

/**
 * Animate list insertions, removals and sorting, including nested row groups.
 * A changed `revealKey` skips that commit: rows revealed by their own
 * disclosure would otherwise replay from stale hidden coordinates while
 * AutoAnimate pins the list height.
 * `enabled` removes observers entirely for lists without animated content;
 * `animate` temporarily pauses an observed list during a direct gesture.
 */
export function useListReorderMotion(
  root: RefObject<HTMLElement | null>,
  order: readonly string[],
  attribute: string,
  animate = true,
  revealKey?: string | number,
  enabled = true,
) {
  const controllers = useRef(new Map<HTMLElement, AnimationController>());
  const settled = useContext(ListReorderMotionContext);
  const reduced = useMotionPreference();
  const key = order.join("\0");
  const revealed = useRef(revealKey);
  useLayoutEffect(() => {
    if (!settled || !enabled) {
      for (const controller of controllers.current.values()) destroyController(controller);
      controllers.current.clear();
      return;
    }
    const element = root.current;
    if (!element) return;
    const parents = new Set<HTMLElement>([element]);
    for (const row of element.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      if (row.parentElement) parents.add(row.parentElement);
    }
    for (const [parent, controller] of controllers.current) {
      if (!parents.has(parent)) {
        destroyController(controller);
        controllers.current.delete(parent);
      }
    }
    const revealing = revealed.current !== revealKey;
    revealed.current = revealKey;
    const resume: AnimationController[] = [];
    for (const parent of parents) {
      let controller = controllers.current.get(parent);
      if (!controller) {
        // AutoAnimate skips observer setup when the OS currently reduces motion.
        // Wait to create it until animation is allowed so a later policy change
        // can enable a real controller rather than a permanently inert one.
        if (reduced) continue;
        controller = autoAnimate(parent, listMotion);
        controllers.current.set(parent, controller);
      }
      if (animate && !reduced) {
        if (revealing) controller.disable();
        if (!controller.isEnabled()) resume.push(controller);
      }
      else controller.disable();
    }
    // A drag can clear its active flag and commit the new DOM order together.
    // Keep AutoAnimate disabled until its MutationObserver has recorded that
    // order, otherwise it replays the move that the drag already animated.
    if (!resume.length) return;
    const frame = requestAnimationFrame(() => {
      for (const controller of resume) controller.enable();
    });
    return () => cancelAnimationFrame(frame);
  }, [root, key, attribute, animate, reduced, revealKey, settled, enabled]);
  useLayoutEffect(() => () => {
    for (const controller of controllers.current.values()) destroyController(controller);
    controllers.current.clear();
  }, []);
}
