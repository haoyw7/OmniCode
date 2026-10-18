import { useLayoutEffect, useRef, type RefObject } from "react";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { keyboardViewportHeight, onKeyboardMotion } from "./keyboardMotion";

type Options = {
  minHeight: number;
  maxHeight?: number;
  viewportHeightRatio?: number;
  widthSource?: RefObject<HTMLElement | null>;
  measureWidth?: () => number;
};

/** Measure wrapping without shrinking the focused field or recreating observers per key. */
export function useMobileTextareaAutosize(
  field: RefObject<HTMLTextAreaElement | null>,
  value: string,
  { minHeight, maxHeight = 168, viewportHeightRatio, widthSource, measureWidth }: Options,
) {
  const visible = useSurfaceVisibility();
  const widthReader = useRef(measureWidth);
  widthReader.current = measureWidth;
  const resizeRef = useRef<(() => void) | undefined>(undefined);

  useLayoutEffect(() => {
    const element = field.current;
    const source = widthSource?.current ?? element;
    if (!visible || !element || !source) return;
    const measure = element.cloneNode() as HTMLTextAreaElement;
    for (const name of ["id", "name", "aria-label", "aria-labelledby", "aria-controls", "aria-activedescendant", "autofocus", "required"])
      measure.removeAttribute(name);
    measure.setAttribute("aria-hidden", "true");
    measure.dataset.autosizeMeasure = "true";
    measure.inert = true;
    measure.tabIndex = -1;
    measure.classList.add("mobile-composer-measure");
    Object.assign(measure.style, {
      position: "absolute", visibility: "hidden", pointerEvents: "none",
      transition: "none", height: "0px", minHeight: "0px", maxHeight: "none",
      whiteSpace: "pre-wrap", overflow: "hidden",
    });
    let previous = "";
    let width: number | undefined;
    let availableWidth: number | undefined;
    let naturalHeight = minHeight;
    const applyHeight = () => {
      const cap = viewportHeightRatio === undefined
        ? maxHeight : Math.min(maxHeight, keyboardViewportHeight() * viewportHeightRatio);
      const height = `${Math.max(minHeight, Math.min(naturalHeight, cap))}px`;
      if (element.style.height !== height) element.style.height = height;
    };
    const resize = (widthChanged = false) => {
      if (widthChanged) availableWidth = undefined;
      // Clearing a capped, internally scrolled draft already has a known
      // target. Do not flush layout twice (width + hidden measurement) before
      // the browser can start shrinking the focused field.
      if (!element.value) {
        previous = "";
        measure.value = "";
        naturalHeight = minHeight;
        applyHeight();
        return;
      }
      // Width stays fixed while typing, including during height transitions.
      // Read it only on mount or an actual width/viewport change.
      availableWidth ??= Math.max(0, widthReader.current?.() ?? element.clientWidth);
      const key = `${availableWidth}\0${element.value}`;
      if (key !== previous) {
        previous = key;
        measure.value = element.value;
        const measureWidth = `${availableWidth}px`;
        if (measure.style.width !== measureWidth) measure.style.width = measureWidth;
        // Keep the inert mirror attached: inserting/removing it on every key
        // invalidates the composer and wakes the shell's mutation observers.
        if (!measure.isConnected) element.after(measure);
        naturalHeight = measure.scrollHeight;
      }
      applyHeight();
    };
    resizeRef.current = resize;
    resize();
    const observer = new ResizeObserver((entries) => {
      // The dock observer has just published transcript padding. A fresh
      // clientWidth read here would synchronously lay that transcript out
      // again on every height-animation frame. Use the delivered geometry.
      const next = entries[0]?.contentRect.width ?? source.clientWidth;
      if (width !== undefined && Math.abs(next - width) < 0.5) return;
      width = next;
      resize(true);
    });
    observer.observe(source);
    const viewportResize = () => resize(true);
    window.addEventListener("resize", viewportResize);
    // A keyboard event changes the height limit, not wrapping. Reuse the last
    // measurement instead of forcing layout after the shell's motion writes.
    const unsubscribe = onKeyboardMotion(applyHeight);
    return () => {
      resizeRef.current = undefined;
      observer.disconnect();
      window.removeEventListener("resize", viewportResize);
      unsubscribe();
      measure.remove();
    };
  }, [field, widthSource, minHeight, maxHeight, viewportHeightRatio, visible]);

  useLayoutEffect(() => resizeRef.current?.(), [value]);
}
