import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { duration, immediateTransition, motionGeometry, msgTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import "./RollingClock.css";

export const CLOCK_MOTIONS = ["slide", "roll", "fade", "cascade"] as const;
export type ClockMotion = typeof CLOCK_MOTIONS[number];

/** Pick once per clock origin, independently of the ticking value or status copy. */
export function rollingClockMotion(seed: string, startedAt: number): ClockMotion {
  const text = `${seed}:${startedAt}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return CLOCK_MOTIONS[(hash >>> 0) % CLOCK_MOTIONS.length];
}

/** Changed digits move up in one of several styles; units stay still. */
export function RollingClock({ value, motion: clockMotion = "slide" }: { value: string; motion?: ClockMotion }) {
  const reduced = useMotionPreference();
  const groups = [...value.matchAll(/(\d+)([^\d]*)/g)];
  return (
    <span className="rolling-clock" data-motion={clockMotion} role="timer" aria-label={value} aria-live="off" dir="ltr">
      <span className="rolling-clock-face" aria-hidden="true">
        {groups.map((group) => (
          <span className="rolling-clock-group" key={group[2].trim()}>
            {[...group[1]].map((digit, index) => (
              <RollingDigit
                key={group[1].length - index}
                value={digit}
                reduced={reduced}
                clockMotion={clockMotion}
                delay={clockMotion === "cascade" ? (group[1].length - index - 1) * duration.msg : 0}
              />
            ))}
            <span className="rolling-clock-unit">{group[2]}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

function RollingDigit({ value, reduced, delay, clockMotion }: { value: string; reduced: boolean; delay: number; clockMotion: ClockMotion }) {
  const fade = clockMotion === "fade";
  if (reduced) return <span className="rolling-clock-digit"><span className="rolling-clock-current">{value}</span></span>;
  return (
    <span className="rolling-clock-digit">
      <AnimatePresence initial={false}>
        <ClockGlyph key={value} value={value} reduced={reduced} fade={fade} delay={delay} />
      </AnimatePresence>
    </span>
  );
}

function ClockGlyph({ value, reduced, fade, delay }: { value: string; reduced: boolean; fade: boolean; delay: number }) {
  const present = useIsPresent();
  return <motion.span className={present ? "rolling-clock-current" : "rolling-clock-glyph"} data-glyph={value} data-exiting={!present || undefined}
    initial={reduced ? false : { y: fade ? 0 : `${motionGeometry.clockPercent}%`, opacity: fade ? 0 : 1 }}
    animate={{ y: 0, opacity: 1 }}
    exit={{ y: reduced || fade ? 0 : `-${motionGeometry.clockPercent}%`, opacity: reduced || fade ? 0 : 1 }}
    transition={reduced ? immediateTransition : { ...msgTransition, delay }}
  >{present ? value : null}</motion.span>;
}
