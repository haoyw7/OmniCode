import { motion, useIsPresent } from "motion/react";
import { immediateTransition, popAnimate, popExit, popInitial, popTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import { SurfaceAppearance } from "./SurfaceAppearance";
import { useTranslation } from "../i18n/useTranslation";
import { NativePopupHost } from "./NativePopupHost";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "./SurfaceVisibility";
import { X } from "./icons";
import { useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import { GlassBackdrop } from "./GlassBackdrop";

export type ModalSize = "sm" | "md";

const WIDTH: Record<ModalSize, string> = {
  sm: "w-[min(420px,calc(100vw-24px))]",
  md: "w-[min(560px,calc(100vw-24px))]",
};

const TOP: Record<ModalSize, string> = {
  sm: "top-[22%]",
  md: "top-[10%]",
};

type Props = {
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  /** Keeps the accessible title while letting focused content own the visual hierarchy. */
  minimalHeader?: boolean;
  /** Extra classes on the panel (fixed height, etc). */
  className?: string;
  /** Keep taller dialogs inside the viewport, scrolling their content. */
  fitViewport?: boolean;
  /** Raises the dialog above an overlay that already sits over `LAYER.dialog`. */
  layer?: number;
  children: ReactNode;
};

export function ModalPanel({
  onClose,
  title,
  description,
  size = "md",
  minimalHeader = false,
  className,
  fitViewport = false,
  children,
}: Props) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const present = useIsPresent();
  const reduced = useMotionPreference();
  const appearance = useContext(SurfaceAppearance);
  const popupHost = useContext(NativePopupHost);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = description ? `${uid}-desc` : undefined;

  useEffect(() => {
    if (visible && present && !minimalHeader) closeRef.current?.focus();
  }, [visible, present, minimalHeader]);

  useEffect(() => {
    if (!visible || !present) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest("[data-dialog-popover]"))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, present, onClose]);

  if (!visible) return null;

  return (
    <div
      data-modal-context={appearance}
      className={
        popupHost
          ? "relative w-full"
          : `absolute left-1/2 ${fitViewport ? "top-1/2 -translate-y-1/2" : TOP[size]} ${WIDTH[size]} -translate-x-1/2`
      }
    >
      <motion.div
        initial={reduced ? false : popInitial}
        animate={popAnimate}
        exit={popExit}
        transition={reduced ? immediateTransition : popTransition}
        inert={!present}
        aria-hidden={!present || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        className={`modal-frame relative isolate flex flex-col overflow-hidden rounded-2xl border border-stroke shadow-md ${fitViewport ? "max-h-[calc(100dvh-32px)]" : ""} ${className ?? ""}`}
      >
        <GlassBackdrop />
        <div className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col">
          <header
            className={
              minimalHeader
                ? "absolute top-3 right-3 z-[2]"
                : "flex shrink-0 items-start gap-2 px-4 pt-3"
            }
          >
            <div
              className={minimalHeader ? "sr-only" : "min-w-0 flex-1 pt-0.5"}
            >
              <h2
                id={titleId}
                className="desktop-pane-heading text-ui-lg font-medium leading-tight text-content"
              >
                {title}
              </h2>
              {description ? (
                <p
                  id={descriptionId}
                  className="mt-0.5 truncate text-ui-sm leading-snug text-foreground-subtle"
                >
                  {description}
                </p>
              ) : null}
            </div>
            <button
              ref={closeRef}
              type="button"
              aria-label={uiT("Close")}
              onClick={onClose}
              data-ui="icon-button"
              className="desktop-modal-close grid size-7 shrink-0 place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-hover"
            >
              <X className="size-3.5" />
            </button>
          </header>
          <div
            ref={lockOverscroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none"
          >
            <SurfaceVisibilityContext.Provider value={visible && present}>{children}</SurfaceVisibilityContext.Provider>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function Modal(props: Props) {
  const host = useContext(NativePopupHost);
  const visible = useSurfaceVisibility();
  const appearance = useContext(SurfaceAppearance);
  const present = useIsPresent();
  const reduced = useMotionPreference();
  if (!visible) return null;
  if (host) return createPortal(<ModalPanel {...props} />, host);
  return createPortal(
    <motion.div data-modal-context={appearance} className="fixed inset-0" style={{ zIndex: props.layer ?? LAYER.dialog }}
      initial={reduced ? false : { opacity: popInitial.opacity }}
      animate={{ opacity: popAnimate.opacity }} exit={{ opacity: popExit.opacity }}
      transition={reduced ? immediateTransition : popTransition}
      inert={!present} aria-hidden={!present || undefined}>
      <div
        className="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-xs"
        onMouseDown={props.onClose}
      />
      <ModalPanel {...props} />
    </motion.div>,
    document.body,
  );
}
