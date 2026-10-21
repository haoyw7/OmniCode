import { motion, useIsPresent } from "motion/react";
import { Dialog } from "radix-ui";
import { Button } from "./forms/Button";
import {
  immediateTransition,
  popAnimate,
  popExit,
  popInitial,
  popTransition,
} from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import { SurfaceAppearance } from "./SurfaceAppearance";
import { useTranslation } from "../i18n/useTranslation";
import { NativePopupHost } from "./NativePopupHost";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "./SurfaceVisibility";
import { X } from "./icons";
import { useContext, useRef, type ComponentProps, type ReactNode } from "react";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { cn } from "../lib/cn";
import { LAYER } from "../lib/layers";
import { GlassBackdrop } from "./GlassBackdrop";

export type ModalSize = "sm" | "md" | "lg";

const WIDTH: Record<ModalSize, string> = {
  sm: "w-[min(420px,calc(100vw-24px))]",
  md: "w-[min(560px,calc(100vw-24px))]",
  lg: "w-[min(880px,calc(100vw-24px))]",
};

const TOP: Record<ModalSize, string> = {
  sm: "top-[22%]",
  md: "top-[10%]",
  lg: "top-[10%]",
};

type Props = {
  onClose: () => void;
  onOpenAutoFocus?: ComponentProps<typeof Dialog.Content>["onOpenAutoFocus"];
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

function PanelContent({
  onClose,
  onOpenAutoFocus,
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
  const previousFocus = useRef(
    typeof document === "undefined" ? null : document.activeElement,
  );

  if (!visible) return null;

  return (
    <div
      data-window-modal-panel
      data-modal-context={appearance}
      className={
        popupHost
          ? "relative w-full"
          : cn(
              "absolute left-1/2 -translate-x-1/2",
              fitViewport ? "top-1/2 -translate-y-1/2" : TOP[size],
              WIDTH[size],
            )
      }
    >
      <Dialog.Content
        forceMount
        asChild
        onOpenAutoFocus={onOpenAutoFocus}
        {...(!description ? { "aria-describedby": undefined } : {})}
        onEscapeKeyDown={(event) => {
          if (!present) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!present) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const previous = previousFocus.current;
          if (
            previous instanceof HTMLElement &&
            previous.isConnected &&
            !previous.closest('[inert], [aria-hidden="true"]')
          )
            previous.focus({ preventScroll: true });
        }}
      >
        <motion.div
          initial={reduced ? false : popInitial}
          animate={popAnimate}
          exit={popExit}
          transition={reduced ? immediateTransition : popTransition}
          inert={!present}
          aria-hidden={!present || undefined}
          onMouseDown={(event) => event.stopPropagation()}
          onClickCapture={(event) => {
            if (!present) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          className={cn(
            "modal-frame relative isolate flex flex-col overflow-hidden rounded-2xl border border-stroke shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
            fitViewport && "max-h-[calc(100dvh-32px)]",
            className,
          )}
        >
          <GlassBackdrop />
          <div
            className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col"
            onKeyDown={(event) => {
              if (event.defaultPrevented) event.stopPropagation();
            }}
          >
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
                <Dialog.Title className="desktop-pane-heading text-ui-lg font-medium leading-tight text-content">
                  {title}
                </Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-0.5 truncate text-ui-sm leading-snug text-foreground-subtle">
                    {description}
                  </Dialog.Description>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                ref={closeRef}
                type="button"
                aria-label={uiT("Close")}
                onClick={onClose}
                data-ui="icon-button"
                className="desktop-modal-close grid size-7 shrink-0 place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-hover"
              >
                <X className="size-3.5" />
              </Button>
            </header>
            <div
              ref={lockOverscroll}
              className="min-h-0 flex-1 overflow-y-auto overscroll-none"
            >
              <SurfaceVisibilityContext.Provider value={visible && present}>
                {children}
              </SurfaceVisibilityContext.Provider>
            </div>
          </div>
        </motion.div>
      </Dialog.Content>
    </div>
  );
}

/** The dialog's action row; shared desktop styles give its buttons one dialog size. */
export function ModalFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer
      data-ui="dialog-actions"
      className={cn("flex flex-wrap items-center justify-end gap-2", className)}
      {...props}
    />
  );
}

export function ModalPanel(props: Props) {
  const present = useIsPresent();
  return (
    <Dialog.Root
      open={present}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <PanelContent {...props} />
    </Dialog.Root>
  );
}

export function Modal(props: Props) {
  const host = useContext(NativePopupHost);
  const visible = useSurfaceVisibility();
  const appearance = useContext(SurfaceAppearance);
  const present = useIsPresent();
  const reduced = useMotionPreference();
  if (!visible) return null;
  return (
    <Dialog.Root
      open={present}
      onOpenChange={(open) => {
        if (!open && present) props.onClose();
      }}
    >
      <Dialog.Portal forceMount container={host ?? undefined}>
        {host ? (
          <PanelContent {...props} />
        ) : (
          <motion.div
            data-window-modal
            data-modal-context={appearance}
            className="fixed inset-0"
            style={{ zIndex: props.layer ?? LAYER.dialog }}
            initial={reduced ? false : { opacity: popInitial.opacity }}
            animate={{ opacity: popAnimate.opacity }}
            exit={{ opacity: popExit.opacity }}
            transition={reduced ? immediateTransition : popTransition}
            inert={!present}
            aria-hidden={!present || undefined}
          >
            <Dialog.Overlay forceMount asChild>
              <div
                data-window-modal-backdrop
                className="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-xs"
              />
            </Dialog.Overlay>
            <PanelContent {...props} />
          </motion.div>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
