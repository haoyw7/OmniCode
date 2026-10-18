import { AnimatePresence, useIsPresent } from "motion/react";
import { Children, cloneElement, isValidElement, useMemo, useState, type ComponentProps } from "react";

type Props = ComponentProps<typeof AnimatePresence>;

/** Animate an existing conditional lifetime without reusing state after it closes. */
export function PresenceBoundary({ children, propagate = true, ...props }: Props) {
  const parentPresent = useIsPresent();
  const elements = useMemo(() => Children.toArray(children).filter(isValidElement), [children]);
  const present = parentPresent && elements.length > 0;
  const [lifetime, setLifetime] = useState({ present, generation: 0 });
  let generation = lifetime.generation;
  if (present !== lifetime.present) {
    generation += present ? 1 : 0;
    setLifetime({ present, generation });
  }
  const keyedChildren = useMemo(() => elements.map((child, index) => cloneElement(child, {
    key: `${child.key ?? index}:${generation}`,
  })), [elements, generation]);
  return <AnimatePresence {...props} propagate={propagate}>{parentPresent ? keyedChildren : null}</AnimatePresence>;
}
