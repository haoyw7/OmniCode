import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion as motionElement, usePresence, useMotionValue } from "motion/react";
import { collapseTransition, duration, immediateTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "./SurfaceVisibility";

const RetainedCollapseContent = memo(
  function RetainedCollapseContent({ children }: {
    visible: boolean;
    children: ReactNode | (() => ReactNode);
  }) {
    return typeof children === "function" ? children() : children;
  },
  (previous, next) => previous.visible === next.visible &&
    (!next.visible || previous.children === next.children),
);

const NESTED_FOLD_MOTION = '[data-fold-state="opening"], [data-fold-state="closing"]';

/** Shared Motion lifetime for disclosures and grid-sized panels. */
export function useCollapseMotion(expanded: boolean, durationMs = duration.collapse * 1000) {
  const reduced = useMotionPreference();
  const progress = useMotionValue(expanded ? 1 : 0);
  const [foldState, setFoldState] = useState<"open" | "opening" | "closing" | "closed">(
    expanded ? "open" : "closed",
  );
  const latest = useRef(expanded);
  latest.current = expanded;
  const previous = useRef(expanded);
  const finish = useCallback(() => {
    progress.jump(latest.current ? 1 : 0);
    setFoldState(latest.current ? "open" : "closed");
  }, [progress]);
  const restart = useCallback((_milliseconds = durationMs) => {
    if (reduced) finish();
    else setFoldState(latest.current ? "opening" : "closing");
  }, [durationMs, reduced, finish]);
  useLayoutEffect(() => {
    if (reduced) { finish(); previous.current = expanded; return; }
    if (previous.current === expanded) return;
    previous.current = expanded;
    setFoldState(expanded ? "opening" : "closing");
  }, [expanded, reduced, finish]);
  return {
    foldState, finish, restart, progress,
    motionProps: {
      initial: false as const,
      transition: reduced ? immediateTransition : { ...collapseTransition, duration: durationMs / 1000 },
      onAnimationComplete: finish,
    },
  };
}

type CollapseProps = {
  expanded: boolean;
  ready?: boolean;
  className?: string;
  durationMs?: number;
  motion?: "grid" | "height";
  animateContentResize?: boolean;
  keepMounted?: boolean;
  onEntered?: () => void;
  children: ReactNode | (() => ReactNode);
};

export function AnimatedCollapse({
  expanded: requestedExpanded, ready = true, className, durationMs, animateContentResize = false,
  keepMounted = false, onEntered, children,
}: CollapseProps) {
  const expanded = requestedExpanded && ready;
  const parentVisible = useSurfaceVisibility();
  const reduced = useMotionPreference();
  const lifetime = useCollapseMotion(expanded, durationMs);
  const hasOpened = useRef(expanded);
  const entered = useRef(expanded);
  if (expanded) hasOpened.current = true;
  useEffect(() => {
    if (!expanded) entered.current = false;
    else if (lifetime.foldState === "open" && !entered.current) {
      entered.current = true;
      onEntered?.();
    }
  }, [expanded, lifetime.foldState, onEntered]);
  const retained = keepMounted && hasOpened.current;
  const content = (requestedExpanded || retained) && (
        <CollapseBody
          key="collapse"
          expanded={expanded}
          className={className}
          keepMounted={keepMounted}
          parentVisible={parentVisible}
          hidden={!requestedExpanded && lifetime.foldState === "closed"}
          foldState={lifetime.foldState}
          reduced={reduced}
          durationMs={durationMs}
          animateContentResize={animateContentResize}
          finish={lifetime.finish}
          restart={lifetime.restart}
        >{children}</CollapseBody>
      );
  return (
    <AnimatePresence onExitComplete={lifetime.finish}>{content}</AnimatePresence>
  );
}

function CollapseBody({
  expanded, className, keepMounted, parentVisible, hidden, foldState,
  durationMs, animateContentResize, finish, restart, children,
}: Omit<CollapseProps, "onEntered" | "motion"> & {
  parentVisible: boolean; hidden: boolean;
  foldState: "open" | "opening" | "closing" | "closed";
  reduced: boolean; finish: () => void; restart: () => void;
}) {
  const [present, safeToRemove] = usePresence();
  const reduced = useMotionPreference();
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const measuredHeight = useRef<number>(undefined);
  // Motion resolves an `auto` origin by briefly rendering the 0 target, which
  // clamps an enclosing scroller (it only restores window scroll). Close from
  // the height on screen, read once as the fold starts closing.
  const closing = !expanded || !present;
  const wasClosing = useRef(closing);
  const closeFrom = useRef<number>(undefined);
  if (!closing) closeFrom.current = undefined;
  else if (!wasClosing.current)
    closeFrom.current = bodyRef.current?.getBoundingClientRect().height || undefined;
  wasClosing.current = closing;
  const collapsed = closeFrom.current === undefined ? 0 : [closeFrom.current, 0];
  const [resize, setResize] = useState<{ height: number; follow: boolean; from?: number }>();
  const latestFoldState = useRef(foldState);
  latestFoldState.current = foldState;
  const following = useRef(false);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!animateContentResize || !content || hidden || !parentVisible) return;
    const updateHeight = (height: number) => {
      const previous = measuredHeight.current;
      if (previous === height) return;
      const settled = previous !== undefined && expanded;
      measuredHeight.current = height;
      // A nested fold already animates this change: let the height follow the
      // content. Restarting a tween on every step stalls until it finishes.
      if (settled && latestFoldState.current === "open" && content.querySelector(NESTED_FOLD_MOTION)) {
        if (bodyRef.current) bodyRef.current.style.height = "auto";
        following.current = true;
        setResize((current) => current?.follow ? current : { height, follow: true });
        return;
      }
      if (settled) restart();
      // Leaving `auto`, hold the previous height for this frame and start from
      // it instead of letting Motion measure (see `collapsed`).
      const from = following.current ? previous : undefined;
      following.current = false;
      if (from !== undefined && bodyRef.current) bodyRef.current.style.height = `${from}px`;
      setResize({ height, follow: false, from });
    };
    updateHeight(content.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [animateContentResize, hidden, parentVisible, expanded, restart]);
  useLayoutEffect(() => {
    if (reduced && !present) { safeToRemove?.(); finish(); }
  }, [reduced, present, safeToRemove, finish]);
  const visible = expanded && present && parentVisible;
  const followContent = !!resize?.follow && expanded && present && foldState === "open";
  // While following, the latest height lives in the ref; state only marks the mode.
  const contentHeight = resize?.follow ? measuredHeight.current : resize?.height;
  const resized = followContent
    ? "auto"
    : resize?.from !== undefined && contentHeight !== undefined
      ? [resize.from, contentHeight]
      : contentHeight ?? "auto";
  if (reduced && !present) return null;
  return (
    <motionElement.div
      ref={bodyRef}
      data-collapse-motion="height"
      className={`zen-fold-item${className ? ` ${className}` : ""}`}
      data-fold-state={present ? foldState : "closing"}
      initial={reduced || foldState === "open" ? false : { height: 0 }}
      animate={{ height: expanded ? (animateContentResize ? resized : "auto") : collapsed }}
      exit={{ height: collapsed }}
      transition={reduced || followContent ? immediateTransition : {
        ...collapseTransition,
        ...(durationMs === undefined ? undefined : { duration: durationMs / 1000 }),
      }}
      style={{ overflow: expanded && present && foldState === "open" ? undefined : "hidden", display: hidden ? "none" : undefined }}
      hidden={hidden}
      aria-hidden={!visible || undefined}
      inert={!visible}
      onAnimationComplete={() => {
        finish();
        if (!present) safeToRemove?.();
        setResize((current) => current?.from === undefined ? current : { ...current, from: undefined });
      }}
    >
      <div ref={contentRef}>
        <SurfaceVisibilityContext.Provider value={visible}>
          {keepMounted ? (
            <RetainedCollapseContent visible={visible}>{children}</RetainedCollapseContent>
          ) : typeof children === "function" ? children() : children}
        </SurfaceVisibilityContext.Provider>
      </div>
    </motionElement.div>
  );
}
