import { motion } from "motion/react";
import { useLayoutEffect, type ReactNode } from "react";
import { panelTransition, immediateTransition } from "../../shared/motion/tokens";
import { useMotionPreference } from "../../shared/motion/useMotionPreference";

type Props = { phase: "opening" | "closing"; width?: number; onFinish: () => void; children: ReactNode };
export function TabWidthMotion({ phase, width = 0, onFinish, children }: Props) {
  const reduced = useMotionPreference();
  useLayoutEffect(() => { if (reduced) onFinish(); }, [reduced, onFinish]);
  const targetWidth = width > 1 ? width : "14rem";
  return <motion.div
    initial={phase === "opening" ? { width: 0, opacity: 0 } : { width: targetWidth, opacity: 1 }}
    animate={phase === "closing" ? { width: 0, opacity: 0 } : { width: targetWidth, opacity: 1 }}
    transition={reduced ? immediateTransition : panelTransition}
    onAnimationComplete={onFinish}
    aria-hidden={phase === "closing" || undefined} inert={phase === "closing" || undefined}
    data-closing-tab={phase === "closing" || undefined} data-opening-tab={phase === "opening" || undefined}
    className={`tab-${phase} relative flex h-full min-w-0 self-stretch overflow-hidden`}
  >{children}</motion.div>;
}
