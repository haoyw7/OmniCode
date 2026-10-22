import { PresenceBoundary } from "./PresenceBoundary";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Popover } from "./Popover";
import { useSurfaceVisibility } from "./SurfaceVisibility";

/** Immediate hover and focus retention for sidebar summary surfaces. */
export function useHoverSummary<T extends HTMLElement = HTMLElement>({
  enabled = true,
  interactive = false,
  openDelay = 0,
  focusRetains = true,
  onOpen,
}: {
  enabled?: boolean;
  interactive?: boolean;
  /** Keep the card open while focus stays in the row or card. Off: the pointer leaving closes it. */
  focusRetains?: boolean;
  /** Pointer hover delay (ms) for dense lists; focus still opens at once. */
  openDelay?: number;
  onOpen?: () => void;
} = {}) {
  const visible = useSurfaceVisibility();
  const id = useId();
  const anchorRef = useRef<T>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointerSurfaceRef = useRef<HTMLDivElement>(null);
  const pointerTriggerRef = useRef<Element | null>(null);
  const hovered = useRef(false);
  const suppressed = useRef(false);
  const restoringFocus = useRef(false);
  const pointerFocus = useRef(false);
  const openRef = useRef(false);
  const delayTimer = useRef<number | undefined>(undefined);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [open, setOpen] = useState(false);
  const available = enabled && visible;

  function contains(target: EventTarget | null) {
    return (
      target instanceof Node &&
      (anchorRef.current?.contains(target) ||
        surfaceRef.current?.contains(target))
    );
  }

  function show() {
    if (!available || suppressed.current) return;
    if (!openRef.current) {
      openRef.current = true;
      setOpen(true);
      onOpenRef.current?.();
    }
  }

  function cancelDelayedShow() {
    window.clearTimeout(delayTimer.current);
    delayTimer.current = undefined;
  }

  function close(restoreFocus = false) {
    cancelDelayedShow();
    // Focus restoration can itself emit focus; suppress reopening first.
    suppressed.current = true;
    hovered.current = false;
    openRef.current = false;
    setOpen(false);
    if (restoreFocus && surfaceRef.current?.contains(document.activeElement)) {
      restoringFocus.current = true;
      anchorRef.current?.focus({ preventScroll: true });
      restoringFocus.current = false;
    }
  }

  function containsPointer(target: EventTarget | null) {
    return (
      target instanceof Node &&
      (pointerTriggerRef.current?.contains(target) ||
        pointerSurfaceRef.current?.contains(target))
    );
  }

  function hideUnlessRetained(
    focused: EventTarget | null = document.activeElement,
    pointerLeft = false,
  ) {
    if (hovered.current) return;
    // Focus moving into the card (keyboard) always keeps it; focus left by a
    // click only keeps it when the pointer leaves if focus retention is on.
    if (contains(focused) && (focusRetains || !pointerLeft)) return;
    cancelDelayedShow();
    openRef.current = false;
    setOpen(false);
    suppressed.current = false;
  }

  useEffect(() => cancelDelayedShow, []);
  useEffect(() => {
    if (available) return;
    cancelDelayedShow();
    hovered.current = false;
    openRef.current = false;
    suppressed.current = false;
    setOpen(false);
  }, [available]);
  useEffect(() => {
    if (!open || !available) return;
    const scroll = (event: Event) => {
      // Long summary content may scroll without dismissing its own card.
      if (
        event.target instanceof Node &&
        surfaceRef.current?.contains(event.target)
      )
        return;
      close(true);
    };
    window.addEventListener("scroll", scroll, true);
    return () => window.removeEventListener("scroll", scroll, true);
  }, [open, available]);

  const triggerProps = {
    onPointerDown() {
      pointerFocus.current = true;
    },
    onPointerEnter(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      pointerTriggerRef.current = event.currentTarget;
      hovered.current = true;
      suppressed.current = false;
      if (openDelay > 0 && !openRef.current) {
        cancelDelayedShow();
        delayTimer.current = window.setTimeout(() => {
          delayTimer.current = undefined;
          if (hovered.current) show();
        }, openDelay);
        return;
      }
      show();
    },
    onPointerLeave(event: PointerEvent) {
      hovered.current = !!containsPointer(event.relatedTarget);
      hideUnlessRetained(document.activeElement, true);
    },
    onFocus() {
      if (restoringFocus.current) return;
      // A button's native focus after a pointer press is not keyboard intent.
      if (pointerFocus.current) {
        pointerFocus.current = false;
        return;
      }
      suppressed.current = false;
      show();
    },
    onBlur(event: FocusEvent) {
      pointerFocus.current = false;
      hideUnlessRetained(event.relatedTarget);
    },
    onKeyDown(event: KeyboardEvent) {
      pointerFocus.current = false;
      if (!interactive || !open) return;
      if (
        (event.key === "Tab" && !event.shiftKey) ||
        event.key === "ArrowDown"
      ) {
        const first = surfaceRef.current?.querySelector<HTMLElement>(
          "button:not(:disabled), [tabindex='0']",
        );
        if (!first) return;
        event.preventDefault();
        event.stopPropagation();
        first.focus();
      }
    },
  };
  const surfaceProps = {
    onPointerEnter() {
      hovered.current = true;
    },
    onPointerLeave(event: PointerEvent) {
      hovered.current = !!containsPointer(event.relatedTarget);
      hideUnlessRetained(document.activeElement, true);
    },
    onBlur(event: FocusEvent) {
      hideUnlessRetained(event.relatedTarget);
    },
    onKeyDown(event: KeyboardEvent) {
      if (!interactive || event.key !== "Tab") return;
      const actions = surfaceRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [tabindex='0']",
      );
      if (!actions?.length) return;
      if (event.shiftKey && event.target === actions[0]) {
        event.preventDefault();
        event.stopPropagation();
        anchorRef.current?.focus();
      } else if (
        !event.shiftKey &&
        event.target === actions[actions.length - 1]
      ) {
        // Return to the row before allowing the browser to find its next peer.
        // Suppression keeps its focus event from reopening the dismissed card.
        close(true);
      }
    },
  };

  return {
    open: open && available,
    id,
    anchorRef,
    surfaceRef,
    pointerSurfaceRef,
    close,
    triggerProps,
    surfaceProps,
  };
}

export function HoverSummary({
  hover,
  role = "tooltip",
  label,
  width = 320,
  children,
  ...attributes
}: {
  hover: ReturnType<typeof useHoverSummary>;
  role?: "tooltip" | "dialog";
  label?: string;
  width?: number;
  children: ReactNode;
  "data-project-summary"?: string;
}) {
  return (
    <PresenceBoundary propagate>{hover.open ? (
    <Popover
      {...attributes}
      {...hover.surfaceProps}
      frameProps={{
        ref: hover.pointerSurfaceRef,
        onPointerEnter: hover.surfaceProps.onPointerEnter,
        onPointerLeave: hover.surfaceProps.onPointerLeave,
      }}
      ref={hover.surfaceRef}
      anchor={hover.anchorRef}
      side="right"
      align="start"
      // Overlap the row's edge so pointer transfer needs no leave-delay
      // timer, including when placement flips.
      gap={-1}
      width={width}
      animated={false}
      role={role}
      id={hover.id}
      aria-label={label}
      tabIndex={role === "dialog" ? -1 : undefined}
      onDismiss={(reason) => hover.close(reason === "escape")}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      data-no-drag
      className="overflow-y-auto overscroll-contain p-3 text-[12px] leading-relaxed text-content/75 select-text"
    >
      {children}
    </Popover>
    ) : null}</PresenceBoundary>
  );
}

export function HoverSummaryRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div aria-label={label} className="flex min-w-0 items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-4 shrink-0 place-items-center text-content/45 [&>svg]:size-3.5"
      >
        {icon}
      </span>
      <span className="w-14 shrink-0 text-content/45">{label}</span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {children}
      </span>
    </div>
  );
}
