import type { LifecyclePort } from "../client/ports";

/** WebView visibility; native mobile foreground is supplied by its controller. */
export const browserLifecycle: LifecyclePort = {
  isActive: () => typeof document === "undefined" || !document.hidden,
  subscribe: (listener) => {
    if (typeof document === "undefined") return () => {};
    const changed = () => listener(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  },
};
