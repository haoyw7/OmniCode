import { afterEach } from "vitest";

const webAnimations = new Map<Animation, number>();
const testClock = globalThis as typeof globalThis & {
  __advanceTestWebAnimations?: (elapsed: number) => void;
};
testClock.__advanceTestWebAnimations = (elapsed) => {
  for (const [animation, remaining] of webAnimations) {
    if (animation.playState === "finished" || animation.playState === "idle") {
      webAnimations.delete(animation);
    } else if (remaining <= elapsed) {
      webAnimations.delete(animation);
      animation.finish();
    } else {
      webAnimations.set(animation, remaining - elapsed);
    }
  }
};
afterEach(() => webAnimations.clear());

// happy-dom rejects Animation.finished on cancellation without the browser's
// native rejection handling. Consume that rejection as animations are created;
// preserve the real animation object, timing and all completion callbacks.
if (typeof Element !== "undefined" && Element.prototype.animate) {
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args: Parameters<Element["animate"]>) {
    const animation = animate.apply(this, args);
    void animation.finished.catch(() => {});
    const options = args[1];
    const duration = typeof options === "number" ? options : options?.duration;
    const delay = typeof options === "number" ? 0 : options?.delay ?? 0;
    const iterations = typeof options === "number" ? 1 : options?.iterations ?? 1;
    if (typeof duration === "number" && Number.isFinite(duration * iterations))
      webAnimations.set(animation, delay + duration * iterations);
    return animation;
  };
}
