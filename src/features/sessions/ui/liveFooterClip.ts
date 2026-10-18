const clippedRows = new WeakMap<HTMLElement, Set<HTMLElement>>();

/** A sticky text-only footer needs a content boundary, not a painted backdrop. */
export function syncLiveFooterClip(scroller: HTMLElement) {
  const previous = clippedRows.get(scroller);
  const next = new Map<HTMLElement, number>();
  const footer = scroller.querySelector<HTMLElement>(".transcript-live-footer-collapse");
  if (scroller.dataset.followLatest === "true" && footer?.querySelector("[data-live-footer]") && getComputedStyle(footer).position === "sticky") {
    const boundary = footer.getBoundingClientRect().top;
    // Read geometry before writing styles. Only rows reaching the sticky edge
    // need clipping; their layout height remains intact for the scroll curve.
    for (let row = footer.previousElementSibling; row instanceof HTMLElement; row = row.previousElementSibling) {
      const overlap = row.getBoundingClientRect().bottom - boundary;
      if (overlap <= 0) break;
      next.set(row, overlap);
    }
  }
  for (const row of previous ?? []) {
    if (next.has(row)) continue;
    row.removeAttribute("data-live-footer-clipped");
    row.style.removeProperty("--live-footer-clip-bottom");
  }
  for (const [row, overlap] of next) {
    const value = `${overlap}px`;
    if (row.style.getPropertyValue("--live-footer-clip-bottom") === value) continue;
    row.setAttribute("data-live-footer-clipped", "");
    row.style.setProperty("--live-footer-clip-bottom", value);
  }
  if (next.size) clippedRows.set(scroller, new Set(next.keys()));
  else clippedRows.delete(scroller);
}
