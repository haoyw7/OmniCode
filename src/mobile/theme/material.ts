/**
 * Surfaces that carry the floating material. Keep in step with the selector
 * list in styles/02-material.css.
 */
export const MOBILE_MATERIAL_SELECTOR = [
  '.mobile-header[data-floating="true"] > :not([data-capsule="false"])',
  ".mobile-composer",
  ".mobile-composer-card > .mobile-composer-context",
  ".mobile-composer-card > .mobile-composer-input",
  ".mobile-jump",
  ".mobile-queue-pill",
  ".mobile-progress-capsule",
  ".mobile-glass-preview-chip",
  ".mobile-drawer",
  ".mobile-sheet",
  ".mobile-shared-question",
  ".popover-backdrop",
].join(", ");
