import { useCallback, useLayoutEffect, useRef } from "react";
import { animate } from "motion/react";
import { panelTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";

// A submit only counts as the launch if the composer docks shortly after it.
const LAUNCH_WINDOW_MS = 1500;

function reducedMotion() {
  return reducedMotionQuery().matches;
}

/**
 * Slides the composer from the centered empty-session slot down to the dock
 * when the first message is sent, instead of letting it jump there.
 */
export function useComposerDockMotion(docked: boolean) {
  const centeredRef = useRef<HTMLDivElement>(null);
  const dockedRef = useRef<HTMLDivElement>(null);
  const launch = useRef<{ top: number; centerX: number; at: number } | null>(
    null,
  );

  const captureLaunch = useCallback(() => {
    const rect = centeredRef.current?.getBoundingClientRect();
    launch.current = rect
      ? {
          top: rect.top,
          centerX: rect.left + rect.width / 2,
          at: performance.now(),
        }
      : null;
  }, []);

  useLayoutEffect(() => {
    if (!docked) return;
    const from = launch.current;
    launch.current = null;
    const element = dockedRef.current;
    if (!from || !element || reducedMotion()) return;
    if (performance.now() - from.at > LAUNCH_WINDOW_MS) return;
    const to = element.getBoundingClientRect();
    // Align centers so the composer drops straight down.
    const dx = from.centerX - (to.left + to.width / 2);
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const animation = animate([element], { x: [dx, 0], y: [dy, 0] }, panelTransition);
    return () => animation.stop();
  }, [docked]);

  return { centeredRef, dockedRef, captureLaunch };
}
