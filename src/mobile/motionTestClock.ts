import { frameData, frameSteps, time, supportsBrowserAnimation } from "motion-dom";
import { MotionGlobalConfig } from "motion-utils";
import { act } from "react";
import { vi } from "vitest";

const nativeAnimate = typeof Element === "undefined" ? undefined : Object.getOwnPropertyDescriptor(Element.prototype, "animate");

/** Drive the animation library's scheduler, which captures rAF at module load. */
export function startMotionClock() {
  // happy-dom has a WAAPI surface but does not advance it with the Motion clock.
  Reflect.deleteProperty(Element.prototype, "animate");
  const probe = { name: "opacity", motionValue: { owner: { current: document.createElement("div"), getProps: () => ({}) } } };
  supportsBrowserAnimation(probe as Parameters<typeof supportsBrowserAnimation>[0]);
  // AutoAnimate keeps its real WAAPI interface; only Motion caches the JS fallback.
  if (nativeAnimate) Object.defineProperty(Element.prototype, "animate", nativeAnimate);
  MotionGlobalConfig.useManualTiming = true;
  frameData.timestamp = performance.now();
  time.set(frameData.timestamp);
}
export function motionFrame(elapsed = 16) {
  frameData.delta = elapsed;
  frameData.timestamp += elapsed;
  frameData.isProcessing = true;
  time.set(frameData.timestamp);
  for (const step of ["setup", "read", "resolveKeyframes", "preUpdate", "update", "preRender", "render", "postRender"] as const)
    frameSteps[step].process(frameData);
  frameData.isProcessing = false;
}
export function stopMotionClock() {
  if (nativeAnimate) Object.defineProperty(Element.prototype, "animate", nativeAnimate);
  MotionGlobalConfig.useManualTiming = false;
  time.set(performance.now());
}

/** Advance business timers and the real Motion scheduler in the same order. */
export async function advanceMotionTimers(milliseconds: number) {
  await act(async () => {
    const step = Math.max(16, Math.ceil(milliseconds / 120));
    let remaining = milliseconds;
    do {
      const elapsed = Math.min(step, remaining);
      if (vi.isFakeTimers()) vi.advanceTimersByTime(elapsed);
      motionFrame(elapsed);
      (globalThis as typeof globalThis & {
        __advanceTestWebAnimations?: (elapsed: number) => void;
      }).__advanceTestWebAnimations?.(elapsed);
      for (let microtask = 0; microtask < 4; microtask++) await Promise.resolve();
      remaining -= elapsed;
    } while (remaining > 0);
  });
}
