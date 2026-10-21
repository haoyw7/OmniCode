import { act } from "react";

export function dndPointer(target: EventTarget, type: string, init: PointerEventInit) {
  if (type === "pointerup") dndPointer(document, "pointermove", init);
  const destination = target === window ? document : target;
  const dispatch = () => destination.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, bubbles: true, ...init,
  }));
  act(dispatch);
  // Crossing the activation distance mounts and measures the overlay first.
  if (type === "pointermove") act(dispatch);
}
