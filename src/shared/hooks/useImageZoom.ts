import { animate as animateValue, cancelFrame, frame, type AnimationPlaybackControls } from "motion/react";
import { popTransition } from "../motion/tokens";
import {
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { reducedMotionQuery } from "../lib/reducedMotion";

type Point = { x: number; y: number };
type View = Point & { scale: number };
type Gesture = { center: Point; distance: number; view: View };
type Geometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
};
const FIT: View = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 5;
const TAP_DISTANCE = 8;
const DOUBLE_TAP_MS = 300;

/** Zoom only the image, leaving the surrounding dialog and system bars fixed. */
export function useImageZoom(src: string, visible: boolean) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const current = useRef(FIT);
  const geometry = useRef<Geometry | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const capture = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const ignoreClick = useRef(false);
  const startedOnImage = useRef(false);
  const lastPointerType = useRef("");
  const tapStart = useRef<{ point: Point; time: number } | null>(null);
  const lastTap = useRef<{ point: Point; time: number } | null>(null);
  const animation = useRef<AnimationPlaybackControls | null>(null);

  // Measure at mount, resize and gesture start, never while fingers move.
  const measure = () => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return;
    const rect = stage.getBoundingClientRect();
    const style = getComputedStyle(image);
    geometry.current = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      imageWidth: parseFloat(style.width) || image.offsetWidth,
      imageHeight: parseFloat(style.height) || image.offsetHeight,
    };
  };
  const localPoint = (point: Point): Point => {
    const rect = geometry.current!;
    return {
      x: point.x - rect.left - rect.width / 2,
      y: point.y - rect.top - rect.height / 2,
    };
  };
  const constrain = (next: View): View => {
    const rect = geometry.current;
    const scale = Math.max(1, Math.min(MAX_SCALE, next.scale));
    if (scale === 1) return FIT;
    const maxX = Math.max(
      0,
      ((rect?.imageWidth ?? 0) * scale - (rect?.width ?? 0)) / 2,
    );
    const maxY = Math.max(
      0,
      ((rect?.imageHeight ?? 0) * scale - (rect?.height ?? 0)) / 2,
    );
    return {
      scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  };
  const paint = () => {
    const image = imageRef.current;
    if (!image) return;
    const { x, y, scale } = current.current;
    image.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    image.style.cursor =
      scale > 1 ? (pointers.current.size ? "grabbing" : "grab") : "zoom-in";
  };
  const schedule = () => frame.render(paint);
  const stopMotion = () => {
    animation.current?.stop();
    animation.current = null;
    cancelFrame(paint);
  };
  const apply = (next: View, animated = false) => {
    const bounded = constrain(next);
    stopMotion();
    if (animated && !reducedMotionQuery().matches) {
      const from = current.current;
      animation.current = animateValue(0, 1, {
        ...popTransition,
        onUpdate: (progress) => {
          current.current = {
            scale: from.scale + (bounded.scale - from.scale) * progress,
            x: from.x + (bounded.x - from.x) * progress,
            y: from.y + (bounded.y - from.y) * progress,
          };
          paint();
        },
        onComplete: () => {
          current.current = bounded;
          animation.current = null;
          paint();
        },
      });
    } else {
      current.current = bounded;
      schedule();
    }
  };
  const snapshot = (): Gesture | null => {
    const [first, second] = [...pointers.current.values()];
    if (!first || !geometry.current) return null;
    return {
      center: localPoint(
        second
          ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
          : first,
      ),
      distance: second ? Math.hypot(second.x - first.x, second.y - first.y) : 0,
      view: current.current,
    };
  };
  const zoomAt = (point: Point) => {
    const previous = current.current;
    const scale = previous.scale > 1 ? 1 : 2.5;
    const ratio = scale / previous.scale;
    apply(
      {
        scale,
        x: point.x - (point.x - previous.x) * ratio,
        y: point.y - (point.y - previous.y) * ratio,
      },
      true,
    );
  };

  useLayoutEffect(() => {
    stopMotion();
    pointers.current.clear();
    gesture.current = null;
    tapStart.current = lastTap.current = null;
    ignoreClick.current = startedOnImage.current = false;
    lastPointerType.current = "";
    current.current = FIT;
    geometry.current = null;
    paint();
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!visible || !stage || !image) return;
    measure();
    const resize = () => {
      measure();
      apply(current.current);
      gesture.current = snapshot();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    observer.observe(image);
    const wheel = (event: WheelEvent) => {
      if (!geometry.current || pointers.current.size) return;
      event.preventDefault();
      event.stopPropagation();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? geometry.current.height
            : 1);
      const previous = current.current;
      const scale = Math.max(
        1,
        Math.min(MAX_SCALE, previous.scale * Math.exp(-delta * 0.002)),
      );
      const ratio = scale / previous.scale;
      const point = localPoint({ x: event.clientX, y: event.clientY });
      apply({
        scale,
        x: point.x - (point.x - previous.x) * ratio,
        y: point.y - (point.y - previous.y) * ratio,
      });
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => {
      stopMotion();
      observer.disconnect();
      stage.removeEventListener("wheel", wheel);
      const ids = [...pointers.current.keys()];
      pointers.current.clear();
      gesture.current = null;
      for (const id of ids)
        if (capture.current?.hasPointerCapture?.(id))
          capture.current.releasePointerCapture(id);
      capture.current = null;
    };
  }, [src, visible]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button"))
    )
      return;
    event.preventDefault();
    // Interrupt a double-tap from its visible frame, without jumping to its target.
    stopMotion();
    measure();
    if (!geometry.current) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.current.size) {
      ignoreClick.current = false;
      startedOnImage.current = event.target === imageRef.current;
      tapStart.current = { point, time: event.timeStamp };
    }
    lastPointerType.current = event.pointerType;
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1) {
      ignoreClick.current = true;
      tapStart.current = lastTap.current = null;
    }
    gesture.current = snapshot();
    capture.current = event.currentTarget;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    paint();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = gesture.current;
    if (!origin || !pointers.current.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (!ignoreClick.current && tapStart.current) {
      if (
        Math.hypot(
          point.x - tapStart.current.point.x,
          point.y - tapStart.current.point.y,
        ) <= TAP_DISTANCE
      )
        return;
      ignoreClick.current = true;
      lastTap.current = null;
    }
    const next = snapshot()!;
    const scale =
      origin.distance > 0
        ? Math.max(
            1,
            Math.min(
              MAX_SCALE,
              (origin.view.scale * next.distance) / origin.distance,
            ),
          )
        : origin.view.scale;
    const ratio = scale / origin.view.scale;
    apply({
      scale,
      x: next.center.x - (origin.center.x - origin.view.x) * ratio,
      y: next.center.y - (origin.center.y - origin.view.y) * ratio,
    });
    // Rebase at the clamped position so reversing at any edge responds immediately.
    gesture.current = snapshot();
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!pointers.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    const start = tapStart.current;
    if (
      event.type === "pointerup" &&
      event.pointerType === "touch" &&
      startedOnImage.current &&
      !ignoreClick.current &&
      start &&
      event.timeStamp - start.time <= DOUBLE_TAP_MS &&
      Math.hypot(point.x - start.point.x, point.y - start.point.y) <=
        TAP_DISTANCE
    ) {
      const previous = lastTap.current;
      if (
        previous &&
        event.timeStamp - previous.time <= DOUBLE_TAP_MS &&
        Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= 24
      ) {
        zoomAt(localPoint(point));
        ignoreClick.current = true;
        lastTap.current = null;
      } else lastTap.current = { point, time: event.timeStamp };
    } else lastTap.current = null;
    if (event.type !== "pointerup") ignoreClick.current = true;
    tapStart.current = null;
    pointers.current.delete(event.pointerId);
    // Rebase when one finger lifts, so continued dragging cannot jump.
    gesture.current = snapshot();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    schedule();
  };
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (
      lastPointerType.current === "touch" ||
      !geometry.current ||
      !(startedOnImage.current || event.target === imageRef.current)
    )
      return;
    event.preventDefault();
    zoomAt(localPoint({ x: event.clientX, y: event.clientY }));
  };

  return {
    stageRef,
    imageRef,
    shouldIgnoreBackdropClick: () =>
      ignoreClick.current || startedOnImage.current,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onLostPointerCapture: onPointerEnd,
    onDoubleClick,
  };
}
