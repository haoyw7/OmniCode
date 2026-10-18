/**
 * One z-index scale for everything that floats over the app chrome. Panels and
 * buttons inside a surface stay below 50; anything that escapes its pane —
 * menus, dialogs, toasts — picks a layer from here so the order is decided in
 * one place instead of by whichever stray `z-50` was written last.
 */
export const LAYER = {
  /** Anchored menus, dropdowns, and pickers. */
  popover: 80,
  /** A flyout hung off an open popover. */
  submenu: 81,
  /** Modal dialogs and the command palette. */
  dialog: 90,
  /** Menus opened from controls inside a modal dialog. */
  dialogPopover: 91,
  /** Native window dragging and controls remain available above dialogs. */
  windowChrome: 95,
  /** Labels that follow the pointer during a drag. */
  dragLabel: 96,
  /** Drop markers stay visible above the dragged card. */
  dragHint: 97,
  /** Toasts, which outrank whatever they interrupt. */
  toast: 100,
  /** Transparent cursor surface during a captured divider gesture. */
  resizeCursor: 101,
} as const;
