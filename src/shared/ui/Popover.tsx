import { NativePopupHost } from "./NativePopupHost";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "./SurfaceVisibility";
import { AnimatePresence, motion, usePresence, type HTMLMotionProps } from "motion/react";
import { immediateTransition, motionDistance, popAnimate, popExit, popInitial, popTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { GlassBackdrop } from "./GlassBackdrop";
import { LAYER } from "../lib/layers";
import {
  placePopover,
  type AnchorRect,
  type PopoverAlign,
  type PopoverPosition,
  type PopoverSide,
} from "../lib/popover";

/**
 * A trigger element, a live ref to one, a rect already in viewport
 * coordinates, or a bare point for context menus.
 */
export type PopoverAnchor =
  | HTMLElement
  | { current: HTMLElement | null }
  | DOMRect
  | { x: number; y: number }
  | null;

export type PopoverDismissReason = "outside" | "escape";

type Props = Omit<ComponentPropsWithoutRef<"div">, "style"> & {
  /** When supplied, retain the surface until its closing animation finishes. */
  open?: boolean;
  /** Hover surfaces can include the glass frame in their pointer boundary. */
  frameProps?: Pick<
    ComponentPropsWithoutRef<"div">,
    "onPointerEnter" | "onPointerLeave"
  > & { ref?: Ref<HTMLDivElement> };
  anchor: PopoverAnchor;
  side?: PopoverSide;
  align?: PopoverAlign;
  gap?: number;
  padding?: number;
  width?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Defaults to true. Disable for intrinsic-height surfaces like context menus. */
  constrainHeight?: boolean;
  /** Defaults to `LAYER.popover`; a flyout off an open popover wants higher. */
  layer?: number;
  /** Drops the glass frame and keeps only placement and the content animation. */
  bare?: boolean;
  style?: CSSProperties;
  autoFocus?: boolean;
  /** Wiring this in hands Popover the outside-click and Escape handling. */
  onDismiss?: (reason: PopoverDismissReason) => void;
  dismissOnEscape?: boolean;
  /** A pointer landing inside anything matching this selector is not outside. */
  ignore?: string;
  ref?: Ref<HTMLDivElement>;
};

type SurfaceProps = Omit<Props, "open"> & {
  present?: boolean;
  onPresenceComplete?: () => void;
};

const FRAME =
  "popover-frame isolate overflow-hidden rounded-lg border border-stroke shadow-md";

/** Which corner the open animation grows from, so it reads as anchored. */
function origin(side: PopoverSide, align: PopoverAlign): string {
  const near = align === "start" ? "0%" : align === "center" ? "50%" : "100%";
  if (side === "bottom") return `${near} 0%`;
  if (side === "top") return `${near} 100%`;
  return side === "right" ? `0% ${near}` : `100% ${near}`;
}

function anchorElement(anchor: PopoverAnchor): HTMLElement | null {
  if (!anchor) return null;
  if (anchor instanceof HTMLElement) return anchor;
  return "current" in anchor ? anchor.current : null;
}

/** Menus anchored inside a modal dialog must float above that dialog. */
function dialogLayer(anchor: PopoverAnchor, layer: number): number {
  if (layer >= LAYER.dialogPopover) return layer;
  return anchorElement(anchor)?.closest('[role="dialog"]')
    ? layer + (LAYER.dialogPopover - LAYER.popover)
    : layer;
}

function toRect(rect: DOMRect | AnchorRect): AnchorRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function anchorRect(anchor: PopoverAnchor): AnchorRect | null {
  if (!anchor) return null;
  if (anchor instanceof HTMLElement) {
    return toRect(anchor.getBoundingClientRect());
  }
  if ("current" in anchor) {
    const el = anchor.current;
    return el ? toRect(el.getBoundingClientRect()) : null;
  }
  if ("width" in anchor) return toRect(anchor);
  const { x, y } = anchor;
  return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
}

/** Points and rects are fresh objects every render; elements keep identity. */
function anchorKey(anchor: PopoverAnchor): unknown {
  if (!anchor || anchor instanceof HTMLElement || "current" in anchor) {
    return anchor;
  }
  if ("width" in anchor) {
    return `${anchor.left}:${anchor.top}:${anchor.width}:${anchor.height}`;
  }
  return `${anchor.x}:${anchor.y}`;
}

/**
 * The height the content wants, not the height the previous placement allowed.
 * Measuring the capped surface lets a flyout that opened short (loading, or a
 * smaller sibling submenu) stay squeezed against the viewport edge forever.
 */
function naturalSize(
  frame: HTMLElement,
  content: HTMLElement | null,
): { width: number; height: number } {
  const elements = content ? [frame, content] : [frame];
  const saved = elements.map((el) => ({
    maxHeight: el.style.maxHeight,
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
  }));
  for (const el of elements) el.style.maxHeight = "none";
  const size = { width: frame.offsetWidth, height: frame.offsetHeight };
  elements.forEach((el, index) => {
    el.style.maxHeight = saved[index].maxHeight;
  });
  // Uncapping forces layout and clamps the scroller's offset to zero. Restore
  // it only after both height caps are back, including on content/viewport changes.
  elements.forEach((el, index) => {
    if (saved[index].scrollTop) el.scrollTop = saved[index].scrollTop;
    if (saved[index].scrollLeft) el.scrollLeft = saved[index].scrollLeft;
  });
  return size;
}

function samePosition(a: PopoverPosition | null, b: PopoverPosition): boolean {
  return (
    a != null &&
    a.side === b.side &&
    a.left === b.left &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight
  );
}

/**
 * A menu, dropdown, or flyout that escapes its pane: portalled to the body so
 * no local stacking context can paint over it, placed against its anchor with
 * viewport flipping, and animated in from the anchored edge.
 */
export function Popover({ open, ...props }: Props) {
  return open === undefined ? (
    <PresentPopover {...props} />
  ) : (
    <AnimatedPopover {...props} open={open} />
  );
}

function AnimatedPopover({ open, ...props }: Props & { open: boolean }) {
  const visible = useSurfaceVisibility();
  if (!visible) return null;
  return (
    <AnimatePresence propagate>
      {visible && open ? <PresentPopover key="popover" {...props} /> : null}
    </AnimatePresence>
  );
}

function PresentPopover({ children, ...props }: Omit<Props, "open">) {
  const [present, safeToRemove] = usePresence();
  const reduced = useMotionPreference();
  const visible = useSurfaceVisibility();
  useLayoutEffect(() => {
    if ((reduced || !visible) && !present) safeToRemove?.();
  }, [reduced, visible, present, safeToRemove]);
  useEffect(() => {
    if ((reduced || !visible) && !present) safeToRemove?.();
  }, [reduced, visible, present, safeToRemove]);
  if (!visible || (reduced && !present)) return null;
  return (
    <PopoverSurface
      {...props}
      present={present}
      onPresenceComplete={() => { if (!present) safeToRemove?.(); }}
      inert={!present || props.inert}
      aria-hidden={!present || props["aria-hidden"]}
      autoFocus={present && props.autoFocus}
      onDismiss={present ? props.onDismiss : undefined}
      onClickCapture={(event) => {
        if (!present) { event.preventDefault(); event.stopPropagation(); }
        else props.onClickCapture?.(event);
      }}
    >
      <SurfaceVisibilityContext.Provider value={present}>
        {children}
      </SurfaceVisibilityContext.Provider>
    </PopoverSurface>
  );
}

function PopoverSurface(props: SurfaceProps) {
  const host = useContext(NativePopupHost);
  return host ? (
    <NativePopover {...props} host={host} />
  ) : (
    <WebPopover {...props} />
  );
}

function NativePopover({
  host,
  frameProps,
  children,
  className,
  maxHeight,
  onDismiss,
  ignore,
  ref,
  style,
  autoFocus,
  dismissOnEscape = true,
  present = true,
  onPresenceComplete,
  onTransitionEnd,
  ...props
}: SurfaceProps & { host: HTMLElement }) {
  const visible = useSurfaceVisibility();
  const surface = useRef<HTMLDivElement | null>(null);
  const reduced = useMotionPreference();
  const canFocus = visible && present;
  useEffect(() => {
    if (canFocus && autoFocus) surface.current?.focus({ preventScroll: true });
  }, [canFocus, autoFocus]);
  useEffect(() => {
    if (!visible || !onDismiss) return;
    const key = (event: KeyboardEvent) => {
      if (!dismissOnEscape || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss("escape");
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        surface.current?.contains(target) ||
        (ignore && target.closest(ignore))
      )
        return;
      onDismiss("outside");
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", outside);
    };
  }, [visible, onDismiss, dismissOnEscape, ignore]);
  // These position the ordinary web popover; the OS positions this surface.
  const {
    anchor: _anchor,
    side: _side,
    align: _align,
    gap: _gap,
    padding: _padding,
    width: _width,
    minHeight: _minHeight,
    constrainHeight: _constrainHeight,
    layer: _layer,
    bare: _bare,
    ...rest
  } = props;
  if (!visible) return null;
  return createPortal(
    <motion.div
      {...rest as HTMLMotionProps<"div">}
      {...frameProps}
      initial={reduced ? false : popInitial}
      animate={popAnimate}
      exit={popExit}
      transition={reduced ? immediateTransition : popTransition}
      onAnimationComplete={onPresenceComplete}
      data-fold-state={present ? "open" : "closing"}
      ref={(el) => {
        const previous = surface.current;
        surface.current = el;
        if (typeof frameProps?.ref === "function") frameProps.ref(el);
        else if (frameProps?.ref && (el || frameProps.ref.current === previous)) frameProps.ref.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref && (el || ref.current === previous)) ref.current = el;
      }}
      style={{ maxHeight: maxHeight ?? 400, ...style }}
      className={`relative w-full outline-none ${className ?? ""}`}
      onTransitionEnd={onTransitionEnd}
    >
      {children}
    </motion.div>,
    host,
  );
}

function WebPopover({
  anchor,
  frameProps,
  side = "bottom",
  align = "start",
  gap,
  padding,
  width,
  minHeight,
  maxHeight,
  constrainHeight = true,
  layer = LAYER.popover,
  bare = false,
  className,
  style,
  autoFocus = false,
  onDismiss,
  dismissOnEscape = true,
  ignore,
  ref,
  children,
  present = true,
  onPresenceComplete,
  ...rest
}: SurfaceProps) {
  const visible = useSurfaceVisibility();
  const reduced = useMotionPreference();
  const frame = useRef<HTMLDivElement | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const key = anchorKey(anchor);

  const place = useCallback(() => {
    const el = frame.current;
    const rect = anchorRect(anchorRef.current);
    if (!el || !rect) return;
    const next = placePopover(
      rect,
      constrainHeight
        ? naturalSize(el, surface.current)
        : { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { side, align, gap, padding, width, minHeight, maxHeight },
    );
    setPosition((prev) => (samePosition(prev, next) ? prev : next));
    // `key` stands in for the anchor, which is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, side, align, gap, padding, width, minHeight, maxHeight, constrainHeight]);

  useLayoutEffect(() => {
    if (!visible) return;
    place();
    // Content that lands after open — a branch list, a filtered menu — resizes
    // the surface, and a top-anchored menu has to be measured again to sit
    // above its trigger rather than drift over it.
    const observer = new ResizeObserver(place);
    if (frame.current) observer.observe(frame.current);
    // A surface already at its height cap does not resize when rows arrive
    // inside its scroller, yet it may now want to move away from the edge.
    const rows = constrainHeight ? new MutationObserver(place) : null;
    if (rows && frame.current) {
      rows.observe(frame.current, { childList: true, subtree: true });
    }
    const onScroll = (event: Event) => {
      // Reading a list does not move its anchor. Remeasuring here both wastes
      // layout work and interrupts native scrolling by temporarily uncapping it.
      if (event.target instanceof Node && frame.current?.contains(event.target))
        return;
      place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      observer.disconnect();
      rows?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
    // A closing surface can reopen before it unmounts. Its anchor may have
    // moved in the meantime even though the ref and menu dimensions are stable.
  }, [visible, place, present, constrainHeight]);

  // A newly opened animated surface starts inert and is initially placed with
  // visibility:hidden. Browsers ignore focus until both have been cleared.
  const canFocus =
    visible &&
    position !== null &&
    present;
  useEffect(() => {
    if (canFocus && autoFocus) surface.current?.focus({ preventScroll: true });
  }, [canFocus, autoFocus]);

  useEffect(() => {
    if (!visible || !onDismiss) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (frame.current?.contains(target)) return;
      if (anchorElement(anchorRef.current)?.contains(target)) return;
      const el =
        target instanceof Element ? target : (target.parentElement ?? null);
      if (ignore && el?.closest(ignore)) return;
      dismissRef.current?.("outside");
    };
    const onKey = (event: KeyboardEvent) => {
      if (!dismissOnEscape || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current?.("escape");
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [visible, onDismiss, dismissOnEscape, ignore]);

  if (!visible) return null;

  // The first pass measures the surface off to the side; the layout effect
  // lands it before the browser paints.
  const placed: CSSProperties = position
    ? {
        position: "fixed",
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: position.width,
        ...(constrainHeight ? { maxHeight: position.maxHeight } : {}),
      }
    : {
        position: "fixed",
        left: 0,
        top: 0,
        width,
        ...(constrainHeight
          ? { maxHeight: maxHeight ?? "calc(100vh - 16px)" }
          : {}),
        visibility: "hidden",
      };

  // Keep the backdrop-filter on a stable frame. WebKit can briefly paint a
  // stale backdrop when the same composited element is transformed and then
  // invalidated by a child hover. Only this unblurred content layer moves.
  const frameInset = bare ? 0 : frame.current
    ? frame.current.offsetHeight - frame.current.clientHeight
    : 2;
  const contentMaxHeight = constrainHeight
    ? position
      ? Math.max(0, position.maxHeight - frameInset)
      : maxHeight != null
        ? Math.max(0, maxHeight - frameInset)
        : `calc(100vh - ${16 + frameInset}px)`
    : undefined;

  const edgeMotion = {
    ...popInitial,
    x: position?.side === "left" ? motionDistance.pop : position?.side === "right" ? -motionDistance.pop : 0,
    y: position?.side === "top" ? motionDistance.pop : position?.side === "bottom" ? -motionDistance.pop : 0,
  };
  return createPortal(
    <motion.div
      {...frameProps}
      initial={reduced ? false : { opacity: popInitial.opacity }}
      animate={{ opacity: popAnimate.opacity }}
      exit={{ opacity: popExit.opacity }}
      transition={reduced ? immediateTransition : popTransition}
      onAnimationComplete={onPresenceComplete}
      ref={(el) => {
        const previous = frame.current;
        frame.current = el;
        if (typeof frameProps?.ref === "function") frameProps.ref(el);
        else if (frameProps?.ref && (el || frameProps.ref.current === previous)) frameProps.ref.current = el;
      }}
      data-popover-side={position?.side ?? side}
      data-fold-state={present ? "open" : "closing"}
      inert={!present}
      style={{ ...placed, zIndex: dialogLayer(anchor, layer) }}
      className={bare ? undefined : FRAME}

    >
      {bare ? null : <GlassBackdrop />}
      <motion.div
        {...rest as HTMLMotionProps<"div">}
        initial={reduced ? false : edgeMotion}
        animate={{ ...popAnimate, x: 0 }}
        exit={edgeMotion}
        transition={reduced ? immediateTransition : popTransition}
        ref={(el) => {
          const previous = surface.current;
          surface.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref && (el || ref.current === previous)) ref.current = el;
        }}
        data-popover-side={position?.side ?? side}
        style={{
          ...(contentMaxHeight != null ? { maxHeight: contentMaxHeight } : {}),
          transformOrigin: origin(position?.side ?? side, align),
          ...style,
        }}
        className={`relative z-[1] outline-none ${className ?? ""}`}
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
