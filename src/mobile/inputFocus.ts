import { useEffect, type RefObject } from "react";

const EDITABLE = "input, textarea, select, [contenteditable]";
const TAP_SLOP_PX = 10;

/** Keep an active input's keyboard open when pressing a non-editable control. */
export function preserveInputFocus(
  event: { target: EventTarget | null; preventDefault: () => void },
  input: HTMLElement | null | undefined,
) {
  if (
    input &&
    document.activeElement === input &&
    event.target instanceof Element &&
    !event.target.closest(EDITABLE)
  )
    event.preventDefault();
}

/**
 * Some Android WebViews also transfer focus at the end of a touch. Cancel only
 * a completed tap and activate its control synchronously, retaining both user
 * activation (for file pickers) and the existing click handlers. Touch start
 * and movement stay passive so menus can still scroll or be dragged.
 */
export function usePreserveInputFocusOnTouch(
  container: RefObject<HTMLElement | null>,
  input: RefObject<HTMLElement | null> | undefined,
  buttonsOnly = false,
  enabled = true,
) {
  useEffect(() => {
    const element = container.current;
    if (!enabled || !element || !input) return;
    let tap:
      | {
          id: number;
          x: number;
          y: number;
          target: Element;
          input: HTMLElement;
          selection?: [number, number, "forward" | "backward" | "none"];
        }
      | undefined;
    let activated: { target: Element; at: number } | undefined;
    const clearClick = () => {
      activated = undefined;
    };
    const cancel = () => {
      tap = undefined;
    };
    const start = (event: TouchEvent) => {
      cancel();
      clearClick();
      const field = input.current;
      const target = event.target;
      if (
        event.touches.length !== 1 ||
        !field ||
        document.activeElement !== field ||
        !(target instanceof Element) ||
        target.closest(EDITABLE) ||
        (buttonsOnly && !target.closest("button"))
      )
        return;
      const point = event.touches[0];
      const selection =
        (field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement) &&
        field.selectionStart != null &&
        field.selectionEnd != null
          ? ([
              field.selectionStart,
              field.selectionEnd,
              field.selectionDirection ?? "none",
            ] as const)
          : undefined;
      tap = {
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        target,
        input: field,
        selection: selection ? [...selection] : undefined,
      };
    };
    const move = (event: TouchEvent) => {
      if (!tap) return;
      const point = event.touches[0];
      if (
        event.defaultPrevented ||
        event.touches.length !== 1 ||
        point.identifier !== tap.id ||
        Math.hypot(point.clientX - tap.x, point.clientY - tap.y) > TAP_SLOP_PX
      )
        cancel();
    };
    const end = (event: TouchEvent) => {
      const current = tap;
      cancel();
      const point = event.changedTouches[0];
      if (
        !current ||
        event.touches.length ||
        event.changedTouches.length !== 1 ||
        point.identifier !== current.id ||
        !event.cancelable ||
        event.defaultPrevented ||
        Math.hypot(point.clientX - current.x, point.clientY - current.y) >
          TAP_SLOP_PX ||
        !current.input.isConnected ||
        !current.target.isConnected ||
        current.input.matches(":disabled") ||
        current.target.closest("[inert]")
      )
        return;
      const active = document.activeElement;
      // An intentional move to another editable field wins over retaining typing.
      if (active !== current.input && active?.matches(EDITABLE)) return;
      event.preventDefault();
      if (!event.defaultPrevented) return;
      if (active !== current.input) {
        current.input.focus({ preventScroll: true });
        if (
          current.selection &&
          (current.input instanceof HTMLInputElement ||
            current.input instanceof HTMLTextAreaElement)
        )
          current.input.setSelectionRange(...current.selection);
      }
      const target =
        current.target.closest<HTMLButtonElement>("button") ?? current.target;
      activated = { target, at: performance.now() };
      if (target instanceof HTMLElement) target.click();
      else
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    };
    const click = (event: MouseEvent) => {
      // A cancelled touchend normally suppresses the compatibility click. Guard
      // WebViews that still emit it, while allowing keyboard/programmatic clicks
      // and new pointer/touch presses to use the ordinary activation path.
      if (
        activated &&
        event.detail > 0 &&
        performance.now() - activated.at < 500 &&
        event.target instanceof Node &&
        activated.target.contains(event.target)
      ) {
        clearClick();
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    element.addEventListener("pointerdown", clearClick, true);
    element.addEventListener("touchstart", start, {
      capture: true,
      passive: true,
    });
    // Observe movement after the sheet's own drag handler can consume it.
    element.addEventListener("touchmove", move, { passive: true });
    element.addEventListener("touchend", end, {
      capture: true,
      passive: false,
    });
    element.addEventListener("touchcancel", cancel, true);
    element.addEventListener("click", click, true);
    return () => {
      element.removeEventListener("pointerdown", clearClick, true);
      element.removeEventListener("touchstart", start, true);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end, true);
      element.removeEventListener("touchcancel", cancel, true);
      element.removeEventListener("click", click, true);
    };
  }, [container, input, buttonsOnly, enabled]);
}
