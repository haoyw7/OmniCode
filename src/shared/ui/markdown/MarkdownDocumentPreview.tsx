import { memo, useMemo, useState } from "react";
import { splitMarkdownFrontmatter } from "../../lib/markdownFrontmatter";
import { AnimatedCollapse } from "../AnimatedCollapse";
import { DisclosureChevron } from "../DisclosureChevron";
import type { OpenFileFn } from "../../lib/fileNavigation";
import { MarkdownPreview } from "./AgentMarkdown";

export const MarkdownDocumentPreview = memo(function MarkdownDocumentPreview({
  text,
  metadataLabel,
  cwd,
  onOpenFile,
}: {
  text: string;
  metadataLabel: string;
  cwd?: string;
  onOpenFile?: OpenFileFn;
}) {
  const document = useMemo(() => splitMarkdownFrontmatter(text), [text]);
  const [metadataExpanded, setMetadataExpanded] = useState(false);

  return (
    <MarkdownPreview
      text={document.body}
      cwd={cwd}
      onOpenFile={onOpenFile}
      hardBreaks
      header={
        document.metadata !== null ? (
          <div className="mb-6 rounded-lg border border-content/10 bg-content/[0.03]">
            <button
              type="button"
              aria-expanded={metadataExpanded}
              onClick={() => setMetadataExpanded((value) => !value)}
              className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-left text-[12px] text-content/60 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <DisclosureChevron expanded={metadataExpanded} aria-hidden="true" className="size-3.5 shrink-0 text-content/50" />
              {metadataLabel}
            </button>
            <AnimatedCollapse expanded={metadataExpanded}>
              <pre className="whitespace-pre-wrap break-words border-t border-stroke px-3 py-2 font-mono text-[12px] leading-5 text-content/70">
                {document.metadata}
              </pre>
            </AnimatedCollapse>
          </div>
        ) : null
      }
    />
  );
});
