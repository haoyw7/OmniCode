import { reducedMotionQuery } from "./reducedMotion";
export type AnimationVisibility = {
  visible: boolean;
  reducedMotion: boolean;
};

/** Pause decorative animation when its surface leaves the viewport or window. */
export function observeAnimationVisibility(
  element: Element,
  change: (activity: AnimationVisibility) => void,
) {
  let intersecting = true;
  const media = reducedMotionQuery();
  const publish = () =>
    change({
      visible: intersecting && !document.hidden,
      reducedMotion: media?.matches ?? false,
    });
  const observer =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver((entries) => {
          const entry = entries.find((entry) => entry.target === element);
          if (!entry) return;
          intersecting = entry.isIntersecting;
          publish();
        });
  observer?.observe(element);
  document.addEventListener("visibilitychange", publish);
  media?.addEventListener?.("change", publish);
  publish();
  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", publish);
    media?.removeEventListener?.("change", publish);
  };
}
