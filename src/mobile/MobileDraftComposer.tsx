import { useCallback, useLayoutEffect, useRef, type ComponentProps } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobileComposer } from "./MobileComposer";

/** The shell reads/replaces drafts at navigation and send boundaries only. */
export function createMobileDraft(initial = "") {
  const store = createStore(() => ({ value: initial }));
  return {
    store,
    get: () => store.getState().value,
    set: (next: string) => {
      if (next !== store.getState().value) store.setState({ value: next });
    },
    subscribe: store.subscribe,
  };
}

export function MobileDraftComposer({ draft, ...props }: Omit<
  ComponentProps<typeof MobileComposer>, "value" | "onChange"
> & { draft: ReturnType<typeof createMobileDraft> }) {
  const visible = useSurfaceVisibility();
  const lastVisibleValue = useRef(draft.get());
  // Departing pages keep their last input while their exit animation runs.
  const select = useCallback((state: { value: string }) =>
    visible ? state.value : lastVisibleValue.current, [visible]);
  const value = useStore(draft.store, select);
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
