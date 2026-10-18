type Column = {
  width?: number;
  originals: Map<HTMLElement, { value: string; priority: string }>;
};

/** Keep unified hunk headings full-width without a size-query container around
 * every syntax token. ResizeObserver supplies the already-computed code width. */
export function createReviewSeparatorLayout() {
  const columns = new Map<HTMLElement, Column>();
  let disposed = false;
  const restore = (column: Column) => {
    for (const [element, { value, priority }] of column.originals) {
      if (value) element.style.setProperty("width", value, priority);
      else element.style.removeProperty("width");
    }
    column.originals.clear();
  };
  const apply = (code: HTMLElement, column: Column) => {
    if (column.width === undefined) return;
    const width = `${column.width}px`;
    const headings = new Set(code.querySelectorAll<HTMLElement>(
      '[data-separator="line-info"] [data-separator-wrapper]',
    ));
    for (const [element, { value, priority }] of column.originals) {
      if (headings.has(element)) continue;
      if (value) element.style.setProperty("width", value, priority);
      else element.style.removeProperty("width");
      column.originals.delete(element);
    }
    for (const element of headings) {
      if (!column.originals.has(element)) {
        column.originals.set(element, {
          value: element.style.getPropertyValue("width"),
          priority: element.style.getPropertyPriority("width"),
        });
      }
      if (element.style.width !== width) element.style.width = width;
    }
  };
  const observer = new ResizeObserver(entries => {
    if (disposed) return;
    for (const entry of entries) {
      const code = entry.target as HTMLElement;
      const column = columns.get(code);
      const width = entry.contentRect.width;
      if (!column || !Number.isFinite(width) || width <= 0) continue;
      column.width = width;
      apply(code, column);
    }
  });
  return {
    update(container: HTMLElement) {
      if (disposed) return;
      const next = new Set(container.shadowRoot?.querySelectorAll<HTMLElement>(
        '[data-overflow="wrap"] [data-unified][data-container-size]',
      ));
      for (const [code, column] of columns) {
        if (next.has(code)) continue;
        observer.unobserve(code);
        restore(column);
        columns.delete(code);
      }
      for (const code of next) {
        const column = columns.get(code);
        if (column) {
          // Expanding context can replace headings without changing code width.
          apply(code, column);
        } else {
          columns.set(code, { originals: new Map() });
          observer.observe(code);
        }
      }
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      for (const column of columns.values()) restore(column);
      columns.clear();
    },
  };
}
