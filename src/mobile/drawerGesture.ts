// Decisions for dragging the conversation drawer with a finger. The drawer's
// position is a translateX between -width (closed) and 0 (open).

/** Movement before a touch is classified as a horizontal drag or a scroll. */
export const DRAWER_SLOP = 10;
/** A flick faster than this (px/ms) settles in its direction regardless of distance. */
export const DRAWER_FLICK_VELOCITY = 0.4;

export type DrawerIntent = "drag" | "scroll" | "undecided";

/** Classifies a touch once it leaves the slop radius. */
export function drawerIntent(
  dx: number,
  dy: number,
  opening: boolean,
): DrawerIntent {
  if (Math.hypot(dx, dy) < DRAWER_SLOP) return "undecided";
  const horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
  if (!horizontal) return "scroll";
  // Opening only follows a rightward pull; closing only a leftward push.
  return (opening ? dx > 0 : dx < 0) ? "drag" : "scroll";
}

export function clampDrawer(translate: number, width: number) {
  return Math.max(-width, Math.min(0, translate));
}

/** Whether a released drawer should end open. */
export function settleDrawerOpen(
  translate: number,
  width: number,
  velocity: number,
): boolean {
  if (velocity > DRAWER_FLICK_VELOCITY) return true;
  if (velocity < -DRAWER_FLICK_VELOCITY) return false;
  return translate > -width / 2;
}

// Sheets and dialogs stack above the drawer and own their touches.
const OVERLAYS = ".mobile-sheet-backdrop, .mobile-modal-backdrop";
// Text entry keeps its own gestures (caret dragging, selection). Buttons and
// links stay draggable: a drag that starts on them never becomes a click.
const EXCLUDED = `input, textarea, select, [contenteditable]:not([contenteditable='false']), .mobile-composer-dock, ${OVERLAYS}`;

/** Whether a nested element between target and boundary scrolls sideways. */
function insideHorizontalScroller(target: Element, boundary: Element) {
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (node === boundary) break;
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

function canDragFrom(target: EventTarget | null, area: string) {
  if (!(target instanceof Element)) return false;
  const boundary = target.closest(area);
  if (!boundary || target.closest(EXCLUDED)) return false;
  // Code blocks and tables keep their own horizontal scrolling.
  return !insideHorizontalScroller(target, boundary);
}

/** Whether a touch on the conversation may pull the drawer open. */
export function canPullDrawerFrom(target: EventTarget | null): boolean {
  return canDragFrom(target, ".mobile-chat, .mobile-home");
}

/**
 * Whether a touch may push the open drawer closed. The whole screen is a
 * closing area; only overlays stacked above the drawer keep their touches.
 */
export function canPushDrawerFrom(target: EventTarget | null): boolean {
  return target instanceof Element && !target.closest(OVERLAYS);
}
