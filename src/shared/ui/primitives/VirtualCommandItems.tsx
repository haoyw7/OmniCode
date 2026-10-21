import { useLayoutEffect, useRef } from "react";
import { VirtualRows, type VirtualRowsProps } from "../VirtualRows";

/** cmdk manages selection semantics; navigation uses the complete filtered data. */
export function VirtualCommandItems<T>({ items, getKey, activeValue, onActive, onSelect, isDisabled, ...props }: VirtualRowsProps<T> & {
  activeValue: string;
  onActive: (value: string) => void;
  onSelect: (item: T) => void;
  isDisabled?: (item: T) => boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const latest = useRef({ items, getKey, activeValue, onActive, onSelect, isDisabled });
  latest.current = { items, getKey, activeValue, onActive, onSelect, isDisabled };
  const virtual = items.length > 80;
  useLayoutEffect(() => {
    if (!virtual) return;
    const root = anchor.current?.closest<HTMLElement>("[cmdk-root]");
    if (!root) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
      const state = latest.current;
      const available = state.items.filter(item => !state.isDisabled?.(item));
      if (!available.length) return;
      const index = available.findIndex(item => state.getKey(item) === state.activeValue);
      let next: number;
      switch (event.key) {
        case "ArrowDown": next = (index + 1) % available.length; break;
        case "ArrowUp": next = index < 0 ? available.length - 1 : (index - 1 + available.length) % available.length; break;
        case "Home": next = 0; break;
        case "End": next = available.length - 1; break;
        case "PageDown": next = Math.min(available.length - 1, index + 10); break;
        case "PageUp": next = Math.max(0, index - 10); break;
        case "Enter":
          event.preventDefault();
          event.stopPropagation();
          if (index >= 0) state.onSelect(available[index]);
          return;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      state.onActive(state.getKey(available[next]));
    };
    root.addEventListener("keydown", keydown, true);
    return () => root.removeEventListener("keydown", keydown, true);
  }, [virtual]);
  return <>
    <div ref={anchor} aria-hidden="true" />
    <VirtualRows {...props} items={items} getKey={getKey} activeIndex={items.findIndex(item => getKey(item) === activeValue)} />
  </>;
}
