import { animate, useMotionValue, useTransform } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

// Only a turn sent moments ago celebrates; reopening an old thread stays calm.
const FRESH_MS = 4000;

// Remounts (tab switches, transcript windowing) must not replay a burst.
const celebrated = new Set<string>();

export function shouldCelebrateTurn(
  blockId: string,
  startedAt: number | undefined,
  now: number,
): boolean {
  if (startedAt == null || celebrated.has(blockId)) return false;
  const age = now - startedAt;
  return age >= 0 && age < FRESH_MS;
}

/** Whether a freshly sent turn's one-shot burst should be on screen now. */
export function useTurnCelebration(
  blockId: string,
  startedAt: number | undefined,
) {
  const [fresh] = useState(() =>
    shouldCelebrateTurn(blockId, startedAt, Date.now()),
  );
  const [done, setDone] = useState(false);
  const progress = useMotionValue(0);
  const opacity = useTransform(progress, [0, 0.5, 1], [0, 1, 0]);
  const y = useTransform(progress, [0, 1], ["0%", "-100%"]);

  useEffect(() => {
    if (!fresh) return;
    celebrated.add(blockId);
    const animation = animate(progress, 1, { ...(reducedMotionQuery().matches ? immediateTransition : panelTransition), onComplete: () => setDone(true) });
    return () => animation.stop();
  }, [blockId, fresh, progress]);

  return { active: fresh && !done, opacity, y };
}

export type CelebrationBox = { width: number; height: number };

/** The bubble's size, read before paint so a burst can lay itself out. */
export function useCelebrationBox(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): CelebrationBox | null {
  const [box, setBox] = useState<CelebrationBox | null>(null);

  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setBox({ width, height });
  }, [active, ref]);

  return box;
}
