import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { processFile, type FileDiffOptions } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import {
  prepareReviewDiff,
  reviewFileMetadata,
} from "../features/source-control/model/reviewDiff";
import type { ToolPreviewLine } from "../features/sessions/model/session";
import type { GitFileDiff } from "../platform/tauri/fs";
import { SCHEME_CHANGE_EVENT } from "../features/settings/model/appearance";
import { useTranslation } from "../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";
import type { UnifiedLine } from "../features/source-control/model/unifiedDiff";

const appliedColorScheme = () =>
  document.documentElement.classList.contains("theme-light") ? "light" : "dark";
const subscribeColorScheme = (notify: () => void) => {
  window.addEventListener(SCHEME_CHANGE_EVENT, notify);
  return () => window.removeEventListener(SCHEME_CHANGE_EVENT, notify);
};

function useMobileDiffOptions(wrap: boolean, partial: boolean, onReady?: (ready: boolean) => void) {
  const { t } = useTranslation();
  useEffect(() => () => onReady?.(false), [onReady]);
  // A mobile skin can override the stored desktop color preference before
  // this lazy-loaded panel mounts. Read the scheme actually applied to it.
  const themeType = useSyncExternalStore(subscribeColorScheme, appliedColorScheme);
  const options = useMemo<FileDiffOptions<undefined>>(
    () => ({
      diffStyle: "unified",
      diffIndicators: "bars",
      disableFileHeader: true,
      overflow: wrap ? "wrap" : "scroll",
      hunkSeparators: partial ? "simple" : "line-info",
      lineDiffType: "word-alt",
      maxLineDiffLength: 1000,
      tokenizeMaxLineLength: 1000,
      theme: { light: "pierre-light", dark: "pierre-dark" },
      themeType,
      preferredHighlighter: "shiki-wasm",
      unsafeCSS: `
      :host {
        border: 0;
        border-radius: 0;
        --diffs-bg: var(--color-m-app);
        --diffs-light-bg: var(--color-m-app);
        --diffs-dark-bg: var(--color-m-app);
      }
      [data-code] { touch-action: pan-x pan-y pinch-zoom; }
      [data-column-number] { padding-inline-start: 6px; }
      [data-overflow="wrap"] [data-line] { overflow-wrap: anywhere; }
    `,
      onPostRender(node) {
        if (node.shadowRoot?.querySelector("[data-line], [data-error-wrapper]")) onReady?.(true);
        // Pierre renders these labels inside its shadow root, outside React i18n.
        for (const label of node.shadowRoot?.querySelectorAll<HTMLElement>(
          "[data-unmodified-lines]",
        ) ?? []) {
          const count =
            label.textContent?.match(/^(\d+) unmodified lines?$/)?.[1] ??
            label.dataset.count;
          if (!count) continue;
          label.dataset.count = count;
          label.textContent = t("{count} unmodified lines", { count });
        }
        for (const button of node.shadowRoot?.querySelectorAll<HTMLElement>(
          "[data-expand-button]",
        ) ?? []) {
          const label = t(
            button.hasAttribute("data-expand-up")
              ? "Expand unmodified lines upward"
              : button.hasAttribute("data-expand-down")
                ? "Expand unmodified lines downward"
                : "Expand all",
          );
          button.setAttribute("aria-label", label);
          if (button.hasAttribute("data-expand-all-button"))
            button.textContent = label;
        }
      },
    }),
    [themeType, partial, t, wrap, onReady],
  );
  return { options, themeType };
}

/** An inline diff with horizontal code scrolling and a fixed line-number gutter. */
export function MobileGitDiff({ diff, wrap, onReady }: {
  diff: GitFileDiff;
  wrap: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const { t } = useTranslation();
  // Shared preparation bounds comparison work; large files with small changes
  // use patch-only metadata below instead of highlighting the whole file.
  const prepared = useMemo(() => prepareReviewDiff(diff), [diff]);
  const fileDiff = useMemo(
    () => reviewFileMetadata(diff.relative, prepared),
    [diff.relative, prepared],
  );
  const { options, themeType } = useMobileDiffOptions(wrap, !!fileDiff?.isPartial, onReady);
  const hasText = !prepared.binary && !prepared.tooLarge && !!fileDiff &&
    !!prepared.unified && !!(prepared.unified.additions || prepared.unified.deletions);
  useEffect(() => {
    if (!hasText) onReady?.(true);
  }, [hasText, onReady]);
  const partialReady = useMemo(() => {
    const hunks = prepared.unified?.blocks.flatMap((block, index) => block.kind === "hunk" ? [index] : []) ?? [];
    const ready = new Set<number>();
    return new Map(hunks.map(index => [index, (rendered: boolean) => {
      if (rendered) ready.add(index);
      else ready.delete(index);
      onReady?.(ready.size === hunks.length);
    }]));
  }, [prepared, onReady]);

  if (prepared.binary)
    return <p className="mobile-git-note">{t("Binary file changed")}</p>;
  if (prepared.tooLarge)
    return (
      <p className="mobile-git-note">{t("Diff is too large to display")}</p>
    );
  if (
    !prepared.unified ||
    (!prepared.unified.additions && !prepared.unified.deletions)
  )
    return <p className="mobile-git-note">{t("No textual diff")}</p>;
  if (!fileDiff)
    return (
      <p className="mobile-git-note">{t("Diff is too large to display")}</p>
    );
  if (fileDiff.isPartial)
    return (
      <div className="mobile-git-diff" data-theme={themeType}>
        {prepared.unified.blocks.map((block, index) =>
          block.kind === "fold" ? (
            <MobileDiffContext key={index} lines={block.lines} path={diff.relative} wrap={wrap} />
          ) : (
            <MobileDiffLines key={index} lines={block.lines} path={diff.relative} wrap={wrap} onReady={partialReady.get(index)} />
          ),
        )}
      </div>
    );
  return (
    <div className="mobile-git-diff" data-theme={themeType}>
      <FileDiff fileDiff={fileDiff} options={options} />
    </div>
  );
}

function MobileDiffLines({ lines, path, wrap, onReady }: {
  lines: UnifiedLine[];
  path: string;
  wrap: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const metadata = useMemo(() => {
    const oldLines = lines.filter((line) => line.oldNumber != null);
    const newLines = lines.filter((line) => line.newNumber != null);
    const patch = [
      "--- review", "+++ review",
      `@@ -${oldLines[0]?.oldNumber ?? 0},${oldLines.length} +${newLines[0]?.newNumber ?? 0},${newLines.length} @@`,
      ...lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`),
    ];
    const result = processFile(`${patch.join("\n")}\n`, { throwOnError: true });
    if (result) { result.name = path; result.prevName = path; }
    return result;
  }, [lines, path]);
  const { options } = useMobileDiffOptions(wrap, true, onReady);
  useEffect(() => {
    if (!metadata) onReady?.(true);
  }, [metadata, onReady]);
  return metadata ? <FileDiff fileDiff={metadata} options={options} /> : null;
}

function MobileDiffContext({ lines, path, wrap }: {
  lines: UnifiedLine[];
  path: string;
  wrap: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const tooLarge = lines.length > 1_200 ||
    lines.reduce((total, line) => total + line.text.length + 1, 0) > 180_000;
  return (
    <div className="mobile-diff-context">
      <button type="button" className="mobile-diff-context-toggle"
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {t("{count} unmodified lines", { count: lines.length })}
        {" · "}{t(expanded ? "Collapse" : "Expand all")}
      </button>
      <AnimatedCollapse expanded={expanded} ready={tooLarge || ready}>
        {() => tooLarge ? (
          <p className="mobile-git-note" role="status">{t("Unmodified content is too large to expand. Changes are still shown.")}</p>
        ) : <MobileDiffLines lines={lines} path={path} wrap={wrap} onReady={setReady} />}
      </AnimatedCollapse>
    </div>
  );
}

/** One hunk from a tool call's own preview lines; the file itself is not read. */
function toolPatchMetadata(path: string, lines: ToolPreviewLine[], startLine?: number) {
  const start = lines.find((line) => line.number != null)?.number ?? startLine ?? 1;
  const oldCount = lines.filter((line) => line.kind !== "add").length;
  const newCount = lines.filter((line) => line.kind !== "del").length;
  const patch = [
    "--- review",
    "+++ review",
    `@@ -${oldCount ? start : start - 1},${oldCount} +${newCount ? start : start - 1},${newCount} @@`,
    ...lines.map((line) =>
      `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`),
  ];
  try {
    const metadata = processFile(`${patch.join("\n")}\n`, { throwOnError: true });
    if (metadata) {
      metadata.name = path;
      metadata.prevName = path;
    }
    return metadata;
  } catch {
    return undefined;
  }
}

/** A tool call's edit, drawn like a Git review diff. */
export function MobileToolDiff({ path, lines, startLine, wrap, onReady }: {
  path: string;
  lines: ToolPreviewLine[];
  startLine?: number;
  wrap: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const fileDiff = useMemo(
    () => toolPatchMetadata(path, lines, startLine),
    [path, lines, startLine],
  );
  const { options, themeType } = useMobileDiffOptions(wrap, true, onReady);
  useEffect(() => {
    if (!fileDiff) onReady?.(true);
  }, [fileDiff, onReady]);
  if (!fileDiff) return null;
  return (
    <div className="mobile-git-diff" data-theme={themeType}>
      <FileDiff fileDiff={fileDiff} options={options} />
    </div>
  );
}
