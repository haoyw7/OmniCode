import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps, type ComponentType } from "react";
import { useTranslation } from "../shared/i18n/useTranslation";
import { useCollapseMotion } from "../shared/ui/AnimatedCollapse";
import { MobileSheet } from "./MobileSheet";
import { SHEET_CLOSE_MS } from "./sheetDrag";

function MobileLoading() {
  const { t } = useTranslation();
  return <div className="mobile-loading" role="status">{t("Loading…")}</div>;
}

type MobileModule = () => Promise<{ default: ComponentType<any> }>;
type MobileProps<Load extends MobileModule> = ComponentProps<Awaited<ReturnType<Load>>["default"]>;

const PRELOAD_DELAY_MS = 4_000;
const preloads: (() => Promise<unknown>)[] = [];
let preloadScheduled = false;

/** Fetch deferred chunks one at a time once startup is over, so a first open
 * shows the real page or sheet instead of flashing its loading placeholder. */
function schedulePreload(start: () => Promise<unknown>) {
  preloads.push(start);
  if (preloadScheduled || typeof window === "undefined") return;
  preloadScheduled = true;
  const idle = (next: () => void) =>
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(next, { timeout: 2_000 })
      : window.setTimeout(next, 50);
  const step = () => {
    const start = preloads.shift();
    if (!start) return;
    void start().catch(() => undefined).finally(() => idle(step));
  };
  window.setTimeout(() => idle(step), PRELOAD_DELAY_MS);
}

/** One loader for both lazy() and the preload. Once loaded, lazy() receives a
 * thenable that resolves synchronously, so it never suspends for a tick. */
function preloadable<Load extends MobileModule>(load: Load): Load {
  let loaded: Awaited<ReturnType<Load>> | undefined;
  let pending: Promise<Awaited<ReturnType<Load>>> | undefined;
  const start = () => (pending ??= load().then(
    (module) => (loaded = module as Awaited<ReturnType<Load>>),
    (problem) => { pending = undefined; throw problem; },
  ));
  schedulePreload(start);
  return (() => loaded
    ? { then: (resolve: (value: unknown) => void) => resolve(loaded) }
    : start()) as unknown as Load;
}

/** Keep the Suspense boundary inside the retained page/overlay lifetime. */
export function lazyMobilePage<Load extends MobileModule>(load: Load) {
  const Component = lazy(preloadable(load));
  return function LazyMobilePage(props: MobileProps<Load>) {
    return <Suspense fallback={<MobileLoading />}><Component {...props} /></Suspense>;
  };
}

type SheetLifetime = { open?: boolean; onExited?: () => void; onClose: () => void };

/** A loading sheet can still close and finish its presence lifetime, even if
 * its chunk has not arrived. The loaded sheet receives the latest open state. */
export function lazyMobileSheet<Load extends MobileModule>(load: Load) {
  const preload = preloadable(load);
  const Component = lazy(preload);
  return function LazyMobileSheet(props: MobileProps<Load> & SheetLifetime) {
    const { t } = useTranslation();
    const open = props.open ?? true;
    const [ready, setReady] = useState(false);
    useEffect(() => {
      if (!open || ready) return;
      let current = true;
      const resolve = () => { if (current) setReady(true); };
      void preload().then(resolve, resolve);
      return () => { current = false; };
    }, [open, ready]);
    // The fallback may be replaced midway through closing. Own the exit
    // lifetime above Suspense so that swap cannot lose the completion callback.
    const { foldState, finish } = useCollapseMotion(open, SHEET_CLOSE_MS);
    const wasOpen = useRef(open);
    useEffect(() => {
      if (open) wasOpen.current = true;
      else if (foldState === "closed" && wasOpen.current) {
        wasOpen.current = false;
        props.onExited?.();
      }
    }, [open, foldState, props.onExited]);
    const loading = (
      <MobileSheet open={open} onExited={finish}
        onClose={props.onClose} title="Loading…" header={{ title: t("Loading…") }}>
        <MobileLoading />
      </MobileSheet>
    );
    // Keep the same loading sheet while it closes. A chunk resolving during
    // that spring must not replace the element that owns its completion.
    if (!ready) return loading;
    return <Suspense fallback={loading}><Component {...props} onExited={finish} /></Suspense>;
  };
}
