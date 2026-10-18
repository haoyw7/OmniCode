import { frameData, frameSteps, time, supportsBrowserAnimation } from "motion-dom";
import { MotionGlobalConfig } from "motion-utils";

const nativeAnimate = typeof Element === "undefined" ? undefined : Object.getOwnPropertyDescriptor(Element.prototype, "animate");

/** Drive the animation library's scheduler, which captures rAF at module load. */
export function startMotionClock() {
  // happy-dom has a WAAPI surface but does not advance it with the Motion clock.
  Reflect.deleteProperty(Element.prototype, "animate");
  const probe = { name: "opacity", motionValue: { owner: { current: document.createElement("div"), getProps: () => ({}) } } };
  supportsBrowserAnimation(probe as Parameters<typeof supportsBrowserAnimation>[0]);
  // AutoAnimate keeps WAAPI available while Motion uses the manually driven fallback.
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

/** Flush Motion animation frames plus its completion microtasks. */
export async function finishMotion(frames = 40) {
  for (let frame = 0; frame < frames; frame++) {
    motionFrame();
    for (let task = 0; task < 4; task++) await Promise.resolve();
  }
}
