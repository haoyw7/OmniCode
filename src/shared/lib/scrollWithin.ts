/**
 * Scrolls only the nearest scrollable ancestor so `element` becomes visible.
 * Unlike `scrollIntoView`, this never scrolls overflow-hidden ancestors such as
 * the desktop shell or a modal frame, which would shift them out of place.
 */
export function scrollWithin(
  element: HTMLElement | null | undefined,
  block: "center" | "nearest" = "nearest",
): void {
  if (!element) return;
  let scroller = element.parentElement;
  while (scroller) {
    const { overflowY } = getComputedStyle(scroller);
    if (overflowY === "auto" || overflowY === "scroll") break;
    scroller = scroller.parentElement;
  }
  if (!scroller) return;
  const bounds = scroller.getBoundingClientRect();
  const target = element.getBoundingClientRect();
  // Account for browser preview zoom and in-flight scale transforms.
  const scale =
    scroller.offsetHeight > 0 ? bounds.height / scroller.offsetHeight || 1 : 1;
  const top = (target.top - bounds.top) / scale - scroller.clientTop;
  const height = target.height / scale;
  const view = scroller.clientHeight;
  let delta = 0;
  if (block === "center") delta = top + height / 2 - view / 2;
  else if (top < 0) delta = top;
  else if (top + height > view) delta = Math.min(top, top + height - view);
  if (delta) scroller.scrollTop += delta;
}
