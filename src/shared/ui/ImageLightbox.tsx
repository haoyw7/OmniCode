import { motion, useIsPresent } from "motion/react";
import { immediateTransition, popAnimate, popExit, popInitial, popTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import { useTranslation } from "../i18n/useTranslation";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { X } from "./icons";
import { useSurfaceVisibility } from "./SurfaceVisibility";
import { useImageZoom } from "../hooks/useImageZoom";

const dismissHandlers: (() => void)[] = [];

/** Native Back dismisses the foremost image before navigating its owner. */
export function dismissImageLightbox(): boolean {
  const dismiss = dismissHandlers.at(-1);
  if (!dismiss) return false;
  dismiss();
  return true;
}

type Props = {
  src: string;
  alt: string;
  onClose: () => void;
};

export function ImageLightbox({ src, alt, onClose }: Props) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const present = useIsPresent();
  const reduced = useMotionPreference();
  const zoom = useImageZoom(src, visible && present);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible || !present) return;
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    const dismiss = () => onCloseRef.current();
    dismissHandlers.push(dismiss);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dismissHandlers.at(-1) !== dismiss) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      dismissHandlers.splice(dismissHandlers.indexOf(dismiss), 1);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected &&
          !previouslyFocused.closest('[inert], [aria-hidden="true"]'))
        previouslyFocused.focus({ preventScroll: true });
    };
  }, [visible, present]);

  if (!visible) return null;

  return createPortal(
    <motion.div
      initial={reduced ? false : { opacity: popInitial.opacity }}
      animate={{ opacity: popAnimate.opacity }}
      exit={{ opacity: popExit.opacity }}
      transition={reduced ? immediateTransition : popTransition}
      inert={!present}
      aria-hidden={!present || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={uiT("Image preview: {value0}", { value0: String(alt) })}
      className="image-lightbox fixed inset-0 flex touch-none items-center justify-center overflow-hidden bg-black/85 p-6 backdrop-blur-sm"
      style={{ zIndex: LAYER.dialog }}
      onPointerDown={zoom.onPointerDown}
      onPointerMove={zoom.onPointerMove}
      onPointerUp={zoom.onPointerUp}
      onPointerCancel={zoom.onPointerCancel}
      onLostPointerCapture={zoom.onLostPointerCapture}
      onDoubleClick={zoom.onDoubleClick}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (!zoom.shouldIgnoreBackdropClick() &&
            (event.target === event.currentTarget || event.target === zoom.stageRef.current)) onClose();
      }}
    >
      <div ref={zoom.stageRef} className="image-lightbox-stage flex h-full w-full min-w-0 min-h-0 items-center justify-center overflow-hidden">
        <img
          ref={zoom.imageRef}
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain shadow-2xl"
        />
      </div>
      <button
        ref={closeRef}
        type="button"
        aria-label={uiT("Close image preview")}
        title={uiT("Close")}
        onClick={onClose}
        className="image-lightbox-close absolute right-4 top-4 z-10 grid size-9 place-items-center rounded-full border border-white/15 bg-black/45 text-white/80 shadow-lg backdrop-blur-md hover:bg-black/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    </motion.div>,
    document.body,
  );
}
