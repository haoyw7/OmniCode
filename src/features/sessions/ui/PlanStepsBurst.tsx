import { motion } from "motion/react";
import { panelTransition } from "../../../shared/motion/tokens";
import { useMemo, useRef, type CSSProperties } from "react";
import { useCelebrationBox, useTurnCelebration } from "./turnCelebration";

const EMBER_COUNT = 6;
const CHECK_PATH = "M3.2 6.3 5.1 8.2 8.8 4.2";

/** Roomy bubbles get more steps; a one-word prompt still gets a short plan. */
export function planStepCount(width: number): number {
  return Math.max(2, Math.min(6, Math.floor(width / 64)));
}

function stepX(index: number, count: number): number {
  return ((index + 0.5) / count) * 100;
}

function makeEmbers() {
  return Array.from({ length: EMBER_COUNT }, (_, i) => ({
    x: Math.min(95, Math.max(5, ((i + Math.random()) / EMBER_COUNT) * 100)),
    size: 2.5 + Math.random() * 2,
    drift: (Math.random() - 0.5) * 20,
  }));
}

/** Numbered plan marks tick off as they float up and out of a fresh turn. */
export function PlanStepsBurst({
  blockId,
  startedAt,
}: {
  blockId: string;
  startedAt?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { active, opacity, y } = useTurnCelebration(blockId, startedAt);
  const box = useCelebrationBox(ref, active);
  const count = box ? planStepCount(box.width) : 0;
  // Parent re-renders mid-burst must not reshuffle the embers.
  const embers = useMemo(makeEmbers, []);

  if (!active) return null;
  return (
    <motion.span aria-hidden ref={ref} className="plan-steps" style={{ opacity, y }}>
      {box ? (
        <>
          {Array.from({ length: count }, (_, index) => (
            <motion.span
              key={index} initial={false} animate={{ y: ["0%", "-100%"] }} transition={panelTransition}
              className="plan-step"
              style={
                {
                  "--x": `${stepX(index, count)}%`,
                  "--drift": `${index % 2 === 0 ? -8 : 8}px`,
                } as CSSProperties
              }
            >
              <span className="plan-step-dot">
                <span className="plan-step-number">{index + 1}</span>
                <svg viewBox="0 0 12 12" className="plan-step-check">
                  <path d={CHECK_PATH} />
                </svg>
              </span>
            </motion.span>
          ))}
          {embers.map((ember, index) => (
            <motion.span
              key={`ember-${index}`} initial={false} animate={{ y: ["0%", "-100%"], x: [0, ember.drift] }} transition={panelTransition}
              className="plan-step-ember"
              style={
                {
                  "--x": `${ember.x}%`,
                  "--size": `${ember.size}px`,
                  "--drift": `${ember.drift}px`,
                } as CSSProperties
              }
            >
              <span className="plan-step-ember-glyph" />
            </motion.span>
          ))}
        </>
      ) : null}
    </motion.span>
  );
}
