/** First paint of progressively mounted lists. */
export const LIST_PAGE_SIZE = 32;

/** Number of leading items to mount, optionally including a required item. */
export function listWindowSize(
  total: number,
  requested: number,
  requiredIndex = -1,
  minimum = LIST_PAGE_SIZE,
): number {
  if (total <= 0) return 0;
  return Math.min(total, Math.max(minimum, requested, requiredIndex + 1));
}
