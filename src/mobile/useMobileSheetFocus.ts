import { useEffect, type RefObject } from "react";
import { frame, cancelFrame } from "motion/react";
import { keyboardHeight, keyboardMotionRemaining, onKeyboardMotion, onKeyboardSettled } from "./keyboardMotion";
import { reducedMotionQuery } from "../shared/lib/reducedMotion";

/** Reveal fields inside their sheet without letting the WebView pan the page. */
export function useMobileSheetFocus(
  sheet: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const element = sheet.current;
    if (!active || !element) return;
    const focusedField = () => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) ||
          !field.matches("input, textarea, select, [contenteditable]") ||
          field.closest(".mobile-sheet") !== element ||
          field.closest('[inert], [aria-hidden="true"]')) return;
      return field;
    };
    const reveal = () => {
      const field = focusedField();
      if (!field) return;
      // Forms may own an inner scroller (settings and the project picker do).
      // Stop at the sheet so revealing a field never scrolls the page below it.
      for (let scroller = field.parentElement; scroller && scroller !== element; scroller = scroller.parentElement) {
        if (!/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY) ||
            scroller.scrollHeight <= scroller.clientHeight) continue;
        const box = scroller.getBoundingClientRect();
        const rect = field.getBoundingClientRect();
        if (rect.top >= box.top + 12 && rect.bottom <= box.bottom - 12) return;
        const reduced = reducedMotionQuery().matches;
        scroller.scrollTo({
          top: Math.max(0, Math.min(
            scroller.scrollHeight - scroller.clientHeight,
            scroller.scrollTop + rect.top - box.top - Math.max(12, (box.height - rect.height) / 2),
          )),
          behavior: reduced ? "auto" : "smooth",
        });
        return;
      }
    };
    const revealAfterLayout = () => { if (!keyboardMotionRemaining()) reveal(); };
    const focus = () => {
      cancelFrame(revealAfterLayout);
      if (focusedField() && !keyboardMotionRemaining()) frame.postRender(revealAfterLayout);
    };
    const stop = onKeyboardMotion(() => cancelFrame(revealAfterLayout));
    const stopSettled = onKeyboardSettled(() => { if (keyboardHeight()) reveal(); });
    element.addEventListener("focusin", focus);
    if (keyboardHeight()) focus();
    return () => {
      cancelFrame(revealAfterLayout);
      stop();
      stopSettled();
      element.removeEventListener("focusin", focus);
    };
  }, [sheet, active]);
}
