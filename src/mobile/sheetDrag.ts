import { useLayoutEffect, useRef, type RefObject, type PointerEvent as ReactPointerEvent } from "react";
import { animate, frame, cancelFrame, useDragControls, useMotionValue, useTransform, type AnimationPlaybackControls, type PanInfo } from "motion/react";
import { duration, motionGeometry, popTransition, springs } from "../shared/motion/tokens";
import { useMotionPreference } from "../shared/motion/useMotionPreference";

/** Pull distance, as a share of the sheet height, that dismisses on release. */
const DISMISS_SHARE = 0.28;
/** Fling speed in px/ms that steps down or dismisses regardless of distance. */
const DISMISS_VELOCITY = 0.55;
/** Movement before a press counts as a drag rather than a tap or scroll. */
const SLOP_PX = 6;
/** Keep in sync with mobile-sheet animations in styles/08-sheets.css. */
export const SHEET_MOTION_MS = duration.pop * 1000;
export const SHEET_CLOSE_MS = duration.pop * 1000;

/** Share of the screen a two-stop sheet shows before it is pulled up. */
export const SHEET_HALF_SHARE = 0.5;

export type SheetDetent = "half" | "full";

/**
 * Where a two-stop sheet settles when released with its top `top` px below the
 * full-height position: an upward fling expands, a downward fling steps from
 * full to half or dismisses from half, and a slow release picks the nearest
 * stop or closes below the half stop.
 */
export function settleDetent(
  top: number,
  velocity: number,
  halfTop: number,
  halfHeight: number,
  from: SheetDetent,
): SheetDetent | "dismiss" {
  if (velocity < -DISMISS_VELOCITY) return "full";
  if (velocity > DISMISS_VELOCITY) return from === "full" ? "half" : "dismiss";
  if (top > halfTop + halfHeight * DISMISS_SHARE) return "dismiss";
  return top < halfTop / 2 ? "full" : "half";
}

/** The gesture decisions stay pure; Motion owns visual travel and lifetime. */
export function useSheetDrag(
  sheet: RefObject<HTMLElement | null>,
  enabled: boolean,
  onClose: () => void,
  onDismissStart?: () => void,
  detents = false,
  onMotionComplete?: () => void,
) {
  const reduced = useMotionPreference();
  const controls = useDragControls();
  const y = useMotionValue(0);
  const sheetHeight = useMotionValue(1);
  const lowestTop = useMotionValue(0);
  const opacity = useTransform(() => {
    const below = y.get() - lowestTop.get();
    return below > 0 ? Math.max(0.35, 1 - below / (sheetHeight.get() * 1.4)) : 1;
  });
  const current = useRef({ onClose, onDismissStart, enabled, reduced, onMotionComplete });
  current.current = { onClose, onDismissStart, enabled, reduced, onMotionComplete };
  const release = useRef<AnimationPlaybackControls | undefined>(undefined);
  const initialized = useRef<HTMLElement | null>(null);
  const geometry = useRef({ height: 0, halfHeight: 0, halfTop: 0, detent: "half" as SheetDetent, fitExpanded: false, contentExpanded: false, closing: false });
  const stopWatching = useRef<(() => void) | undefined>(undefined);
  const prepareContent = () => {
    const element = sheet.current, state = geometry.current;
    if (element && detents && y.get() < state.halfTop && !state.contentExpanded) {
      state.contentExpanded = true;
      element.style.setProperty("--mobile-sheet-content-offset", "0px");
    }
  };
  const watchGeometry = () => {
    stopWatching.current?.();
    const element = sheet.current;
    if (!element) return;
    const state = geometry.current;
    let viewportHeight = window.innerHeight;
    const refresh = () => {
      state.height = element.offsetHeight;
      if (detents) state.halfHeight = Math.round(window.innerHeight * SHEET_HALF_SHARE);
      else if (!state.fitExpanded) state.halfHeight = state.height;
      state.halfTop = Math.max(0, state.height - state.halfHeight);
      sheetHeight.set(Math.max(1, state.height));
      lowestTop.set(state.halfTop);
      prepareContent();
    };
    const resized = () => {
      if (viewportHeight === window.innerHeight) return;
      viewportHeight = window.innerHeight;
      frame.read(refresh);
    };
    let contentHeight: number | undefined;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(entries => {
      const entry = entries.find(item => item.target === element);
      if (!entry) return;
      const borderHeight = entry.borderBoxSize?.[0]?.blockSize;
      if (borderHeight !== undefined ? Math.round(borderHeight) === state.height : entry.contentRect.height === contentHeight) return;
      contentHeight = entry.contentRect.height;
      frame.read(refresh);
    });
    observer?.observe(element, { box: "border-box" });
    window.addEventListener("resize", resized);
    window.visualViewport?.addEventListener("resize", resized);
    stopWatching.current = () => {
      cancelFrame(refresh);
      observer?.disconnect();
      window.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("resize", resized);
      stopWatching.current = undefined;
    };
  };
  useLayoutEffect(() => {
    const element = sheet.current;
    if (!element || !enabled) return;
    const state = geometry.current;
    state.closing = false;
    if (initialized.current !== element) {
      initialized.current = element;
      state.detent = "half";
      state.fitExpanded = false;
      state.contentExpanded = false;
      delete element.dataset.expanded;
      element.style.removeProperty("--mobile-sheet-content-offset");
      state.height = element.offsetHeight;
      state.halfHeight = detents ? Math.round(window.innerHeight * SHEET_HALF_SHARE) : state.height;
      state.halfTop = detents ? Math.max(0, state.height - state.halfHeight) : 0;
      if (detents) element.dataset.detent = state.detent;
      sheetHeight.set(Math.max(1, state.height));
      lowestTop.set(state.halfTop);
      y.set(state.height + motionGeometry.sheetExitGap);
      element.style.transform = `translateY(${state.height + motionGeometry.sheetExitGap}px)`;
    }
    const target = state.detent === "full" ? 0 : state.halfTop;
    if (reduced) {
      y.set(target);
      element.style.transform = target ? `translateY(${target}px)` : "none";
      current.current.onMotionComplete?.();
    }
    else {
      release.current = animate(y, target, { ...popTransition, onComplete: () => current.current.onMotionComplete?.() });
    }
    return () => { stopWatching.current?.(); controls.cancel(); release.current?.stop(); };
  }, [sheet, enabled, detents, controls, y, sheetHeight, lowestTop, reduced]);
  const start = (event: ReactPointerEvent<HTMLElement>) => {
    const element = sheet.current;
    const target = event.target;
    const state = geometry.current;
    if (!element || !enabled || state.closing || !(target instanceof Element) || target.closest(".mobile-sheet") !== element) return;
    const grip = !!target.closest(".mobile-sheet-grip");
    if (!grip && (event.pointerType !== "touch" || target.closest("button, a, input, textarea, select, [contenteditable]") || !target.closest(".mobile-sheet-header"))) return;
    const settling = y.isAnimating();
    release.current?.stop();
    const previousTop = state.detent === "half" ? state.halfTop : 0;
    state.height = element.offsetHeight;
    state.halfHeight = detents ? Math.round(window.innerHeight * SHEET_HALF_SHARE) : state.fitExpanded ? state.halfHeight : state.height;
    state.halfTop = detents || state.fitExpanded ? Math.max(0, state.height - state.halfHeight) : 0;
    if (!settling) y.set(y.get() + (state.detent === "half" ? state.halfTop : 0) - previousTop);
    // Prepare a full-size fit sheet once. Its offset preserves the visible rest
    // position and the Motion drag origin before the pointer session starts.
    if (!detents && !state.fitExpanded && state.detent === "half") {
      const restHeight = state.height;
      state.fitExpanded = true;
      element.dataset.expanded = "true";
      state.height = element.offsetHeight;
      state.halfHeight = restHeight;
      state.halfTop = Math.max(0, state.height - restHeight);
      y.set(y.get() + state.halfTop);
    }
    sheetHeight.set(Math.max(1, state.height));
    lowestTop.set(state.halfTop);
    watchGeometry();
    controls.start(event, { distanceThreshold: SLOP_PX });
  };
  const onDrag = (_: PointerEvent, info: PanInfo) => {
    const element = sheet.current;
    const state = geometry.current;
    if (!element) return;
    if (state.detent === "full" && info.offset.y < -SLOP_PX) {
      stopWatching.current?.();
      controls.cancel();
      y.set(0);
      return;
    }
    prepareContent();
  };
  const settle = (cancelled: boolean, velocity: number, fromContent = false) => {
    const element = sheet.current;
    const state = geometry.current;
    if (!element || !current.current.enabled) return;
    stopWatching.current?.();
    y.stop();
    const settled = cancelled ? state.detent
      : settleDetent(y.get(), velocity / 1000, state.halfTop, state.halfHeight, state.detent);
    if (settled === "dismiss") {
      state.closing = true;
      current.current.onDismissStart?.();
    } else {
      state.detent = settled;
      if (detents) element.dataset.detent = settled;
    }
    const target = settled === "dismiss" ? state.height + motionGeometry.sheetExitGap : settled === "full" ? 0 : state.halfTop;
    const finish = () => {
      current.current.onMotionComplete?.();
      if (settled === "dismiss") current.current.onClose();
      else if (settled === "half") {
        state.contentExpanded = false;
        element.style.removeProperty("--mobile-sheet-content-offset");
        if (state.fitExpanded) {
          state.fitExpanded = false;
          delete element.dataset.expanded;
          state.halfTop = 0;
          lowestTop.set(0);
          y.set(0);
        }
      }
    };
    if (current.current.reduced) { y.set(target); finish(); }
    else release.current = animate(y, target, {
      ...(settled === "dismiss" || fromContent ? popTransition : { ...springs.sheet, velocity }),
      onComplete: finish,
    });
  };
  const onDragEnd = (event: PointerEvent, info: PanInfo) => settle(event.type === "pointercancel", info.velocity.y);

  useLayoutEffect(() => {
    const element = sheet.current;
    if (!element || !enabled || !detents) return;
    let gesture: {
      id: number; x: number; y: number; origin: number; claimed: boolean;
      scrollables: HTMLElement[]; samples: { y: number; time: number }[];
    } | undefined;
    let suppressClick = false;
    const cancel = () => {
      const claimed = gesture?.claimed;
      gesture = undefined;
      if (claimed) settle(true, 0, true);
    };
    const touchStart = (event: TouchEvent) => {
      suppressClick = false;
      if (event.touches.length !== 1) { cancel(); return; }
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".mobile-sheet") !== element ||
        target.closest(".mobile-sheet-grip, .mobile-sheet-header, input, textarea, select, [contenteditable]")) return;
      if (geometry.current.closing || target.closest('[inert], [aria-hidden="true"]')) return;
      const scrollables: HTMLElement[] = [];
      for (let node = target as HTMLElement; node && node !== element; node = node.parentElement!) {
        if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) scrollables.push(node);
      }
      const touch = event.touches[0];
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, origin: y.get(), claimed: false,
        scrollables, samples: [{ y: touch.clientY, time: event.timeStamp }] };
    };
    const touchMove = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) { cancel(); return; }
      const touch = Array.from(event.touches).find(item => item.identifier === gesture!.id);
      if (!touch) return;
      const distance = touch.clientY - gesture.y;
      if (!gesture.claimed) {
        if (Math.max(Math.abs(distance), Math.abs(touch.clientX - gesture.x)) < SLOP_PX) return;
        if (Math.abs(touch.clientX - gesture.x) >= Math.abs(distance) ||
          (distance < 0 && geometry.current.detent === "full" && y.get() <= 0) ||
          (distance > 0 && gesture.scrollables.some(node => node.scrollTop > 0)) || !event.cancelable) {
          gesture = undefined;
          return;
        }
        release.current?.stop();
        gesture.origin = y.get();
        gesture.claimed = true;
        suppressClick = true;
        watchGeometry();
      }
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault();
      y.set(Math.max(0, gesture.origin + distance));
      prepareContent();
      gesture.samples.push({ y: touch.clientY, time: event.timeStamp });
      gesture.samples = gesture.samples.filter(sample => event.timeStamp - sample.time <= 100);
    };
    const touchEnd = (event: TouchEvent) => {
      const ended = gesture;
      if (!ended) return;
      if (event.touches.length) { cancel(); return; }
      gesture = undefined;
      if (!ended.claimed) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === ended.id);
      const sample = ended.samples.find(item => event.timeStamp - item.time <= 100);
      const elapsed = sample ? event.timeStamp - sample.time : 0;
      const velocity = sample && touch && elapsed > 0 ? (touch.clientY - sample.y) * 1000 / elapsed : 0;
      settle(event.type === "touchcancel", velocity, true);
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const allowClick = () => { suppressClick = false; };
    element.addEventListener("pointerdown", allowClick);
    element.addEventListener("touchstart", touchStart, { passive: true });
    element.addEventListener("touchmove", touchMove, { passive: false });
    element.addEventListener("touchend", touchEnd);
    element.addEventListener("touchcancel", touchEnd);
    element.addEventListener("click", click, true);
    window.addEventListener("blur", cancel);
    return () => {
      gesture = undefined;
      stopWatching.current?.();
      element.removeEventListener("pointerdown", allowClick);
      element.removeEventListener("touchstart", touchStart);
      element.removeEventListener("touchmove", touchMove);
      element.removeEventListener("touchend", touchEnd);
      element.removeEventListener("touchcancel", touchEnd);
      element.removeEventListener("click", click, true);
      window.removeEventListener("blur", cancel);
    };
  }, [sheet, enabled, detents]);
  return { y, opacity, start, controls, onDrag, onDragEnd };
}
