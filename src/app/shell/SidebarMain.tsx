import { useRef, type ReactNode } from "react";
import { motion } from "motion/react";
import { panelTransition, immediateTransition } from "../../shared/motion/tokens";
import { useMotionPreference } from "../../shared/motion/useMotionPreference";
import { beginPaneResize } from "../../shared/lib/paneResize";

/** The main surface follows sidebar layout without rebuilding retained panes. */
export function SidebarMain({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useMotionPreference();
  const release = useRef<(() => void) | undefined>(undefined);
  return (
    <motion.div
      layout
      layoutDependency={open}
      transition={reduced ? immediateTransition : panelTransition}
      onLayoutAnimationStart={() => { release.current?.(); release.current = beginPaneResize(); }}
      onLayoutAnimationComplete={() => { release.current?.(); release.current = undefined; }}
      ref={(node) => { if (!node) { release.current?.(); release.current = undefined; } }}
      data-sidebar-main
      className="body-glass flex min-h-0 min-w-0 flex-1 flex-col"
    >{children}</motion.div>
  );
}
