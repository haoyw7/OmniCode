import { AppSkeleton } from "../../../shared/ui/messaging/AppSkeleton";
import { Suspense, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useIsPresent } from "motion/react";
import { GlassBackdrop } from "../../../shared/ui/GlassBackdrop";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { X } from "../../../shared/ui/icons";
import { LAYER } from "../../../shared/lib/layers";
import { immediateTransition, popTransition } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";

function isRendered(element: HTMLElement) {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse"
    && element.getClientRects().length > 0;
}

function trapDialogTab(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const dialog = event.currentTarget;
  // React events from nested portals still bubble through this component.
  // Their dialog/menu handlers own focus before the parent handles a boundary.
  if (!(event.target instanceof Element) || event.target.closest('[role="dialog"]') !== dialog) return;
  const modals = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter(isRendered);
  if (modals.at(-1) !== dialog) return;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href], area[href], button, input, select, textarea, summary, iframe, object, embed, [tabindex], [contenteditable]:not([contenteditable="false"])',
  )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled")
    && element.closest('[role="dialog"]') === dialog && isRendered(element))
    .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
  } else if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/** App views retain their state and Escape handling inside the shared dialog. */
export function AppViewDialog({
  title,
  onClose,
  topInset = 0,
  children,
}: {
  title: string;
  onClose: () => void;
  topInset?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const present = useIsPresent();
  const reduced = useMotionPreference();
  const closeButton = useRef<HTMLButtonElement>(null);
  const transition = reduced ? immediateTransition : popTransition;

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <>
      {topInset > 0 ? (
        <motion.div
          aria-hidden
          data-window-chrome-backdrop
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
          className="modal-backdrop pointer-events-none fixed inset-x-0 top-0 bg-black/40"
          style={{ zIndex: LAYER.windowChrome, height: topInset }}
        />
      ) : null}
      <motion.div
        data-app-view-dialog
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={transition}
        inert={!present}
        aria-hidden={!present || undefined}
        className="fixed inset-0"
        style={{ zIndex: LAYER.dialog, top: topInset }}
      >
        <div
          className="modal-backdrop absolute inset-0 bg-black/40"
          onMouseDown={present ? onClose : undefined}
        />
        <motion.div
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={present ? trapDialogTab : undefined}
          initial={reduced ? false : { scale: 0.98 }}
          animate={{ scale: 1 }}
          exit={reduced ? { opacity: 0 } : { scale: 0.98 }}
          transition={transition}
          className="app-view-dialog absolute inset-0 m-auto isolate flex h-[min(800px,calc(100%-32px))] w-[min(1024px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-content/7 shadow-xl"
        >
          <GlassBackdrop />
          <div className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col">
            <h2 id={titleId} className="desktop-pane-heading sr-only">
              {title}
            </h2>
            <button
              ref={closeButton}
              type="button"
              aria-label={t("Close")}
              onClick={onClose}
              className="app-view-dialog-close absolute right-3 top-3 z-[4] grid size-8 place-items-center rounded-lg text-content/65 hover:bg-content/5 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <X className="size-5" />
            </button>
            <SurfaceVisibilityContext.Provider value={present}>
              <div className="flex min-h-0 flex-1 flex-col [&>*>*:first-child]:pr-10">
                <Suspense
                  fallback={
                    <AppSkeleton size="fullscreen" label={t("Loading…")} className="mt-12" />
                  }
                >
                  {children}
                </Suspense>
              </div>
            </SurfaceVisibilityContext.Provider>
          </div>
        </motion.div>
      </motion.div>
    </>,
    document.body,
  );
}
