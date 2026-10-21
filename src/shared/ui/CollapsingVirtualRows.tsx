import { useRef, useState } from "react";
import { AnimatedCollapse } from "./AnimatedCollapse";
import { VirtualRows, type VirtualRowsProps } from "./VirtualRows";

/** Retain only mounted departing rows until the shared collapse finishes. */
export function CollapsingVirtualRows<T>({ items, getKey, children, activeIndex, ...props }: VirtualRowsProps<T>) {
  const mounted = useRef(new Set<string>());
  const seen = useRef(new Set(items.map(getKey)));
  const keys = new Set(items.map(getKey));
  const indexes = new Map(items.map((item, index) => [getKey(item), index]));
  const currentKeys = useRef(keys);
  currentKeys.current = keys;
  const [previous, setPrevious] = useState(items);
  const [retained, setRetained] = useState(items);
  if (previous !== items) {
    const next = [...items];
    for (let index = 0; index < retained.length; index++) {
      const item = retained[index];
      const key = getKey(item);
      if (keys.has(key) || !mounted.current.has(key)) continue;
      const following = retained.slice(index + 1).find(candidate => keys.has(getKey(candidate)));
      const position = following ? next.findIndex(candidate => getKey(candidate) === getKey(following)) : next.length;
      next.splice(position, 0, item);
    }
    setPrevious(items);
    setRetained(next);
  }
  const activeKey = activeIndex !== undefined && items[activeIndex] ? getKey(items[activeIndex]) : undefined;
  return <VirtualRows {...props} items={retained} getKey={getKey} activeIndex={activeKey ? retained.findIndex(item => getKey(item) === activeKey) : -1}>
    {(item) => {
      const key = getKey(item);
      const present = keys.has(key);
      const index = indexes.get(key) ?? -1;
      return <div ref={node => {
        if (node) { mounted.current.add(key); seen.current.add(key); }
        else mounted.current.delete(key);
      }}>
        <AnimatedCollapse expanded={present} initiallyCollapsed={!seen.current.has(key)} onExited={() => {
          if (!currentKeys.current.has(key)) setRetained(rows => rows.filter(row => getKey(row) !== key));
        }}>
          {children(item, index)}
        </AnimatedCollapse>
      </div>;
    }}
  </VirtualRows>;
}
