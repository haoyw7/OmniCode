import { useState } from "react";
import { useLivePhaseScroll } from "../useLivePhaseScroll";

/**
 * What a call printed. A running command's output scrolls in a short window
 * pinned to its newest line; once it settles the window keeps its place.
 */
export function ToolOutput({
  text,
  live,
  failed,
}: {
  text: string;
  live: boolean;
  failed: boolean;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useLivePhaseScroll(scroller, live, text);
  return (
    <div
      ref={setScroller}
      data-tool-output=""
      className="zen-detail-panel max-h-60 overflow-auto"
    >
      <pre
        className={`whitespace-pre-wrap break-words ${
          failed ? "text-red-400/80" : ""
        }`}
      >
        {text}
      </pre>
    </div>
  );
}
