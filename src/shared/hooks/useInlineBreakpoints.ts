import { useCallback, useRef } from "react";

/** Classify a content box only at breakpoints, without size-query invalidation
 * or a React update for every pixel of a panel resize. */
export function useInlineBreakpoints(
  breakpoints: readonly number[],
  unit: "px" | "rem" = "px",
  enabled = true,
) {
  const stop = useRef<(() => void) | undefined>(undefined);
  return useCallback((element: HTMLElement | null) => {
    stop.current?.();
    stop.current = undefined;
    if (!element || !enabled) return;
    const view = element.ownerDocument.defaultView!;
    const scale = unit === "rem"
      ? parseFloat(view.getComputedStyle(element.ownerDocument.documentElement).fontSize) || 16
      : 1;
    let active = true;
    const update = (width: number) => {
      if (!active || width <= 0) return;
      const below = breakpoints.filter(point => width < point * scale).join(" ");
      const atLeast = breakpoints.filter(point => width >= point * scale).join(" ");
      if (element.getAttribute("data-inline-below") !== below) element.setAttribute("data-inline-below", below);
      if (element.getAttribute("data-inline-at-least") !== atLeast) element.setAttribute("data-inline-at-least", atLeast);
    };
    const style = view.getComputedStyle(element);
    update(element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    stop.current = () => {
      active = false;
      observer.disconnect();
      element.removeAttribute("data-inline-below");
      element.removeAttribute("data-inline-at-least");
    };
  }, [breakpoints, enabled, unit]);
}
