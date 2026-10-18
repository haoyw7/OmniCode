import { animate, motion, useMotionTemplate, useMotionValue } from "motion/react";
import { duration, ease, panelTransition, immediateTransition } from "../../shared/motion/tokens";
import { useMotionPreference } from "../../shared/motion/useMotionPreference";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useCollapseMotion } from "../../shared/ui/AnimatedCollapse";
import { SurfaceVisibilityContext } from "../../shared/ui/SurfaceVisibility";

type Props = {
  open: boolean;
  width: number;
  /** Reserved drag gutter excluded from the sidebar's layout and paint bounds. */
  trailingInset?: string;
  dragging: boolean;
  setPaneRef: (pane: HTMLElement | null) => void;
  finishDrag: () => void;
  resizeHandle?: ReactNode;
  children: ReactNode;
};

// The sidebar and its replacement rail must move with the same timing.
export const SIDEBAR_TRANSITION_MS = duration.panel * 1000;
export const SIDEBAR_RAIL_WIDTH = 52;
export const SIDEBAR_TRANSITION_EASING = `cubic-bezier(${ease.join(", ")})`;
export const SIDEBAR_MOTION_STYLE = {
  "--collapse-duration": `${SIDEBAR_TRANSITION_MS}ms`,
  "--collapse-easing": SIDEBAR_TRANSITION_EASING,
  "--sidebar-rail-width": `${SIDEBAR_RAIL_WIDTH}px`,
} as CSSProperties;

// Deliver the first closed render so descendants stop polling, then leave the
// hidden tree alone until reopening. Keep its list state and subscriptions.
const RetainedSidebarContent = memo(
  function RetainedSidebarContent({
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) {
    return children;
  },
  (previous, next) =>
    previous.open === next.open &&
    (!next.open || previous.children === next.children),
);

/** Keep animation bookkeeping out of App so each phase only renders this rail. */
export function SidebarRail({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const reduced = useMotionPreference();
  const { foldState, finish } = useCollapseMotion(open, SIDEBAR_TRANSITION_MS);
  const hasOpened = useRef(open);
  if (open) hasOpened.current = true;
  return (
    <motion.div
      initial={false}
      animate={{ gridTemplateColumns: open ? `${SIDEBAR_RAIL_WIDTH}px` : "0px" }}
      transition={reduced ? immediateTransition : panelTransition}
      onAnimationComplete={finish}
      data-sidebar-rail
      data-fold-state={foldState}
      className="animated-collapse-size sidebar-rail relative grid h-full min-h-0 shrink-0"
      data-expanded={open}
      style={{
        ...SIDEBAR_MOTION_STYLE,
      }}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
    >
      <div
        className="sidebar-rail-content absolute inset-y-0 left-0 overflow-hidden"
        style={{ width: SIDEBAR_RAIL_WIDTH }}
      >
        <div className="h-full" hidden={!open && foldState === "closed"}>
          <SurfaceVisibilityContext.Provider value={open}>
            {hasOpened.current ? (
              <RetainedSidebarContent open={open}>
                {children}
              </RetainedSidebarContent>
            ) : null}
          </SurfaceVisibilityContext.Provider>
        </div>
      </div>
    </motion.div>
  );
}

export function SidebarTransition({
  open,
  width,
  trailingInset,
  dragging,
  setPaneRef,
  finishDrag,
  resizeHandle,
  children,
}: Props) {
  const reduced = useMotionPreference();
  const { foldState, finish } = useCollapseMotion(open, SIDEBAR_TRANSITION_MS);
  const hasOpened = useRef(open);
  const animatedWidth = useMotionValue(open ? width : 0);
  const insetWidth = useMotionTemplate`max(0px, calc(${animatedWidth}px - ${trailingInset ?? "0px"}))`;
  const wasDragging = useRef(false);
  if (open) hasOpened.current = true;
  const attach = useCallback(
    (pane: HTMLDivElement | null) => {
      // Resize writes its own CSS variable; Motion alone owns the resting width.
      setPaneRef(pane);
    },
    [setPaneRef],
  );

  useLayoutEffect(() => {
    if (open) return;
    finishDrag();
  }, [open, finishDrag]);

  useLayoutEffect(() => {
    if (dragging) {
      wasDragging.current = true;
      animatedWidth.stop();
      return;
    }
    if (wasDragging.current) {
      animatedWidth.jump(width);
      wasDragging.current = false;
    }
    const target = open ? width : 0;
    if (reduced) {
      animatedWidth.jump(target);
      finish();
      return;
    }
    const animation = animate(animatedWidth, target, panelTransition);
    let current = true;
    void animation.then(() => { if (current) finish(); });
    return () => { current = false; animation.stop(); };
  }, [open, width, dragging, reduced, animatedWidth, finish]);

  return (
    <motion.div
      initial={false}
      ref={attach}
      data-sidebar-transition
      data-fold-state={foldState}
      data-expanded={open}
      data-resizing={dragging || undefined}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
      className="animated-collapse-size sidebar-transition relative h-full min-h-0 shrink-0"
      style={{ ...SIDEBAR_MOTION_STYLE, width: trailingInset ? insetWidth : animatedWidth }}
    >
      <motion.div
        initial={false} animate={{ x: open ? 0 : -SIDEBAR_RAIL_WIDTH }}
        transition={dragging || reduced ? immediateTransition : panelTransition}
        className="sidebar-transition-clip absolute inset-y-0 h-full min-h-0 overflow-hidden"
        style={{
          width: dragging ? "100%" : trailingInset ? `max(0px, calc(${width}px - ${trailingInset}))` : width,
          left: 0,
        }}
      >
        <div
          className="sidebar-transition-content h-full min-h-0"
          hidden={!open && foldState === "closed"}
        >
          <SurfaceVisibilityContext.Provider value={open}>
            {hasOpened.current ? (
              <RetainedSidebarContent open={open}>
                {children}
              </RetainedSidebarContent>
            ) : null}
          </SurfaceVisibilityContext.Provider>
        </div>
      </motion.div>
      {open ? resizeHandle : null}
    </motion.div>
  );
}
