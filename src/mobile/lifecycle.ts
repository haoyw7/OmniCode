import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { LifecyclePort } from "../client/ports";

let nativeActive = true;
const active = () => nativeActive && (typeof document === "undefined" || !document.hidden);

export const mobileLifecycle: LifecyclePort = {
  isActive: active,
  subscribe(listener) {
    let disposed = false;
    const changed = () => { if (!disposed) listener(active()); };
    const native = Capacitor.isNativePlatform()
      ? App.addListener("appStateChange", state => { nativeActive = state.isActive; changed(); })
      : undefined;
    document.addEventListener("visibilitychange", changed);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", changed);
      void native?.then(handle => handle.remove());
    };
  },
};
