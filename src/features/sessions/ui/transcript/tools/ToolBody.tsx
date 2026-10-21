import { cn } from "../../../../../shared/lib/cn";
import { Fragment, useMemo, useState } from "react";
import { shellOutputDiffLines } from "../../../model/shellOutputDiff";
import { useLivePhaseScroll } from "../useLivePhaseScroll";

/**
 * What a call printed. A running command's output scrolls in a short window
 * pinned to its newest line; once it settles the window keeps its place.
 * `shell` output hangs off the command's rail and tints diff lines.
 */
export function ToolOutput({
  text,
  live,
  failed,
  shell = false,
}: {
  text: string;
  live: boolean;
  failed: boolean;
  shell?: boolean;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useLivePhaseScroll(scroller, live, text);
  const diff = useMemo(
    () => (shell && !failed ? shellOutputDiffLines(text) : undefined),
    [shell, failed, text],
  );
  const lines = diff ? text.split("\n") : undefined;
  return (
    <div
      ref={setScroller}
      data-tool-output=""
      className={cn(shell ? "zen-shell-output" : "zen-detail-panel", "max-h-60 overflow-auto")}
    >
      <pre
        className={cn("whitespace-pre-wrap break-words", failed ? "text-red-400/80" : "")}
      >
        {lines && diff
          ? lines.map((line, index) => (
              <Fragment key={index}>
                {index > 0 ? "\n" : null}
                {diff[index] === "plain" ? (
                  line
                ) : (
                  <span data-diff-line={diff[index]}>{line}</span>
                )}
              </Fragment>
            ))
          : text}
      </pre>
    </div>
  );
}
