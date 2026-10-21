import { motion } from "motion/react";
import { Sparkles } from "../../../shared/ui/icons";
import { panelTransition } from "../../../shared/motion/tokens";
import { useState, type CSSProperties } from "react";
import { useTurnCelebration } from "./turnCelebration";

const SPARKLE_COUNT = 18;

type Sparkle = {
  star: boolean;
  x: number;
  size: number;
  drift: number;
  spin: number;
};

function makeSparkles(): Sparkle[] {
  return Array.from({ length: SPARKLE_COUNT }, (_, i) => {
    const star = i % 3 !== 2;
    return {
      star,
      // Spread evenly across the bubble with some jitter so it never reads as a grid.
      x: Math.min(96, Math.max(4, ((i + Math.random()) / SPARKLE_COUNT) * 100)),
      size: star ? 7 + Math.random() * 6 : 2.5 + Math.random() * 2,
      drift: (Math.random() - 0.5) * 28,
      spin: (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 120),
    };
  }).sort(() => Math.random() - 0.5);
}

/** A one-shot burst of rising sparkles inside a freshly sent /operator bubble. */
export function OmniCodeSparkles({
  blockId,
  startedAt,
}: {
  blockId: string;
  startedAt?: number;
}) {
  const { active, opacity, y } = useTurnCelebration(blockId, startedAt);
  const [sparkles] = useState(makeSparkles);

  if (!active) return null;
  return (
    <motion.span aria-hidden className="omnicode-sparkles" style={{ opacity, y }}>
      {sparkles.map((sparkle, index) => (
        <motion.span
          key={index} initial={false} animate={{ y: ["0%", "-100%"], x: [0, sparkle.drift], rotate: [0, sparkle.spin] }} transition={panelTransition}
          className="omnicode-sparkle"
          style={
            {
              "--x": `${sparkle.x}%`,
              "--size": `${sparkle.size}px`,
              "--drift": `${sparkle.drift}px`,
              "--spin": `${sparkle.spin}deg`,
            } as CSSProperties
          }
        >
          {sparkle.star ? (
            <Sparkles className="omnicode-sparkle-glyph" />
          ) : (
            <span className="omnicode-sparkle-glyph omnicode-sparkle-ember" />
          )}
        </motion.span>
      ))}
    </motion.span>
  );
}
