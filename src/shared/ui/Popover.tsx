import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type Ref,
} from "react";
import { Popover as PopoverPrimitive, DropdownMenu } from "radix-ui";
import {
  AnimatePresence,
  motion,
  usePresence,
  type HTMLMotionProps,
} from "motion/react";
import {
  immediateTransition,
  popAnimate,
  popExit,
  popInitial,
  popTransition,
} from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import { cn } from "../lib/cn";
import { LAYER } from "../lib/layers";
import type { PopoverAlign, PopoverSide } from "../lib/popover";
import { NativePopupHost } from "./NativePopupHost";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "./SurfaceVisibility";
import { GlassBackdrop } from "./GlassBackdrop";
import { MenuSubmenuContext } from "./primitives/MenuSubmenuContext";
import "../styles/popover.css";

export type PopoverAnchor =
  | HTMLElement
  | { current: HTMLElement | null }
  | DOMRect
  | { x: number; y: number }
  | null;
export type PopoverDismissReason = "outside" | "escape";

type Props = Omit<ComponentPropsWithoutRef<"div">, "style"> & {
  open?: boolean;
  animated?: boolean;
  onExitComplete?: () => void;
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
  constrainHeight?: boolean;
  layer?: number;
  bare?: boolean;
  style?: CSSProperties;
  autoFocus?: boolean;
  onDismiss?: (reason: PopoverDismissReason) => void;
  dismissOnEscape?: boolean;
  ignore?: string;
  ref?: Ref<HTMLDivElement>;
};

function anchorElement(anchor: PopoverAnchor): HTMLElement | null {
  if (!anchor) return null;
  if (anchor instanceof HTMLElement) return anchor;
  return "current" in anchor ? anchor.current : null;
}

function anchorRect(anchor: PopoverAnchor): DOMRect {
  const element = anchorElement(anchor);
  if (element) return element.getBoundingClientRect();
  if (anchor && "width" in anchor) return anchor;
  if (anchor && "x" in anchor) return new DOMRect(anchor.x, anchor.y, 0, 0);
  return new DOMRect();
}

function dialogLayer(anchor: PopoverAnchor, layer: number): number {
  return layer < LAYER.dialogPopover &&
    anchorElement(anchor)?.closest('[role="dialog"]')
    ? layer + LAYER.dialogPopover - LAYER.popover
    : layer;
}

export function Popover({ open, onExitComplete, ...props }: Props) {
  const visible = useSurfaceVisibility();
  if (open === undefined) return <PresentPopover {...props} />;
  if (!visible) return null;
  return (
    <AnimatePresence propagate onExitComplete={onExitComplete}>
      {open ? <PresentPopover key="popover" {...props} /> : null}
    </AnimatePresence>
  );
}

function PresentPopover(props: Omit<Props, "open">) {
  const [present, safeToRemove] = usePresence();
  const reduced = useMotionPreference();
  const immediate = reduced || props.animated === false;
  const visible = useSurfaceVisibility();
  useLayoutEffect(() => {
    if ((immediate || !visible) && !present) safeToRemove?.();
  }, [immediate, visible, present, safeToRemove]);
  useEffect(() => {
    if ((immediate || !visible) && !present) safeToRemove?.();
  }, [immediate, visible, present, safeToRemove]);
  if (!visible || (immediate && !present)) return null;
  return (
    <PopoverSurface
      {...props}
      present={present}
      onPresenceComplete={() => {
        if (!present) safeToRemove?.();
      }}
    />
  );
}

type SurfaceProps = Omit<Props, "open"> & {
  present: boolean;
  onPresenceComplete: () => void;
};

function PopoverSurface({
  anchor,
  side = "bottom",
  align = "start",
  gap = 6,
  padding = 8,
  width,
  minHeight: _minHeight,
  maxHeight,
  constrainHeight = true,
  layer = LAYER.popover,
  onDismiss,
  dismissOnEscape = true,
  ignore,
  autoFocus = false,
  present,
  onExitComplete: _onExitComplete,
  ...props
}: SurfaceProps) {
  const host = useContext(NativePopupHost);
  const submenu = useContext(MenuSubmenuContext);
  const dropdown = submenu?.anchor === anchor;
  const surface = useRef<HTMLDivElement>(null);
  const currentAnchor = useRef(anchor);
  currentAnchor.current = anchor;
  const virtualRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const rect = anchorRect(currentAnchor.current);
          return align === "before"
            ? new DOMRect(
                rect.left,
                rect.top,
                side === "top" || side === "bottom" ? 0 : rect.width,
                side === "left" || side === "right" ? 0 : rect.height,
              )
            : rect;
        },
        get contextElement() {
          return anchorElement(currentAnchor.current) ?? undefined;
        },
      },
    }),
    [anchor, align, side, present],
  );
  const Content = dropdown ? DropdownMenu.Content : PopoverPrimitive.Content;
  const Portal = dropdown ? DropdownMenu.Portal : PopoverPrimitive.Portal;
  const content = (
    <Portal forceMount container={host ?? undefined}>
      <Content
        forceMount
        asChild
        side={side}
        align={align === "before" ? "end" : align}
        sideOffset={gap}
        collisionPadding={padding}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (present && autoFocus)
            surface.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (present && dismissOnEscape) onDismiss?.("escape");
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
          const target = event.target;
          if (!present || event.detail.originalEvent.type !== "pointerdown")
            return;
          if (target instanceof Node && anchorElement(anchor)?.contains(target))
            return;
          if (target instanceof Element && ignore && target.closest(ignore))
            return;
          onDismiss?.("outside");
        }}
        style={{
          width: host ? "100%" : width,
          maxWidth: host ? undefined : `calc(100vw - ${padding * 2}px)`,
          zIndex: dialogLayer(anchor, layer),
          pointerEvents: present ? "auto" : "none",
        }}
      >
        <PopoverFrame
          contentProps={props}
          present={present}
          native={!!host}
          surfaceRef={surface}
          heightLimit={
            constrainHeight
              ? host
                ? `${maxHeight ?? 400}px`
                : `min(${maxHeight ?? 100000}px, var(--radix-${dropdown ? "dropdown-menu" : "popover"}-content-available-height))`
              : undefined
          }
        />
      </Content>
    </Portal>
  );
  return dropdown ? (
    content
  ) : (
    <PopoverPrimitive.Root open={present} modal={false}>
      <PopoverPrimitive.Anchor virtualRef={virtualRef} />
      {content}
    </PopoverPrimitive.Root>
  );
}

function PopoverFrame({
  contentProps: {
    animated = true,
    frameProps,
    bare,
    className,
    style: contentStyle,
    children,
    ref: contentRef,
    onPresenceComplete,
    onClickCapture,
    ...contentProps
  },
  present,
  native,
  surfaceRef,
  heightLimit,
  ref,
  style,
  ...radixProps
}: ComponentPropsWithoutRef<"div"> & {
  ref?: Ref<HTMLDivElement>;
  "data-side"?: PopoverSide;
  contentProps: Omit<SurfaceProps, "anchor" | "present">;
  present: boolean;
  native: boolean;
  surfaceRef: { current: HTMLDivElement | null };
  heightLimit?: string;
}) {
  const reduced = useMotionPreference();
  const immediate = reduced || !animated;
  return (
    <motion.div
      {...(radixProps as HTMLMotionProps<"div">)}
      {...frameProps}
      initial={immediate ? false : { opacity: popInitial.opacity }}
      animate={{ opacity: popAnimate.opacity }}
      exit={{ opacity: popExit.opacity }}
      transition={immediate ? immediateTransition : popTransition}
      onAnimationComplete={onPresenceComplete}
      ref={(element) => {
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
        if (typeof frameProps?.ref === "function") frameProps.ref(element);
        else if (frameProps?.ref) frameProps.ref.current = element;
      }}
      data-native-popover-frame={native || undefined}
      data-popover-side={radixProps["data-side"]}
      data-fold-state={present ? "open" : "closing"}
      inert={!present}
      role={undefined}
      className={cn(
        !bare &&
          !native &&
          "popover-frame isolate overflow-hidden rounded-lg border border-stroke shadow-md",
      )}
      style={{ maxHeight: heightLimit, ...style }}
    >
      {bare || native ? null : <GlassBackdrop />}
      <motion.div
        {...(contentProps as HTMLMotionProps<"div">)}
        ref={(element) => {
          surfaceRef.current = element;
          if (typeof contentRef === "function") contentRef(element);
          else if (contentRef) contentRef.current = element;
        }}
        initial={immediate ? false : popInitial}
        animate={popAnimate}
        exit={popExit}
        transition={immediate ? immediateTransition : popTransition}
        data-popover-side={radixProps["data-side"]}
        data-dialog-popover
        inert={!present || contentProps.inert}
        aria-hidden={!present || contentProps["aria-hidden"]}
        onClickCapture={(event) => {
          if (!present) {
            event.preventDefault();
            event.stopPropagation();
          } else onClickCapture?.(event);
        }}
        style={{
          maxHeight: heightLimit
            ? `calc(${heightLimit} - ${bare || native ? 0 : 2}px)`
            : undefined,
          ...contentStyle,
        }}
        className={cn(
          "relative z-[1] outline-none",
          native && "w-full",
          className,
        )}
      >
        <SurfaceVisibilityContext.Provider value={present}>
          {children}
        </SurfaceVisibilityContext.Provider>
      </motion.div>
    </motion.div>
  );
}
