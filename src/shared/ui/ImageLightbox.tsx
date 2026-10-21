import { motion, useIsPresent } from "motion/react";
import {
  immediateTransition,
  popAnimate,
  popExit,
  popInitial,
  popTransition,
} from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import { useTranslation } from "../i18n/useTranslation";
import { useContext, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { LAYER } from "../lib/layers";
import { ChevronLeft, ChevronRight, X } from "./icons";
import { IconButton } from "./forms/IconButton";
import { Button } from "./forms/Button";
import { NativePopupHost } from "./NativePopupHost";
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
  images?: readonly { src: string; alt: string }[];
  initialIndex?: number;
  onClose: () => void;
};

export function ImageLightbox(props: Props) {
  const host = useContext(NativePopupHost);
  const visible = useSurfaceVisibility();
  const present = useIsPresent();
  return (
    <Dialog.Root
      open={visible && present}
      onOpenChange={(open) => {
        if (!open && visible && present) props.onClose();
      }}
    >
      <Dialog.Portal forceMount container={host ?? undefined}>
        <ImageLightboxContent {...props} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ImageLightboxContent({
  src,
  alt,
  images,
  initialIndex = 0,
  onClose,
}: Props) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const present = useIsPresent();
  const reduced = useMotionPreference();
  const previousFocus = useRef(document.activeElement);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const count = images?.length || 1;
  const index = Math.max(0, Math.min(selectedIndex, count - 1));
  const active = images?.[index] ?? { src, alt };
  const ignoreSwipeClick = useRef(false);
  const navigate = (direction: -1 | 1) => {
    if (visible && present)
      setSelectedIndex(Math.max(0, Math.min(index + direction, count - 1)));
  };
  const zoom = useImageZoom(
    active.src,
    visible && present,
    count > 1
      ? (direction) => {
          ignoreSwipeClick.current = true;
          navigate(direction);
        }
      : undefined,
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible || !present) return;
    const dismiss = () => onCloseRef.current();
    dismissHandlers.push(dismiss);
    return () => {
      dismissHandlers.splice(dismissHandlers.indexOf(dismiss), 1);
    };
  }, [visible, present]);

  if (!visible) return null;

  return (
    <Dialog.Content
      forceMount
      asChild
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => {
        previousFocus.current = document.activeElement;
        event.preventDefault();
        closeRef.current?.focus();
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
      onEscapeKeyDown={(event) => {
        if (!present) event.preventDefault();
      }}
    >
      <motion.div
        initial={reduced ? false : { opacity: popInitial.opacity }}
        animate={{ opacity: popAnimate.opacity }}
        exit={{ opacity: popExit.opacity }}
        transition={reduced ? immediateTransition : popTransition}
        inert={!present}
        aria-hidden={!present || undefined}
        data-window-lightbox
        className="image-lightbox fixed inset-0 flex touch-none items-center justify-center overflow-hidden bg-black/85 p-6 backdrop-blur-sm"
        style={{ zIndex: LAYER.dialog }}
        onKeyDown={(event) => {
          if (
            !present ||
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            count < 2
          )
            return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            navigate(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
        onPointerDown={(event) => {
          ignoreSwipeClick.current = false;
          zoom.onPointerDown(event);
        }}
        onPointerMove={zoom.onPointerMove}
        onPointerUp={zoom.onPointerUp}
        onPointerCancel={zoom.onPointerCancel}
        onLostPointerCapture={zoom.onLostPointerCapture}
        onDoubleClick={zoom.onDoubleClick}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (ignoreSwipeClick.current) {
            ignoreSwipeClick.current = false;
            return;
          }
          if (
            !zoom.shouldIgnoreBackdropClick() &&
            (event.target === event.currentTarget ||
              event.target === zoom.stageRef.current)
          )
            onClose();
        }}
      >
        <Dialog.Title className="sr-only">
          {uiT("Image preview: {value0}", { value0: String(active.alt) })}
        </Dialog.Title>
        <div
          ref={zoom.stageRef}
          className="image-lightbox-stage flex h-full w-full min-w-0 min-h-0 items-center justify-center overflow-hidden"
        >
          <img
            ref={zoom.imageRef}
            src={active.src}
            alt={active.alt}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain shadow-2xl"
          />
        </div>
        {count > 1 && (
          <div className="image-lightbox-navigation absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-black/65 px-2 py-1 text-white backdrop-blur-md">
            <IconButton
              label={uiT("Previous image")}
              size="lg"
              shape="round"
              style={{ color: "inherit" }}
              disabled={index === 0}
              onClick={() => navigate(-1)}
            >
              <ChevronLeft />
            </IconButton>
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={uiT("Image {value0} of {value1}", {
                value0: String(index + 1),
                value1: String(count),
              })}
              className="min-w-12 text-center text-sm tabular-nums"
            >
              {index + 1} / {count}
            </span>
            <IconButton
              label={uiT("Next image")}
              size="lg"
              shape="round"
              style={{ color: "inherit" }}
              disabled={index === count - 1}
              onClick={() => navigate(1)}
            >
              <ChevronRight />
            </IconButton>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          ref={closeRef}
          type="button"
          aria-label={uiT("Close image preview")}
          title={uiT("Close")}
          onClick={onClose}
          className="image-lightbox-close absolute right-4 top-4 z-10 grid size-9 place-items-center rounded-full border border-white/15 bg-black/45 text-white/80 shadow-lg backdrop-blur-md hover:bg-black/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <X className="size-4" />
        </Button>
      </motion.div>
    </Dialog.Content>
  );
}
