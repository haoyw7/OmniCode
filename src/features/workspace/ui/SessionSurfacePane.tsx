import { motion } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import type { CSSProperties, ReactNode, UIEventHandler } from "react";
import { useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../../../shared/ui/SurfaceVisibility";

/** Collapsed tools retain their editor and PTY lifetimes until explicitly closed. */
export function SessionSurfacePane({
  id,
  chat = false,
  chatEdge,
  visible,
  expanded,
  grid,
  dragging,
  floating = false,
  style,
  onScroll,
  children,
}: {
  id: string;
  chat?: boolean;
  chatEdge?: "left" | "right";
  visible: boolean;
  expanded: boolean;
  grid: boolean;
  dragging: boolean;
  floating?: boolean;
  style: CSSProperties;
  onScroll: UIEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const parentVisible = useSurfaceVisibility();
  const { foldState, finish } = useCollapseMotion(expanded);
  const reduced = useMotionPreference();
  const interactive = parentVisible && visible && expanded;
  return (
    <motion.div
      initial={false}
      animate={{ opacity: expanded ? dragging && !floating ? 0.4 : 1 : 0 }}
      transition={reduced ? immediateTransition : panelTransition}
      onAnimationComplete={finish}
      data-pane-id={id}
      data-pane-chat={chat ? "" : undefined}
      data-pane-floating={floating ? "" : undefined}
      data-pane-chat-edge={chatEdge}
      data-fold-state={grid ? foldState : undefined}
      aria-hidden={!interactive}
      inert={!interactive || floating || undefined}
      className={`${grid ? "relative" : "absolute"} flex min-h-0 min-w-0 flex-col overflow-hidden ${!expanded && foldState === "closed" ? "invisible" : ""} ${dragging && !floating ? "opacity-40" : ""}`}
      style={style}
      onScroll={onScroll}
    >
      <SurfaceVisibilityContext.Provider value={interactive}>
        {children}
      </SurfaceVisibilityContext.Provider>
    </motion.div>
  );
}
