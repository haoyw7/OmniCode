import { observeNativeScrollbarEdges } from "../../../shared/ui/nativeScrollbarEdges";
import scrollbarCSS from "../../../shared/ui/scrollbar.css?raw";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
// Adapted from ZCode (Apache-2.0).
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FileDiffOptions } from "@pierre/diffs";
import { FileDiff, Virtualizer, useWorkerPool } from "@pierre/diffs/react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { REVIEW_THEMES } from "./reviewThemes";
import { createReviewSeparatorLayout } from "./reviewSeparatorLayout";
import { MessageSquarePlus, Plus } from "../../../shared/ui/icons";
import {
  reviewCommentLine,
  reviewFileMetadata,
  reviewStageAnnotations,
  virtualizeReviewDiff,
  REVIEW_VIRTUAL_HEIGHT,
  type ReviewLoadedDiff,
} from "../model/reviewDiff";
import {
  DiffCommentComposer,
  type DiffCommentComposerTarget,
} from "./DiffCommentComposer";

const viewerStyle = {
  // Measured in claude-ui-analysis/evidence/diff-shadow-{light,dark}.json.
  // Let Pierre mix line, gutter and word backgrounds once, in separate layers.
  "--diffs-light-bg": "#ffffff",
  "--diffs-dark-bg": "#1a1a19",
  "--diffs-light": "#1a1a1a",
  "--diffs-dark": "#eaecf0",
  "--diffs-light-addition-color": "#1e9e3c",
  "--diffs-dark-addition-color": "#32d74b",
  // The application overrides the Shiki theme's #ff3a30 deletion color.
  "--diffs-deletion-color-override": "light-dark(#cd2054, #ff2c56)",
  "--diffs-light-modified-color": "#0073e6",
  "--diffs-dark-modified-color": "#0099ff",
  "--diffs-fg-number-override": "#898781",
  "--diffs-fg-number-deletion-override": "light-dark(#cd2054, #ff2c56)",
  // Settings → Appearance → Code font and size.
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-features": '"liga", "clig", "calt"',
  "--diffs-header-font-family": "var(--font-sans)",
  "--diffs-font-size": "calc(12px * var(--code-font-scale, 1))",
  "--diffs-line-height": "calc(17px * var(--code-font-scale, 1))",
  "--diffs-min-number-column-width": "3ch",
  "--diffs-gap-inline": "8px",
  "--diffs-gap-block": "4px",
  "--diffs-scrollbar-gutter-override":
    "var(--scrollbar-size, max(var(--scrollbar-min-size, 0px), calc(6px * var(--scrollbar-scale, 1))))",
} as CSSProperties;

const virtualMetrics = {
  hunkLineCount: 50,
  lineHeight: 17,
  diffHeaderHeight: 0,
  hunkSeparatorHeight: 32,
  fileGap: 4,
};

export const ReviewDiffViewer = memo(function ReviewDiffViewer({
  path,
  relative,
  diff,
  busy,
  onReady,
  onStageHunk,
}: {
  path: string;
  relative: string;
  diff: ReviewLoadedDiff;
  busy: boolean;
  onReady?: (ready: boolean) => void;
  onStageHunk?: (pos: number) => void;
}) {
  const { t } = useTranslation();
  const themeType = useColorScheme();
  const workerPool = useWorkerPool();
  const visible = useSurfaceVisibility();
  const separatorLayout = useRef<ReturnType<typeof createReviewSeparatorLayout> | null>(null);
  const scrollbarRoots = useRef(new Map<ShadowRoot, () => void>());
  const onPostRender = useCallback((container: HTMLElement) => {
    separatorLayout.current ??= createReviewSeparatorLayout();
    separatorLayout.current.update(container);
    const root = container.getRootNode();
    if (root instanceof ShadowRoot && !scrollbarRoots.current.has(root)) {
      scrollbarRoots.current.set(root, observeNativeScrollbarEdges(root));
    }
    if (container.shadowRoot?.querySelector("[data-line], [data-error-wrapper]")) onReady?.(true);
  }, [onReady]);
  useEffect(() => () => onReady?.(false), [onReady]);
  useEffect(() => () => {
    separatorLayout.current?.dispose();
    separatorLayout.current = null;
    for (const cleanup of scrollbarRoots.current.values()) cleanup();
    scrollbarRoots.current.clear();
  }, []);
  const [comment, setComment] = useState<DiffCommentComposerTarget | null>(
    null,
  );
  const fileDiff = useMemo(
    () => reviewFileMetadata(relative, diff),
    [diff, relative],
  );
  const virtualized = useMemo(() => virtualizeReviewDiff(diff), [diff]);
  const hasText = !diff.binary && !diff.tooLarge && !!fileDiff &&
    !!diff.unified && !!(diff.unified.additions || diff.unified.deletions);
  useEffect(() => {
    if (!hasText) onReady?.(true);
  }, [hasText, onReady]);
  const ScrollContainer = virtualized ? Virtualizer : Fragment;
  useEffect(() => {
    setComment(null);
  }, [diff, path, visible]);
  const options = useMemo<FileDiffOptions<number>>(
    () => ({
      diffStyle: "unified",
      diffIndicators: "classic",
      disableFileHeader: true,
      hunkSeparators: fileDiff?.isPartial ? "simple" : "line-info",
      lineDiffType: virtualized ? "none" : "word-alt",
      maxLineDiffLength: 1000,
      tokenizeMaxLineLength: 1000,
      overflow: "wrap",
      onPostRender,
      // The viewer's shadow root does not inherit the global scrollbar rules.
      unsafeCSS: `
        [data-diff] {
          font-weight: var(--code-font-weight, 400);
          letter-spacing: 0;
          letter-spacing: calc(round(up, 1ch, 1px / 64) - 1ch);
        }
        [data-overflow="wrap"] {
          --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr);
        }
        [data-overflow="wrap"] [data-unified][data-container-size] {
          container-type: normal;
        }
        [data-overflow="wrap"] [data-unified] [data-separator="line-info"] [data-separator-wrapper] {
          width: 100%;
        }
        /* Pierre measures these for sticky annotations in scroll mode. In
           wrap mode they are unused; keep its inline width updates from
           invalidating inherited styles on every syntax token during resize. */
        [data-overflow="wrap"] [data-code] {
          --diffs-column-content-width: initial !important;
          --diffs-column-width: initial !important;
          --diffs-column-number-width: initial !important;
        }
        [data-overflow="wrap"] [data-line] {
          min-height: 1lh;
        }
        [data-gutter-utility-slot] {
          right: unset;
          left: 5px;
          justify-content: flex-start;
        }
        [data-separator="line-info"],
        [data-separator="line-info"] [data-expand-button],
        [data-separator="line-info"] [data-separator-content] {
          background: transparent;
          border-radius: 0;
        }
        [data-separator-wrapper] {
          padding-left: 8px;
          grid-template-columns: 16px auto;
          gap: 4px;
        }
        [data-separator-wrapper][data-separator-multi-button] {
          grid-template-columns: 16px 16px auto;
        }
        [data-expand-button] {
          min-width: 16px;
          border-right: 0;
        }
        [data-separator-content] {
          grid-column-start: -2;
          padding: 0;
        }
        [data-code] {
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-gutter: auto;
          scrollbar-width: auto;
          scrollbar-color: auto;
        }
        /* Wrapped code scrolls with the review list. Avoid an extra scroll
           container (and its resize work) for each rendered file. */
        [data-overflow="wrap"] [data-code] {
          overflow: clip;
        }
        ${scrollbarCSS}
      `,
      theme: REVIEW_THEMES,
      themeType,
      preferredHighlighter: "shiki-wasm",
      enableGutterUtility: visible,
    }),
    [themeType, visible, fileDiff?.isPartial, virtualized, onPostRender],
  );
  const annotations = useMemo(
    () =>
      onStageHunk && diff.unified
        ? reviewStageAnnotations(diff.unified.lines)
        : [],
    [diff, onStageHunk],
  );

  if (diff.binary) return <Empty>{t("Binary file changed")}</Empty>;
  if (diff.tooLarge) return <Empty>{t("Diff is too large to display")}</Empty>;
  if (!diff.unified || (!diff.unified.additions && !diff.unified.deletions))
    return <Empty>{t("No textual diff")}</Empty>;
  if (!fileDiff) return <Empty>{t("Could not load diff.")}</Empty>;

  return (
    <div
      className="w-full min-w-0 overflow-x-auto overflow-y-hidden"
      data-review-diff
      style={viewerStyle}
    >
      <ScrollContainer {...(virtualized ? {
        className: "review-diff-virtual overflow-auto",
        style: { height: `min(${REVIEW_VIRTUAL_HEIGHT}px, 70vh)` },
      } : {})}>
      <FileDiff<number>
        key={workerPool ? "worker" : "main"}
        fileDiff={fileDiff}
        metrics={virtualized ? virtualMetrics : undefined}
        className="block min-h-full w-full"
        options={options}
        style={viewerStyle}
        lineAnnotations={annotations}
        renderAnnotation={({ metadata }) => (
          <div className="review-stage-hunk flex items-center px-2 py-1">
            <button
              type="button"
              disabled={busy || !visible}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[11px] text-content/60 hover:bg-content/6 disabled:opacity-40"
              onClick={() => onStageHunk?.(metadata)}
            >
              <Plus className="size-3" />
              {t("Stage hunk")}
            </button>
          </div>
        )}
        renderGutterUtility={(getHoveredLine) => (
          <button
            type="button"
            title={t("Comment on line")}
            aria-label={t("Comment on line")}
            disabled={!visible}
            className="grid size-5 place-items-center rounded bg-content text-background-base hover:opacity-80"
            onClick={(event) => {
              const hovered = getHoveredLine();
              if (!visible || !hovered) return;
              const line = reviewCommentLine(
                diff.unified!.lines,
                hovered.side,
                hovered.lineNumber,
              );
              if (line)
                setComment({
                  line,
                  anchor: event.currentTarget.getBoundingClientRect(),
                });
            }}
          >
            <MessageSquarePlus className="size-3" />
          </button>
        )}
      />
      </ScrollContainer>
      <PresenceBoundary propagate>{visible && comment ? (
        <DiffCommentComposer
          path={path}
          target={comment}
          onDismiss={() => setComment(null)}
        />
      ) : null}</PresenceBoundary>
    </div>
  );
});

function Empty({ children }: { children: string }) {
  return (
    <p className="px-4 py-3 text-ui-base text-foreground-subtle">{children}</p>
  );
}
