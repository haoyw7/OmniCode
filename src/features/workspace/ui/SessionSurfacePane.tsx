import { DragHandleContext, useActiveDragPayload, useDraggableItem, type DragPayload } from "../../../shared/ui/primitives/Sortable";
import { PaneDropTargets } from "./PaneDrag";
import { cn } from "../../../shared/lib/cn";
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
  dragPayload,
  dragLabel = "",
  dragEnabled = false,
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
  dragPayload?: DragPayload;
  dragLabel?: string;
  dragEnabled?: boolean;
  style: CSSProperties;
  onScroll: UIEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const parentVisible = useSurfaceVisibility();
  const { foldState, finish } = useCollapseMotion(expanded);
  const reduced = useMotionPreference();
  const interactive = parentVisible && visible && expanded;
  const active = useActiveDragPayload();
  const dragging = active?.type === "workspace-pane" && active.paneId === id;
  const drag = useDraggableItem({ payload: dragPayload ?? { type: "workspace-pane", paneId: id }, renderOverlay: () => dragLabel, disabled: !interactive || !dragEnabled });
  return (
    <motion.div
      ref={drag.ref}
      initial={false}
      animate={{ opacity: expanded ? dragging || drag.dragging ? 0.4 : 1 : 0 }}
      transition={reduced ? immediateTransition : panelTransition}
      onAnimationComplete={finish}
      data-pane-id={id}
      data-pane-chat={chat ? "" : undefined}
      data-pane-chat-edge={chatEdge}
      data-fold-state={grid ? foldState : undefined}
      aria-hidden={!interactive}
      inert={!interactive || undefined}
      className={cn(grid ? "relative" : "absolute", "flex min-h-0 min-w-0 flex-col overflow-hidden", !expanded && foldState === "closed" ? "invisible" : "", dragging || drag.dragging ? "opacity-40" : "")}
      style={style}
      onScroll={onScroll}
    >
      <SurfaceVisibilityContext.Provider value={interactive}>
        <DragHandleContext.Provider value={dragEnabled ? drag.handleProps : undefined}>{children}</DragHandleContext.Provider>
        <PaneDropTargets id={id} enabled={interactive} />
      </SurfaceVisibilityContext.Provider>
    </motion.div>
  );
}
