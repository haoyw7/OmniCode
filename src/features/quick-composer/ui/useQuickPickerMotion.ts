import { useLayoutEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";


/** Animate the card itself so native vibrancy and its shadow follow its height. */
export function useQuickPickerMotion(
  frameRef: RefObject<HTMLDivElement | null>,
  _pickerRef: RefObject<HTMLDivElement | null>,
  _picker:
    "project" | "model" | "permissions" | "attachments" | "commands" | null,
) {

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let sentHeight = -1;
    const fit = () => {
      const height = frame.getBoundingClientRect().height;
      const rounded = Math.ceil(height);
      if (rounded === sentHeight) return;
      sentHeight = rounded;
      void invoke("quick_composer_fit", { height: rounded }).catch(
        () => undefined,
      );
    };
    fit();
    // ResizeObserver also runs on each animation frame, keeping the native
    // window's bottom edge in step with the card. The top edge stays fixed.
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frameRef]);

}
