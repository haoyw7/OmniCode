import { AnimatePresence, motion } from "motion/react";
import { immediateTransition, msgTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";

/** Title changes crossfade without running a separate canvas animation loop. */
export function ParticleText({ text, className = "" }: { text: string; className?: string }) {
  const reduced = useMotionPreference();
  return (
    <span className="relative flex min-w-0 flex-1">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={text}
          className={`min-w-0 flex-1 ${className}`.trim()}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? immediateTransition : msgTransition}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
