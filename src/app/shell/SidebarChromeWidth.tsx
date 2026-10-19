import { useLayoutEffect, useRef } from "react";

/** Keep window navigation aligned with the current sidebar width. */
export function SidebarChromeWidth() {
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const sidebar = marker.current?.closest<HTMLElement>("[data-desktop-sidebar]");
    const pane = sidebar?.closest<HTMLElement>("[data-sidebar-transition]");
    const shell = pane?.closest<HTMLElement>(".app-shell-root");
    const chrome = shell?.querySelector<HTMLElement>("[data-window-chrome], [data-window-drag-bar]");
    if (!sidebar || !pane || !chrome) return;

    let previousWidth: number | undefined;
    let previousVisibleWidth: number | undefined;
    const sync = () => {
      const { width } = sidebar.getBoundingClientRect();
      const visibleWidth = Math.min(width, pane.getBoundingClientRect().width);
      if (width > 0 && width !== previousWidth) {
        chrome.style.setProperty("--desktop-sidebar-chrome-width", `${width}px`);
        previousWidth = width;
      }
      if (visibleWidth !== previousVisibleWidth) {
        chrome.style.setProperty("--desktop-sidebar-chrome-background-width", `${visibleWidth}px`);
        previousVisibleWidth = visibleWidth;
      }
    };
    const observer = new ResizeObserver(sync);
    observer.observe(pane);
    observer.observe(sidebar);
    observer.observe(chrome);
    sync();
    return () => {
      observer.disconnect();
      chrome.style.removeProperty("--desktop-sidebar-chrome-width");
      chrome.style.removeProperty("--desktop-sidebar-chrome-background-width");
    };
  }, []);
  return <span ref={marker} hidden />;
}
