import { useCallback, useRef } from "react";
import { observeAnimationVisibility } from "../lib/animationVisibility";
import { useSurfaceVisibility } from "../ui/SurfaceVisibility";

/** A callback ref for decorative loops, including loops driven by JS timers.
 * Keep `change` stable; detaching the ref stops the old element's activity.
 */
export function useAnimationActivity<T extends Element>(
  change: (element: T, active: boolean) => void,
  reset?: (element: T) => void,
) {
  const surfaceVisible = useSurfaceVisibility();
  const stop = useRef<(() => void) | null>(null);
  return useCallback(
    (element: T | null) => {
      stop.current?.();
      stop.current = null;
      if (!element) return;
      const unobserve = surfaceVisible
        ? observeAnimationVisibility(element, ({ visible, reducedMotion }) => {
            change(element, visible && !reducedMotion);
          })
        : undefined;
      if (!surfaceVisible) change(element, false);
      stop.current = () => {
        unobserve?.();
        change(element, false);
        reset?.(element);
      };
    },
    [change, reset, surfaceVisible],
  );
}
