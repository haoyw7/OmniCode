import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { panelTransition, immediateTransition, popInitial, popAnimate, popExit } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
export function DropTargetHint({ label, rect }: { label: string; rect?: CSSProperties }) {
  const reduced = useMotionPreference();
  const { left, top, width, height, ...style } = rect ?? { left: 0, top: 0, width: "100%", height: "100%" };
  return <motion.div initial={reduced ? false : popInitial} animate={popAnimate} exit={popExit} transition={reduced ? immediateTransition : panelTransition} className="pane-drop-hint pointer-events-none absolute inset-0 z-20">
    <motion.div layout initial={false} animate={{ left, top, width, height }} style={style} transition={reduced ? immediateTransition : panelTransition} className="pane-drop-hint-target">
      <div className="pane-drop-hint-panel"><span className="pane-drop-hint-label">{label}</span></div>
    </motion.div>
  </motion.div>;
}
