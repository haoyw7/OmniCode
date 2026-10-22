import { createContext, forwardRef, useContext, useMemo, useSyncExternalStore, type ComponentPropsWithoutRef } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { isPaneResizing, subscribePaneResize } from "../lib/paneResize";
import { immediateTransition, panelTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "./SurfaceVisibility";
import { cn } from "../lib/cn";

export const ListMotionContext = createContext(true);

export function ListMotion({ children, enabled = true }: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const parentEnabled = useContext(ListMotionContext);
  const resizing = useSyncExternalStore(subscribePaneResize, isPaneResizing, () => false);
  return <ListMotionContext.Provider value={parentEnabled && enabled && !resizing}>
    <AnimatePresence initial={false}>{children}</AnimatePresence>
  </ListMotionContext.Provider>;
}

export function useListMotion() {
  const enabled = useContext(ListMotionContext);
  const reduced = useMotionPreference();
  const present = useIsPresent();
  const animate = enabled && !reduced && !isPaneResizing();
  return useMemo(() => ({
    layout: animate ? "position" as const : false as const,
    initial: animate ? { opacity: 0 } : false as const,
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: animate ? panelTransition : immediateTransition,
    inert: !present || undefined,
    "aria-hidden": !present || undefined,
  }), [animate, present]);
}

export const ListMotionItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof motion.div>>(
  function ListMotionItem(props, ref) {
    const animation = useListMotion();
    const visible = useSurfaceVisibility();
    return <SurfaceVisibilityContext.Provider value={visible && !animation.inert}>
      <motion.div {...animation} {...props} ref={ref} />
    </SurfaceVisibilityContext.Provider>;
  },
);

export const ListMotionLi = forwardRef<HTMLLIElement, ComponentPropsWithoutRef<typeof motion.li>>(
  function ListMotionLi(props, ref) {
    const animation = useListMotion();
    const visible = useSurfaceVisibility();
    return <SurfaceVisibilityContext.Provider value={visible && !animation.inert}>
      <motion.li {...animation} {...props} ref={ref} />
    </SurfaceVisibilityContext.Provider>;
  },
);

export const ListMotionButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof motion.button>>(
  function ListMotionButton(props, ref) {
    const animation = useListMotion();
    const visible = useSurfaceVisibility();
    return <SurfaceVisibilityContext.Provider value={visible && !animation.inert}>
      <motion.button {...animation} {...props} ref={ref} className={cn("hover:opacity-80 active:opacity-70", props.className)} />
    </SurfaceVisibilityContext.Provider>;
  },
);
