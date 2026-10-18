/**
 * Reduced-motion preference that honours Settings → Appearance → Reduce
 * motion. `system` follows the OS; `on`/`off` override it. CSS gets the same
 * override from the `data-reduced-motion` root attribute (see
 * `scripts/postcss-font-scale.mjs`).
 */
export type ReducedMotionPreference = "system" | "on" | "off";

export const REDUCED_MOTION_CHANGE_EVENT = "monocode:reducedmotionchange";

const QUERY = "(prefers-reduced-motion: reduce)";

/** The subset of `MediaQueryList` the app's motion code relies on. */
export interface ReducedMotionQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

export function reducedMotionOverride(): ReducedMotionPreference {
  if (typeof document === "undefined") return "system";
  const value = document.documentElement?.dataset?.reducedMotion;
  return value === "on" || value === "off" ? value : "system";
}

/** Drop-in for `matchMedia("(prefers-reduced-motion: reduce)")`. */
export function reducedMotionQuery(): ReducedMotionQuery {
  const media =
    typeof window === "undefined" ? undefined : window.matchMedia?.(QUERY);
  return {
    get matches() {
      const override = reducedMotionOverride();
      if (override !== "system") return override === "on";
      return media?.matches ?? false;
    },
    addEventListener(_type, listener) {
      media?.addEventListener?.("change", listener);
      if (typeof window !== "undefined")
        window.addEventListener(REDUCED_MOTION_CHANGE_EVENT, listener);
    },
    removeEventListener(_type, listener) {
      media?.removeEventListener?.("change", listener);
      if (typeof window !== "undefined")
        window.removeEventListener(REDUCED_MOTION_CHANGE_EVENT, listener);
    },
  };
}

export function prefersReducedMotion(): boolean {
  return reducedMotionQuery().matches;
}

export function applyReducedMotion(value: ReducedMotionPreference) {
  const root = document.documentElement;
  if (value === "system") delete root.dataset.reducedMotion;
  else root.dataset.reducedMotion = value;
  window.dispatchEvent(new Event(REDUCED_MOTION_CHANGE_EVENT));
}
