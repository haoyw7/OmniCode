import { IconButton } from "../shared/ui/forms/IconButton";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { animate as animateMotion, frame, cancelFrame, motion, useMotionValue, useScroll, useTransform, type AnimationPlaybackControls } from "motion/react";
import { useMotionPreference } from "../shared/motion/useMotionPreference";
import { immediateTransition, motionGeometry, popTransition } from "../shared/motion/tokens";
import { createPortal } from "react-dom";
import { MobileOverlayHostContext, MobileOverlayLevelContext } from "./MobileOverlayHost";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { keyboardViewportHeight, onKeyboardMotion, onKeyboardSettled, keyboardMotionRemaining, type KeyboardMotion } from "./keyboardMotion";
import { ArrowLeft, X } from "../shared/ui/icons";
import { useCollapseMotion } from "../shared/ui/AnimatedCollapse";
import { useTranslation } from "../shared/i18n/useTranslation";
import { placePopover, type PopoverAlign } from "../shared/lib/popover";
import { SHEET_CLOSE_MS, SHEET_MOTION_MS, useSheetDrag } from "./sheetDrag";
import { preserveInputFocus, usePreserveInputFocusOnTouch } from "./inputFocus";
import { useMobileSheetFocus } from "./useMobileSheetFocus";
import { listenForMobileSheetBack } from "./mobileSheetBack";

// Reads the resolved system-bar insets so popovers stay clear of the status
// bar, gesture area and display cutouts on edge-to-edge screens.
function safeInsets(element: HTMLElement) {
  const host = element.closest<HTMLElement>(".mobile-app");
  if (!host) return { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;" +
    "padding:var(--mobile-safe-top) var(--mobile-safe-right) var(--mobile-safe-bottom) var(--mobile-safe-left)";
  host.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

// Shared popover widths keep panels proportionate to what they hold:
// plain action menus, model settings, lists with a second line, and forms.
export const SHEET_WIDTH = {
  menu: 220,
  settings: 280,
  list: 300,
  form: 320,
} as const;

export type MobileSheetPoint = { x: number; y: number };


const paintOnlyProperties = new Set([
  "opacity", "color", "background", "background-color", "background-image",
  "background-position", "background-position-x", "background-position-y", "background-size",
  "background-repeat", "background-clip", "background-origin", "background-attachment",
  "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "box-shadow", "text-shadow", "outline-color", "text-decoration-color",
  // This registered, non-inherited property only controls the button's tint.
  "--mobile-press-spread",
]);
const keyframeMetadata = new Set(["offset", "computedOffset", "easing", "composite"]);
function isPaintOnlyProperty(property: string) {
  return paintOnlyProperties.has(property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`));
}
function canMoveAnchor(animation: Animation) {
  const transitionProperty = (animation as CSSTransition).transitionProperty;
  if (transitionProperty) return !isPaintOnlyProperty(transitionProperty);
  const keyframes = (animation.effect as KeyframeEffect | null)?.getKeyframes?.();
  const properties = keyframes?.flatMap(keyframe => Object.keys(keyframe).filter(key => !keyframeMetadata.has(key)));
  // Unknown/custom effects remain tracked; only known paint-only effects can
  // safely be ignored. A mixed opacity + transform animation still moves.
  return !properties?.length || properties.some(property => !isPaintOnlyProperty(property));
}

export function MobileSheetHeader({ title, subtitle, className, action, onBack, onClose }: {
  title: ReactNode;
  subtitle?: string;
  className?: string;
  action?: ReactNode;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className={`mobile-sheet-header${className ? ` ${className}` : ""}`}>
      <IconButton type="button" className="mobile-sheet-header-button"
        data-mobile-sheet-back={onBack ? true : undefined}
        label={t(onBack ? "Back" : "Close")} onClick={onBack ?? onClose}>
        {onBack ? <ArrowLeft size={24} /> : <X size={24} />}
      </IconButton>
      <div className="mobile-sheet-header-title">
        <strong>{title}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </div>
      {action}
    </header>
  );
}

export function MobileSheet({
  open = true,
  title,
  onClose,
  onExited,
  onBack,
  placement = "bottom",
  anchor,
  preserveFocus,
  anchorPoint,
  width = SHEET_WIDTH.form,
  align = "start",
  side = "bottom",
  overlapAnchor = false,
  constrainWidthToAnchor = false,
  detents = false,
  surface = "glass",
  header,
  children,
}: {
  /** Keep the sheet mounted to animate both directions when controlling it. */
  open?: boolean;
  title: string;
  onClose: () => void;
  /** Release retained content after a controlled close finishes. */
  onExited?: () => void;
  onBack?: () => void;
  /** Bottom sheet, popover beside a trigger, or a centred choice dialog. */
  placement?: "bottom" | "anchor" | "dialog";
  anchor?: RefObject<HTMLElement | null>;
  /** Input to retain when a pointer opens this sheet while typing. */
  preserveFocus?: RefObject<HTMLElement | null>;
  anchorPoint?: MobileSheetPoint;
  width?: number;
  align?: PopoverAlign;
  side?: "top" | "bottom";
  /** Cover the trigger while keeping the popup top aligned with it. */
  overlapAnchor?: boolean;
  /** Keep a title menu inside its trigger's space between adjacent controls. */
  constrainWidthToAnchor?: boolean;
  /** Bottom sheets only: open at half height and pull up to full screen. */
  detents?: boolean;
  /** Opaque forms avoid filtering the entire viewport while scrolling. */
  surface?: "glass" | "solid";
  /** A centred title row with a close button, or Back when `onBack` is set. */
  header?: { title: ReactNode; subtitle?: string; className?: string; action?: ReactNode };
  /** Defer large menu trees until opening, retaining them through closing. */
  children: ReactNode | (() => ReactNode);
}) {
  const { t } = useTranslation();
  const reduced = useMotionPreference();
  const anchorX = useMotionValue(0);
  const anchorY = useMotionValue(0);
  const anchorTranslate = useTransform(() => `${anchorX.get()}px ${anchorY.get()}px`);
  const { scrollX, scrollY } = useScroll();
  const visible = useSurfaceVisibility();
  const overlayHost = useContext(MobileOverlayHostContext);
  const overlayLevel = useContext(MobileOverlayLevelContext);
  const [dragClosing, setDragClosing] = useState(false);
  const active = open && visible && !dragClosing;
  useLayoutEffect(() => { if (open) setDragClosing(false); }, [open]);
  const { foldState, finish } = useCollapseMotion(
    active,
    active ? SHEET_MOTION_MS : SHEET_CLOSE_MS,
  );
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const back = useCallback(() => {
    // Embedded tool/agent pages own deeper navigation than the outer sheet.
    const button = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("[data-mobile-sheet-back]") ?? [])]
      .find((element) => !element.disabled && !element.closest('[inert], [aria-hidden="true"]') &&
        element.closest(".mobile-sheet") === dialog.current);
    if (button) button.click();
    else (onBack ?? onClose)();
  }, [onBack, onClose]);
  useEffect(() => {
    if (active && dialog.current) return listenForMobileSheetBack(dialog.current, back);
  }, [active, back]);
  useMobileSheetFocus(dialog, active);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (foldState === "closed" && wasOpen.current) {
      wasOpen.current = false;
      onExited?.();
    }
  }, [open, foldState, onExited]);
  usePreserveInputFocusOnTouch(backdrop, preserveFocus, false, active);
  const [position, setPosition] = useState<CSSProperties>();
  const pendingKeyboardAnimation = useRef<(() => void) | undefined>(undefined);
  const drag = useSheetDrag(
    dialog,
    placement === "bottom" && open && visible,
    onClose,
    () => setDragClosing(true),
    detents,
    finish,
  );
  const overlayOpacity = useMotionValue(0);
  const draggedOpacity = useTransform(() => overlayOpacity.get() * drag.opacity.get());
  useLayoutEffect(() => {
    if (placement !== "bottom") return;
    if (reduced) { overlayOpacity.set(active ? 1 : 0); return; }
    const animation = animateMotion(overlayOpacity, active ? 1 : 0, popTransition);
    return () => animation.stop();
  }, [active, placement, reduced, overlayOpacity]);
  useLayoutEffect(() => {
    if (!active || placement !== "anchor") return;
    const element = dialog.current;
    const trigger = anchor?.current;
    if (!element || (!trigger && !anchorPoint)) return;
    const viewport = window.visualViewport;
    let insets = safeInsets(element);
    let keyboardAnimation: AnimationPlaybackControls[] = [];
    const place = (keyboard?: Pick<KeyboardMotion, "duration" | "easing">) => {
      let travel = keyboard;
      let rect = anchorPoint
        ? {
            left: anchorPoint.x,
            right: anchorPoint.x,
            top: anchorPoint.y,
            bottom: anchorPoint.y,
            width: 0,
            height: 0,
          }
        : trigger!.getBoundingClientRect();
      // Layout dimensions stay stable while the menu scales into view.
      const bounds = element.getBoundingClientRect();
      if (keyboard && trigger && !anchorPoint) {
        // Composer buttons move on a CSS transform. Read its endpoint once,
        // so placement can travel with the dock without measuring each frame.
        const dock = trigger.closest<HTMLElement>(".mobile-composer-dock, .mobile-assistant-compose-dock");
        const transition = dock?.getAnimations?.().find(animation =>
          (animation as CSSTransition).transitionProperty === "transform" &&
          (animation.playState === "running" || animation.pending));
        const keyframes = (transition?.effect as KeyframeEffect | null)?.getKeyframes();
        const endpoint = keyframes?.at(-1)?.transform;
        if (dock && transition && typeof endpoint === "string") {
          // A reversed CSS transition can be shorter than the native keyboard
          // event. Use the dock's remaining travel so their edges stay aligned.
          const end = transition.effect?.getComputedTiming().endTime;
          const time = typeof transition.currentTime === "number" ? transition.currentTime : 0;
          if (typeof end === "number" && Number.isFinite(end)) {
            travel = {
              duration: Math.max(0, (end - time) / Math.abs(transition.playbackRate || 1)),
              easing: keyframes?.[0]?.easing ?? keyboard.easing,
            };
          }
          const current = new DOMMatrixReadOnly(getComputedStyle(dock).transform);
          const target = new DOMMatrixReadOnly(endpoint);
          const dx = target.m41 - current.m41;
          const dy = target.m42 - current.m42;
          rect = {
            left: rect.left + dx, right: rect.right + dx,
            top: rect.top + dy, bottom: rect.bottom + dy,
            width: rect.width, height: rect.height,
          };
        }
      }
      const size = {
        width: element.offsetWidth || bounds.width,
        height: element.offsetHeight || bounds.height,
      };
      // Place inside the safe region, then translate back to the viewport.
      const viewportWidth =
        (viewport?.width ?? window.innerWidth) - insets.left - insets.right;
      const height =
        keyboardViewportHeight() - insets.top - insets.bottom;
      const offsetLeft = (viewport?.offsetLeft ?? 0) + insets.left;
      const offsetTop = (viewport?.offsetTop ?? 0) + insets.top;
      const clampY = (value: number) =>
        Math.max(16, Math.min(height - 16, value - offsetTop));
      const next = placePopover(
        {
          left: rect.left - offsetLeft,
          right: rect.right - offsetLeft,
          top: clampY(rect.top),
          bottom: clampY(overlapAnchor ? rect.top : rect.bottom),
          width: rect.width,
          height: rect.height,
        },
        { width: size.width, height: size.height },
        { width: viewportWidth, height },
        {
          width:
            constrainWidthToAnchor && !anchorPoint
              ? Math.min(width, rect.width)
              : width,
          side,
          align,
          gap: anchorPoint || overlapAnchor ? 0 : 8,
          padding: 16,
        },
      );
      const style: CSSProperties = {
        position: "fixed",
        left: next.left + offsetLeft,
        top: overlapAnchor
          ? Math.max(
              0,
              Math.min(rect.top - offsetTop, height - size.height - 16),
            ) + offsetTop
          : next.top == null
            ? undefined
            : next.top + offsetTop,
        bottom:
          overlapAnchor || next.bottom == null
            ? undefined
            : next.bottom + window.innerHeight - offsetTop - height,
        width: next.width,
        maxHeight: next.maxHeight,
        transformOrigin: `${align === "end" ? "right" : align === "center" ? "center" : "left"} ${next.side === "top" ? "bottom" : "top"}`,
      };
      element.dataset.anchorSide = next.side;
      const animateTravel = !reduced && !!travel?.duration && element.style.position === "fixed";
      const commitTravel = () => {
        for (const animation of keyboardAnimation) animation.stop();
        keyboardAnimation = [];
        if (!animateTravel || !travel) { anchorX.set(0); anchorY.set(0); return; }
        const targetTop = typeof style.top === "number" ? style.top :
          window.innerHeight - Number(style.bottom) - Math.min(size.height, next.maxHeight);
        // Position must be committed before adding this compensating offset;
        // otherwise the first frame adds it to the old position and jumps.
        anchorX.set(bounds.left - Number(style.left));
        anchorY.set(bounds.top - targetTop);
        const transition = travel.duration ? { ...popTransition, duration: travel.duration / 1000 } : immediateTransition;
        keyboardAnimation = [animateMotion(anchorX, 0, transition), animateMotion(anchorY, 0, transition)];
      };
      if (animateTravel) pendingKeyboardAnimation.current = commitTravel;
      else {
        pendingKeyboardAnimation.current = undefined;
        commitTravel();
      }
      setPosition((previous) =>
        !animateTravel && previous?.left === style.left &&
        previous?.top === style.top &&
        previous?.bottom === style.bottom &&
          previous?.width === style.width &&
          previous?.maxHeight === style.maxHeight &&
          previous?.transformOrigin === style.transformOrigin
          ? previous
          : style,
      );
    };
    let scheduled = false;
    let settlingKeyboard = !!keyboardMotionRemaining();
    let refreshAnimations = true;
    let anchorAnimations: Animation[] = [];
    const animationRemaining = () => {
      if (refreshAnimations) {
        refreshAnimations = false;
        anchorAnimations = [];
        for (let node: HTMLElement | null = trigger ?? null; node; node = node.parentElement)
          for (const animation of node.getAnimations?.() ?? [])
            if (canMoveAnchor(animation)) anchorAnimations.push(animation);
      }
      return anchorAnimations.some(animation => {
        const end = animation.effect?.getComputedTiming().endTime;
        return (animation.playState === "running" || animation.pending) && typeof end === "number" && Number.isFinite(end) && end > (typeof animation.currentTime === "number" ? animation.currentTime : 0);
      });
    };
    const tick = () => {
      scheduled = false;
      insets = safeInsets(element);
      place();
      if (trigger && !anchorPoint && animationRemaining()) {
        scheduled = true;
        frame.read(tick);
      } else if (anchorAnimations.length) {
        refreshAnimations = true;
        if (animationRemaining()) { scheduled = true; frame.read(tick); }
      }
    };
    const schedule = () => {
      refreshAnimations = true;
      if (!settlingKeyboard && !scheduled) { scheduled = true; frame.read(tick); }
    };
    const motionEvent = (event: Event) => {
      if (anchorPoint || !trigger || !(event.target instanceof Element) || !event.target.contains(trigger)) return;
      if (event.type.startsWith("transition") && isPaintOnlyProperty((event as TransitionEvent).propertyName ?? "")) return;
      schedule();
    };
    const motionEvents = ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"];
    for (const name of motionEvents) window.addEventListener(name, motionEvent, true);
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node && element.contains(event.target))) schedule();
    };
    const unsubscribe = onKeyboardMotion(motion => {
      cancelFrame(tick);
      scheduled = false;
      settlingKeyboard = !!motion.duration;
      insets = safeInsets(element);
      place(motion);
    });
    const stopSettled = onKeyboardSettled(() => { settlingKeyboard = false; schedule(); });
    const stopScrollX = scrollX.on("change", schedule);
    const stopScrollY = scrollY.on("change", schedule);
    place();
    if (!settlingKeyboard && trigger && !anchorPoint && animationRemaining()) { scheduled = true; frame.read(tick); }
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (trigger) observer.observe(trigger);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", scroll, true);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      pendingKeyboardAnimation.current = undefined;
      cancelFrame(tick);
      for (const name of motionEvents) window.removeEventListener(name, motionEvent, true);
      for (const animation of keyboardAnimation) animation.stop();
      stopSettled();
      stopScrollX();
      stopScrollY();
      unsubscribe();
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", scroll, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [
    active,
    placement,
    anchor,
    anchorPoint,
    width,
    align,
    side,
    overlapAnchor,
    constrainWidthToAnchor,
    reduced, anchorX, anchorY, scrollX, scrollY,
  ]);
  useLayoutEffect(() => {
    const animate = pendingKeyboardAnimation.current;
    pendingKeyboardAnimation.current = undefined;
    animate?.();
  }, [position]);
  useEffect(() => {
    if (placement !== "bottom" || active || dragClosing) return;
    const element = dialog.current;
    if (!element) return;
    const animation = animateMotion(drag.y, element.offsetHeight + motionGeometry.sheetExitGap,
      reduced ? { ...immediateTransition, onComplete: finish } : { ...popTransition, onComplete: finish });
    return () => animation.stop();
  }, [active, placement, dragClosing, drag.y, reduced, finish]);
  useEffect(() => {
    if (!active) return;
    const input = preserveFocus?.current;
    const keepInput = !!input && document.activeElement === input;
    const trigger = keepInput
      ? input
      : (anchor?.current ?? (document.activeElement as HTMLElement | null));
    if (!keepInput) dialog.current?.focus();
    return () => {
      if (trigger?.isConnected && !trigger.closest("[inert], [aria-hidden=\"true\"]") && document.activeElement !== trigger)
        trigger.focus({ preventScroll: true });
    };
  }, [active, anchor, preserveFocus]);
  const onKeyDown = useCallback(
    (event: {
      key: string;
      shiftKey: boolean;
      defaultPrevented: boolean;
      preventDefault: () => void;
    }) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        back();
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) ?? []),
      ].filter((element) => !element.closest('[inert], [aria-hidden="true"]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      const entering =
        document.activeElement === dialog.current ||
        document.activeElement === preserveFocus?.current;
      if (event.shiftKey && (document.activeElement === first || entering)) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || entering)
      ) {
        event.preventDefault();
        first.focus();
      }
    },
    [back, preserveFocus],
  );
  useEffect(() => {
    if (!active) return;
    const input = preserveFocus?.current;
    if (!input) return;
    // Pointer interaction keeps typing focus outside the sheet. Escape still
    // dismisses it, and an explicit Tab moves into its keyboard navigation.
    input.addEventListener("keydown", onKeyDown);
    return () => input.removeEventListener("keydown", onKeyDown);
  }, [active, preserveFocus, onKeyDown]);
  if (!visible || (!active && foldState === "closed")) return null;
  const content = (
    <SurfaceVisibilityContext.Provider value={active}>
    <div
      ref={backdrop}
      className="mobile-sheet-backdrop"
      style={{ zIndex: overlayLevel }}
      data-placement={placement}
      data-fold-state={foldState}
      inert={!active}
      aria-hidden={!active || undefined}
      onPointerDownCapture={(event) =>
        preserveInputFocus(event, preserveFocus?.current)
      }
      onMouseDownCapture={(event) =>
        preserveInputFocus(event, preserveFocus?.current)
      }
      onClick={active ? onClose : undefined}
    >
      {placement !== "anchor" && <motion.div
        className="mobile-sheet-scrim"
        aria-hidden="true"
        initial={reduced ? false : { opacity: 0 }}
        animate={placement === "bottom" ? undefined : { opacity: active ? 1 : 0 }}
        transition={reduced ? immediateTransition : popTransition}
        style={placement === "bottom" ? { opacity: draggedOpacity } : undefined}
      />}
      <motion.section
        initial={placement === "bottom" || reduced ? false : { transform: `scale(${motionGeometry.popScale})`, opacity: 0 }}
        animate={placement === "bottom" ? undefined
          : { transform: active || reduced ? "scale(1)" : `scale(${motionGeometry.popScale})`, opacity: active ? 1 : 0 }}
        transition={reduced ? immediateTransition : popTransition}
        onAnimationComplete={placement === "bottom" ? undefined : finish}
        drag={placement === "bottom" ? "y" : false}
        dragListener={false}
        dragMomentum={false}
        dragControls={drag.controls}
        onPointerDownCapture={placement === "bottom" ? drag.start : undefined}
        onDrag={drag.onDrag}
        onDragEnd={drag.onDragEnd}
        ref={dialog}
        className="mobile-sheet"
        data-detents={detents || undefined}
        data-surface={surface}
        style={{
          ...(placement === "anchor" ? (position ?? { visibility: "hidden" as const }) : placement === "dialog" ? { width } : {}),
          translate: placement === "anchor" ? anchorTranslate : undefined,
          y: placement === "bottom" ? drag.y : undefined,
        }}
        role="dialog"
        aria-modal={preserveFocus ? undefined : true}
        aria-label={t(title)}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {placement === "bottom" && (
          <div className="mobile-sheet-grip" aria-hidden="true" />
        )}
        {header && (
          <MobileSheetHeader {...header} onBack={onBack} onClose={onClose} />
        )}
        <div className="mobile-sheet-content">
          {placement === "dialog" && (
            <h2 className="mobile-sheet-title">{t(title)}</h2>
          )}
          {onBack && !header && (
            <button
              type="button"
              className="mobile-sheet-row mobile-sheet-back"
              aria-label={t("Back")}
              onClick={onBack}
            >
              <ArrowLeft size={20} />
              <span>{t("Back")}</span>
            </button>
          )}
          {typeof children === "function" ? children() : children}
        </div>
      </motion.section>
    </div>
    </SurfaceVisibilityContext.Provider>
  );
  return overlayHost ? createPortal(content, overlayHost) : content;
}
