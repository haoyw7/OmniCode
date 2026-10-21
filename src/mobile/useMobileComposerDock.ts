import { useLayoutEffect, type RefObject } from "react";

/** Reserve the floating dock's actual height so the last message stays reachable. */
export function useMobileComposerDock(
  dock: RefObject<HTMLElement | null>,
  form?: RefObject<HTMLElement | null>,
  hasQueue = false,
) {
  useLayoutEffect(() => {
    const element = dock.current;
    const host = element?.parentElement;
    if (!element || !host) return;
    const queue = element.querySelector<HTMLElement>(":scope > .mobile-message-queue");
    const composer = form?.current;
    let queueTop = 0;
    let width: number | undefined;
    let dockHeight = 0;
    let composerHeight = 0;
    let queueSpace: number | undefined;
    const publish = (entries: ResizeObserverEntry[] = []) => {
      const entry = entries.find(({ target }) => target === element);
      const composerEntry = entries.find(({ target }) => target === composer);
      if (entry || !entries.length)
        dockHeight = entry?.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight;
      if (queue && composer && (composerEntry || !entries.length))
        composerHeight = composerEntry?.borderBoxSize?.[0]?.blockSize ?? composer.offsetHeight;
      const height = `calc(${Math.round(dockHeight)}px + max(0px, var(--mobile-safe-bottom) - 8px))`;
      const widthChanged = entry !== undefined && entry.contentRect.width !== width;
      if (entry) width = entry.contentRect.width;
      // The queue's collapsed margin and dock padding belong to this gap too.
      const nextQueueSpace = dockHeight - composerHeight;
      if (!entries.length || widthChanged || queueSpace === undefined || Math.abs(nextQueueSpace - queueSpace) > 0.001)
        queueTop = queue && composer ? composer.offsetTop : 0;
      queueSpace = nextQueueSpace;
      const queueHeight = `${queueTop}px`;
      // Finish geometry reads before publishing transcript padding and blur bounds.
      if (host.style.getPropertyValue("--mobile-dock-height") !== height)
        host.style.setProperty("--mobile-dock-height", height);
      if (element.style.getPropertyValue("--mobile-dock-queue-height") !== queueHeight)
        element.style.setProperty("--mobile-dock-queue-height", queueHeight);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element, { box: "border-box" });
    if (queue && composer) observer.observe(composer, { box: "border-box" });
    return () => {
      observer.disconnect();
      host.style.removeProperty("--mobile-dock-height");
    };
  }, [dock, form, hasQueue]);
}
