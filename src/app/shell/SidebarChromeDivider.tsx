import { useLayoutEffect, useRef } from "react";

/** Continue the sidebar border through the separately stacked window chrome. */
export function SidebarChromeDivider() {
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const sidebar = marker.current?.closest<HTMLElement>("[data-desktop-sidebar]");
    const pane = sidebar?.closest<HTMLElement>("[data-sidebar-transition]");
    const shell = pane?.closest<HTMLElement>(".app-shell-root");
    const chrome = shell?.querySelector<HTMLElement>("[data-window-chrome], [data-window-drag-bar]");
    if (!sidebar || !pane || !chrome) return;

    const line = document.createElement("span");
    line.dataset.sidebarChromeDivider = "";
    line.setAttribute("aria-hidden", "true");
    chrome.append(line);
    let previousWidth: number | undefined;
    let previousLeft: number | undefined;
    const sync = () => {
      const rect = sidebar.getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      const chromeLeft = chrome.getBoundingClientRect().left;
      const edge = rect.right;
      const left = edge - chromeLeft;
      if (rect.width > 0 && rect.width !== previousWidth) {
        chrome.style.setProperty("--desktop-sidebar-chrome-width", `${rect.width}px`);
        previousWidth = rect.width;
      }
      if (left !== previousLeft) {
        line.style.left = `${left}px`;
        previousLeft = left;
      }
      // Match the border's clipping during the existing sidebar disclosure.
      const hidden = rect.width === 0 || edge > paneRect.right || edge <= paneRect.left;
      if (line.hidden !== hidden) line.hidden = hidden;
    };
    const observer = new ResizeObserver(sync);
    observer.observe(pane);
    observer.observe(sidebar);
    observer.observe(chrome);
    sync();
    return () => {
      observer.disconnect();
      line.remove();
      chrome.style.removeProperty("--desktop-sidebar-chrome-width");
    };
  }, []);
  return <span ref={marker} hidden />;
}
