import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "../shared/i18n/useTranslation";
import { useMobilePageState } from "./mobilePageState";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";

/** Each group owns its preview; extra rows retain the shared collapse lifetime. */
export function MobileListPreview<T>({
  children,
  items,
  renderItem,
  initialLimit = 5,
  minimumVisibleCount = initialLimit,
  batchSize = 5,
  buttonClassName = "mobile-list-more",
  stateKey,
}: {
  initialLimit?: number;
  /** Optional route state; omit for transient search previews. */
  stateKey?: string;
  /** Keep expanded project groups visible even when activity moves them down. */
  minimumVisibleCount?: number;
  batchSize?: number;
  buttonClassName?: string;
} & ({
  children: ReactNode[];
  items?: never;
  renderItem?: never;
} | {
  children?: never;
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
})) {
  const { t } = useTranslation();
  const [visibleCount, setVisibleCount] = useMobilePageState(stateKey, initialLimit);
  const id = useId();
  // Reveal whole existing batches so required rows use the same opening and
  // closing lifetime as Show more / Show less, without moving between parents.
  const previewLimit =
    initialLimit +
    Math.ceil(Math.max(0, minimumVisibleCount - initialLimit) / batchSize) *
      batchSize;
  const visibleLimit = Math.max(visibleCount, previewLimit);
  const count = items?.length ?? children?.length ?? 0;
  const hasMore = visibleLimit < count;
  // Prepare one closed batch ahead so Show more has an entering transition.
  // Previously visited batches retain their collapse lifetime when Show less
  // runs; unopened history never creates rows or hundreds of empty disclosures.
  const preparedLimit = useRef(visibleLimit + batchSize);
  preparedLimit.current = Math.max(preparedLimit.current, visibleLimit + batchSize);
  const rows = (start: number, end: number) => items && renderItem
    ? items.slice(start, end).map((item, index) => renderItem(item, start + index))
    : children?.slice(start, end);
  const batches = Array.from(
    {
      length: Math.ceil(
        Math.max(0, Math.min(count, preparedLimit.current) - initialLimit) / batchSize,
      ),
    },
    (_, index) => {
      const start = initialLimit + index * batchSize;
      return start;
    },
  );
  return (
    <>
      {rows(0, initialLimit)}
      {count > initialLimit && (
        <>
          <div id={id}>
            {batches.map((start) => (
              <AnimatedCollapse key={start} expanded={start < visibleLimit}>
                {() => rows(start, start + batchSize)}
              </AnimatedCollapse>
            ))}
          </div>
          {(hasMore || visibleLimit > previewLimit) && (
            <button
              type="button"
              className={buttonClassName}
              aria-expanded={visibleLimit > previewLimit}
              aria-controls={id}
              onClick={() =>
                setVisibleCount(
                  hasMore ? visibleLimit + batchSize : previewLimit,
                )
              }
            >
              {t(hasMore ? "Show more items" : "Show less")}
            </button>
          )}
        </>
      )}
    </>
  );
}
