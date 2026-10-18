import {
  cloneElement,
  isValidElement,
  useLayoutEffect,
  type ReactElement,
} from "react";
import { usePresence } from "motion/react";
import { useMotionPreference } from "../../motion/useMotionPreference";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../SurfaceVisibility";

type Surface = ReactElement<{
  inert?: boolean;
  "aria-hidden"?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}>;

export function MotionPresenceItem({ children }: { children: Surface }) {
  const [present, safeToRemove] = usePresence();
  const reduced = useMotionPreference();
  const visible = useSurfaceVisibility();
  useLayoutEffect(() => {
    if (!present && (reduced || !visible)) safeToRemove?.();
  }, [present, reduced, visible, safeToRemove]);
  if (!visible || (!present && reduced)) return null;
  const content = children.props.children;
  const animated = isValidElement<{
    onAnimationComplete?: (...args: any[]) => void;
  }>(content)
    ? cloneElement(content, {
        onAnimationComplete: (...args: any[]) => {
          content.props.onAnimationComplete?.(...args);
          if (!present) safeToRemove?.();
        },
      })
    : content;
  return (
    <SurfaceVisibilityContext.Provider value={present && visible}>
      {cloneElement(children, {
        inert: !present || !visible,
        "aria-hidden": !present || !visible || undefined,
        style: {
          ...children.props.style,
          ...(!present ? { pointerEvents: "none" } : undefined),
        },
        children: animated,
      })}
    </SurfaceVisibilityContext.Provider>
  );
}
