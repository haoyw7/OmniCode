import { isDesktopShell } from "../../platform/tauri/window";
import { useEffect } from "react";
import { IS_LINUX, IS_WIN } from "../../platform/tauri/platform";
import { suspendTerminalFitsDuringWindowResize } from "./windowResizeWork";

/** Schedule page work independently of the platform's native resize handles. */
export function WindowResizeObserver() {
  useEffect(() => {
    if ((IS_LINUX || IS_WIN) && isDesktopShell()) {
      return suspendTerminalFitsDuringWindowResize();
    }
  }, []);
  return null;
}
