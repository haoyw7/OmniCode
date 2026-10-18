import { beginPaneResize } from "../../shared/lib/paneResize";

export const WINDOW_RESIZE_IDLE_MS = 120;

/** Native resize events can arrive for every pixel. Read window state once
 * after the burst, not through IPC for every intermediate size. */
export function deferredWindowRefresh(refresh: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; refresh(); }, WINDOW_RESIZE_IDLE_MS);
    },
    dispose() { clearTimeout(timer); },
  };
}

/** Share the existing pane-resize guard with native window resizing. Editors
 * still follow the window; expensive terminal fits wait for its final size. */
export function suspendTerminalFitsDuringWindowResize() {
  let finish: (() => void) | undefined;
  const settle = () => {
    document.documentElement.classList.remove("is-native-window-resizing");
    finish?.();
    finish = undefined;
  };
  const idle = deferredWindowRefresh(settle);
  const resized = () => {
    if (!finish) {
      finish = beginPaneResize();
      document.documentElement.classList.add("is-native-window-resizing");
    }
    idle.schedule();
  };
  window.addEventListener("resize", resized);
  return () => {
    window.removeEventListener("resize", resized);
    idle.dispose();
    settle();
  };
}
