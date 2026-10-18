import { useEffect } from "react";

/** Side buttons share the window controls' history, even over editors/terminals. */
export function useMouseHistoryNavigation(
  back: () => void,
  forward: () => void,
) {
  useEffect(() => {
    const onMouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      // Cancel every phase so the webview cannot also leave the application.
      event.preventDefault();
      event.stopPropagation();
      // A press/release/auxclick sequence must traverse exactly one entry.
      if (event.type === "mouseup") {
        if (event.button === 3) back();
        else forward();
      }
    };
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("mouseup", onMouse, true);
    window.addEventListener("auxclick", onMouse, true);
    return () => {
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("mouseup", onMouse, true);
      window.removeEventListener("auxclick", onMouse, true);
    };
  }, [back, forward]);
}
