import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence, animate as animateElement, motion, usePresenceData } from "motion/react";
import { useMotionPreference } from "../shared/motion/useMotionPreference";
import { duration, immediateTransition, motionGeometry, panelTransition } from "../shared/motion/tokens";
import { useCollapseMotion } from "../shared/ui/AnimatedCollapse";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobilePageStateContext, type MobilePageState } from "./mobilePageState";
import { MobileOverlayLevelContext } from "./MobileOverlayHost";
import { ReadonlyTextStateContext } from "../shared/ui/ReadonlyTextView";
import "./styles/page-layout.css";

export const MOBILE_PAGE_MOTION_MS = duration.panel * 1000;
export interface MobileRoute {
  key: string;
  section: "home" | "chat" | "settings";
  depth: number;
}
type Direction = -1 | 0 | 1;
type PageMotion = "subtle" | "slide" | "push-chat" | "push-home";
export function mobileRouteDirection(from: MobileRoute, to: MobileRoute): Direction {
  if (from.section === to.section)
    return Math.sign(to.depth - from.depth) as Direction;
  if (to.section === "settings") return 1;
  if (from.section === "settings") return -1;
  return to.section === "chat" ? 1 : -1;
}
function pageMotionValues(direction: Direction, motion: PageMotion) {
  const distance = motion === "subtle" ? motionGeometry.pageSubtle : motion === "push-home" ? motionGeometry.pageHomePercent : motionGeometry.pageSlidePercent;
  const unit = motion === "subtle" ? "px" : "%";
  return {
    offset: `${direction * distance}${unit}`,
    exitOffset: `${-direction * distance}${unit}`,
    opacity: motion === "subtle" ? 0 : 1,
    filter: motion === "push-home" ? "brightness(0.7)" : "none",
  };
}

const PageLayer = forwardRef<HTMLDivElement, {
  id: number;
  active: boolean;
  visible: boolean;
  enter: boolean;
  direction: Direction;
  page: MobilePageState;
  children: ReactNode;
  onExited: () => void;
  profile: PageMotion;
}>(function PageLayer({ id, active, visible, enter, direction, page, children, onExited, profile }, forwarded) {
  const element = useRef<HTMLDivElement>(null);
  const assignRef = useCallback((node: HTMLDivElement | null) => {
    element.current = node;
    if (typeof forwarded === "function") forwarded(node);
    else if (forwarded) forwarded.current = node;
  }, [forwarded]);
  const presence = usePresenceData() as { allowed: number[] } | undefined;
  const { foldState, finish } = useCollapseMotion(active, MOBILE_PAGE_MOTION_MS);
  const exit = useRef(onExited);
  exit.current = onExited;
  const reduced = useMotionPreference();
  useLayoutEffect(() => {
    if (!active && foldState === "closed") exit.current();
  }, [active, foldState]);
  useLayoutEffect(() => {
    if (!active) return;
    const node = element.current;
    if (!node) return;
    const selectors = [".mobile-home-scroll", ".mobile-settings", "[data-mobile-page-scroll]"];
    for (const selector of selectors) {
      const scroll = node.querySelector<HTMLElement>(selector);
      if (scroll) scroll.scrollTop = page.scroll.get(selector) ?? 0;
    }
    const save = () => {
      for (const selector of selectors) {
        const scroll = node.querySelector<HTMLElement>(selector);
        if (scroll) page.scroll.set(selector, scroll.scrollTop);
      }
    };
    node.addEventListener("scroll", save, true);
    return () => { save(); node.removeEventListener("scroll", save, true); };
  }, [active, page]);
  useLayoutEffect(() => {
    if (profile === "slide" && active && visible)
      element.current?.querySelector<HTMLElement>(".mobile-sheet-header-button")?.focus({ preventScroll: true });
  }, [profile, active, visible]);
  const hidden = pageMotionValues(direction, profile);
  if (presence && !presence.allowed.includes(id)) return null;
  return (
    <motion.div
      ref={assignRef}
      className="mobile-page-layer"
      data-page-active={active}
      data-page-front={profile === "push-chat" || undefined}
      data-page-motion={!active ? "exit" : enter ? "enter" : undefined}
      initial={enter && !reduced ? { x: hidden.offset, opacity: hidden.opacity, filter: hidden.filter } : false}
      animate={active ? { x: 0, opacity: 1, filter: "none" } : { x: hidden.exitOffset, opacity: hidden.opacity, filter: hidden.filter }}
      exit={{ opacity: 0, transition: immediateTransition }}
      transition={reduced ? immediateTransition : panelTransition}
      layout="position"
      onAnimationComplete={finish}
      inert={!active || !visible}
      aria-hidden={!active || !visible || undefined}
    >
      <MobilePageStateContext.Provider value={page}>
        <SurfaceVisibilityContext.Provider value={active && visible}>
          <ReadonlyTextStateContext.Provider value={page.values}>
            {children}
          </ReadonlyTextStateContext.Provider>
        </SurfaceVisibilityContext.Provider>
      </MobilePageStateContext.Provider>
    </motion.div>
  );
});

interface Entry { route: MobileRoute; id: number; page: MobilePageState; }
const pageState = (): MobilePageState => ({ scroll: new Map(), values: new Map() });

/** Only the active page and its departing neighbor occupy DOM. */
export function MobilePageTransition({ route, visible = true, animate = true, slide = false, children }: {
  route: MobileRoute;
  visible?: boolean;
  animate?: boolean;
  /** Full-width navigation inside a persistent sheet, without fading pages. */
  slide?: boolean;
  children: ReactNode;
}) {
  const parentVisible = useSurfaceVisibility();
  const reduced = useMotionPreference();
  const pages = useRef(new Map<string, MobilePageState>());
  const [state, setState] = useState<{
    current: Entry; previous?: Entry & { children: ReactNode }; serial: number; direction: Direction; enter: boolean; push: boolean;
  }>(() => {
    const page = pageState();
    pages.current.set(route.key, page);
    return { current: { route, id: 0, page }, serial: 0, direction: 0, enter: false, push: false };
  });
  const committed = useRef(children);
  useLayoutEffect(() => { committed.current = children; });
  if (route.key !== state.current.route.key) {
    let page = pages.current.get(route.key);
    if (!page) { page = pageState(); pages.current.set(route.key, page); }
    // Bound navigation memory; this contains values and offsets, never elements.
    pages.current.delete(route.key);
    pages.current.set(route.key, page);
    if (pages.current.size > 24) pages.current.delete(pages.current.keys().next().value!);
    const enter = animate && !reduced;
    setState({
      current: { route, id: state.previous?.route.key === route.key ? state.previous.id : state.serial + 1, page },
      previous: enter ? { ...state.current, children: committed.current } : undefined,
      serial: state.serial + 1,
      direction: mobileRouteDirection(state.current.route, route),
      enter,
      // Retain the motion profile after the departing layer is released.
      push: (state.current.route.section === "home" && route.section === "chat")
        || (state.current.route.section === "chat" && route.section === "home"),
    });
  }
  const layers = [
    ...(state.previous ? [{ ...state.previous, active: false }] : []),
    { ...state.current, children, active: true },
  ];
  return (
    <div className="mobile-page-stack">
      <AnimatePresence mode="popLayout" custom={{ allowed: layers.map(entry => entry.id) }}>
      {layers.map((entry) => (
        <PageLayer key={entry.id} id={entry.id} active={entry.active} visible={visible && parentVisible}
          profile={slide ? "slide" : state.push ? entry.route.section === "chat" ? "push-chat" : "push-home" : "subtle"}
          enter={state.enter} direction={state.direction} page={entry.page}
          onExited={() => setState((current) => current.previous?.id === entry.id
            ? { ...current, previous: undefined } : current)}>
          {entry.children}
        </PageLayer>
      ))}
      </AnimatePresence>
    </div>
  );
}

/** Fullscreen overlays retain their own subtree until the exit completes. */
export function MobilePageOverlay({ open, children, keepMounted = false }: {
  open: boolean;
  children: ReactNode;
  /** Retain an opened page's data and DOM for the next visit. */
  keepMounted?: boolean;
}) {
  const { foldState, finish } = useCollapseMotion(open, MOBILE_PAGE_MOTION_MS);
  const element = useRef<HTMLDivElement>(null);
  const retained = useRef(children);
  const opened = useRef(false);
  if (open) {
    retained.current = children;
    opened.current = true;
  }
  const reduced = useMotionPreference();
  const closed = !open && foldState === "closed";
  if (closed && (!keepMounted || !opened.current)) return null;
  return (
    <AnimatePresence>
    <motion.div ref={element} className="mobile-page-overlay" inert={!open} aria-hidden={!open || undefined}
      hidden={closed}
      data-page-motion={open ? "enter" : "exit"}
      initial={{ x: motionGeometry.pageSubtle, opacity: 0 }}
      animate={{ x: open ? 0 : -motionGeometry.pageSubtle, opacity: open ? 1 : 0 }}
      transition={reduced ? immediateTransition : panelTransition}
      onAnimationComplete={finish}>
      <SurfaceVisibilityContext.Provider value={open}>
        <MobileOverlayLevelContext.Provider value={130}>
        {open ? children : retained.current}
        </MobileOverlayLevelContext.Provider>
      </SurfaceVisibilityContext.Provider>
    </motion.div>
    </AnimatePresence>
  );
}

/** The persistent header animates without duplicating its focus/anchor refs. */
export function useMobileHeaderMotion(ref: RefObject<HTMLElement | null>, route: MobileRoute, animate: boolean) {
  const previous = useRef(route);
  const reduced = useMotionPreference();
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = route;
    if (before.key === route.key || !animate || reduced) return;
    // The animation starts in the commit that mounts the next page, whose
    // work can hold the first frames; starting from zero blanked the header.
    const node = ref.current;
    if (!node) return;
    const animation = animateElement(node, {
      opacity: [motionGeometry.headerOpacity, 1],
      x: [mobileRouteDirection(before, route) * motionGeometry.pageSubtle, 0],
    }, panelTransition);
    return () => animation.stop();
  }, [route.key, animate, ref, reduced]);
}
