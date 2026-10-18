import { useLayoutEffect, useRef, type ReactNode } from "react";
import { motion, animate, useMotionValue } from "motion/react";
import { motionDistance, msgTransition } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";

/** Only messages received while this surface is visible get an entrance. */
export function useMessageArrivals(
  entries: readonly { id: string }[],
  visible: boolean,
  animateFrom?: string,
  history?: readonly { id: string }[],
) {
  const seen = useRef(new Set<string>());
  const seeded = useRef(false);
  // An empty loading frame is not the history baseline. Match text reveal by
  // seeding the first populated snapshot, except output after an explicit send.
  if (!seeded.current && entries.length > 0) {
    const start = animateFrom ? entries.findIndex(entry => entry.id === animateFrom) : -1;
    seen.current = new Set((start < 0 ? entries : entries.slice(0, start + 1)).map(entry => entry.id));
    seeded.current = true;
  }
  const wasVisible = useRef(visible);
  if (!visible || !wasVisible.current)
    for (const entry of entries) seen.current.add(entry.id);
  for (const entry of history ?? []) seen.current.add(entry.id);
  useLayoutEffect(() => {
    for (const entry of entries) seen.current.add(entry.id);
    wasVisible.current = visible;
  });
  return (id: string) => !seen.current!.has(id);
}

/**
 * Messages enter once. Later moves (streaming, reflow, a sibling pane
 * closing) are not animated, so settled messages never slide up again.
 */
export function TranscriptContentMotion({
  arrive = false, as = "div", className, children,
}: { arrive?: boolean; as?: "div" | "li"; className?: string; children: ReactNode }) {
  const visible = useSurfaceVisibility();
  const reduced = useMotionPreference();
  const initialArrival = useRef(arrive && visible && !reduced);
  const opacity = useMotionValue(initialArrival.current ? 0 : 1);
  const y = useMotionValue(initialArrival.current ? motionDistance.msg : 0);
  useLayoutEffect(() => {
    if (!initialArrival.current) return;
    if (reduced || !visible) { opacity.jump(1); y.jump(0); return; }
    const fade = animate(opacity, 1, msgTransition);
    const rise = animate(y, 0, msgTransition);
    return () => { fade.stop(); rise.stop(); };
  }, [opacity, y, reduced, visible]);
  const Container = as === "li" ? motion.li : motion.div;
  return <Container
    initial={false}
    style={{ opacity, y }}
    className={className} data-transcript-content-motion
  >{children}</Container>;
}
