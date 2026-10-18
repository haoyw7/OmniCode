import { type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionPreference } from "../shared/motion/useMotionPreference";
import { immediateTransition, motionDistance, popTransition } from "../shared/motion/tokens";

/** Only a changed control state animates; progress updates retain its subtree. */
export function MobileSwap({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  const reduced = useMotionPreference();
  return <span className="mobile-swap">
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={swapKey} className="mobile-swap-item"
        initial={reduced ? false : { opacity: 0, y: motionDistance.pop }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? immediateTransition : popTransition}>
        {children}
      </motion.span>
    </AnimatePresence>
  </span>;
}
