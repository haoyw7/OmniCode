import { useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ComponentProps } from "react";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobileComposer } from "./MobileComposer";

/** The shell reads/replaces drafts at navigation and send boundaries only. */
export function createMobileDraft(initial = "") {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: string) => {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export function MobileDraftComposer({ draft, ...props }: Omit<
  ComponentProps<typeof MobileComposer>, "value" | "onChange"
> & { draft: ReturnType<typeof createMobileDraft> }) {
  const visible = useSurfaceVisibility();
  const lastVisibleValue = useRef(draft.get());
  // Departing pages keep their last input while their exit animation runs.
  const subscribe = useCallback((listener: () => void) =>
    visible ? draft.subscribe(listener) : () => {}, [draft, visible]);
  const snapshot = useCallback(() =>
    visible ? draft.get() : lastVisibleValue.current, [draft, visible]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  useLayoutEffect(() => {
    if (visible) lastVisibleValue.current = value;
  }, [visible, value]);
  return <MobileComposer
    {...props}
    value={value}
    onChange={draft.set}
    canSend={props.canSend && (!!value.trim() || props.attachments.length > 0)}
  />;
}
