import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type VirtualRowsProps<T> = {
  items: readonly T[];
  getKey: (item: T) => string;
  children: (item: T, index: number) => ReactNode;
  estimateSize?: number;
  activeIndex?: number;
  scrollToActive?: boolean;
  gap?: number;
  /** Preserve list semantics when the parent is a ul. */
  as?: "div" | "li";
};

/** Uses the existing surface scroller; never introduces a nested scroll area. */
export function VirtualRows<T>({ items, getKey, children, estimateSize = 32, activeIndex = -1, scrollToActive = true, gap = 0, as: Tag = "div" }: VirtualRowsProps<T>) {
  const marker = useRef<HTMLElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  const enabled = items.length > 80;
  const itemKey = useCallback((index: number) => getKey(items[index]), [items, getKey]);
  useLayoutEffect(() => {
    if (!enabled || !marker.current) return;
    let parent = marker.current.parentElement;
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    setScroller(parent);
    if (!parent) return;
    const measure = () => {
      if (!marker.current) return;
      const next = marker.current.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop;
      setMargin(previous => Math.abs(previous - next) < 0.5 ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    // Group disclosure above this list can change its offset without resizing the viewport.
    for (let ancestor = marker.current.parentElement; ancestor && ancestor !== parent; ancestor = ancestor.parentElement) observer.observe(ancestor);
    return () => observer.disconnect();
  }, [enabled]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimateSize,
    getItemKey: itemKey,
    measureElement: (element, entry) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height;
      return height > 0 ? height : estimateSize + gap;
    },
    overscan: 6,
    enabled,
    scrollMargin: margin,
    initialRect: { width: 0, height: 480 },
    rangeExtractor: range => {
      const visible = defaultRangeExtractor(range);
      if (activeIndex >= 0 && activeIndex < items.length && !visible.includes(activeIndex)) visible.push(activeIndex);
      return visible.sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    if (enabled && scroller && scrollToActive && activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: "auto" });
  }, [activeIndex, enabled, scroller, scrollToActive, virtualizer]);
  const rows = enabled ? virtualizer.getVirtualItems() : items.map((item, index) => ({ key: getKey(item), index, start: index * (estimateSize + gap), end: (index + 1) * (estimateSize + gap) }));
  let end = margin;
  return <>
    <Tag data-virtual-spacer ref={(node: HTMLDivElement | HTMLLIElement | null) => { marker.current = node; }} aria-hidden="true" style={{ height: 0, listStyle: "none" }} />
    {rows.map(row => {
      const spacer = enabled ? Math.max(0, row.start - end) : 0;
      end = row.end;
      return <Fragment key={row.key}>
        {spacer > 0 && <Tag data-virtual-spacer aria-hidden="true" style={{ height: spacer, flexShrink: 0, listStyle: "none" }} />}
        <Tag data-virtual-row data-index={row.index} ref={enabled ? virtualizer.measureElement : undefined} style={{ listStyle: "none", paddingBottom: gap || undefined }}>
          {children(items[row.index], row.index)}
        </Tag>
      </Fragment>;
    })}
    <Tag data-virtual-spacer aria-hidden="true" style={{ height: enabled ? Math.max(0, virtualizer.getTotalSize() + margin - end) : 0, flexShrink: 0, listStyle: "none" }} />
  </>;
}
