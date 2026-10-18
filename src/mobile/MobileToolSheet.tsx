import { IconButton } from "../shared/ui/forms/IconButton";
import { Button } from "../shared/ui/forms/Button";
import { motion } from "motion/react";
import { motionGeometry, panelTransition } from "../shared/motion/tokens";
import { useContext, useId, useMemo, useState, type ReactNode } from "react";
import { isLongText, ReadonlyTextView } from "../shared/ui/ReadonlyTextView";
import { isReadTool } from "../integrations/harness/core/preview";
import { FilePreview } from "../features/connections/files/ui/FilePreview";
import { TranscriptPlatformContext } from "../features/sessions/ui/TranscriptPlatform";
import {
  editVerb,
  toolCallLabel,
  toolCallState,
  toolCategory,
} from "../features/sessions/model/transcriptActivity";
import type { Block } from "../features/sessions/model/session";
import { displayPath, resolveWorkspacePath } from "../shared/lib/paths";
import { useTranslation } from "../shared/i18n/useTranslation";
import { Check, ChevronRight, Copy, File as FileIcon, LoaderCircle, WrapText } from "../shared/ui/icons";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";
import { TranscriptContentMotion, useMessageArrivals } from "../features/sessions/ui/TranscriptContentMotion";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobileSheet, MobileSheetHeader } from "./MobileSheet";
import { MobileDiffCounts } from "./MobileDiffCounts";
import { MobileToolDiff } from "./MobileGitDiff";
import "./styles/git-review.css";

const MotionChevronRight = motion.create(ChevronRight);

type ReadOutput = { count: number; start?: number; end?: number };

/** Numbered results identify a range; plain output only identifies a count. */
function returnedReadLines(output: string): ReadOutput {
  const lines = output.trimEnd().split(/\r?\n/);
  const numbers = lines.map((line) => {
    const match = /^\s*(\d+)[\t→]/.exec(line);
    return match ? Number(match[1]) : NaN;
  });
  const start = numbers[0];
  if (
    start > 0 &&
    numbers.every(
      (number, index) =>
        Number.isSafeInteger(number) && number === start + index,
    )
  ) {
    return { count: lines.length, start, end: numbers[numbers.length - 1] };
  }
  return { count: lines.length };
}

/** The parts of a tool call worth reading on a phone, in display order. */
export function toolDetails(block: Block, cwd?: string) {
  const tool = block.tool;
  const label = toolCallLabel(block, cwd);
  const preview = tool?.preview;
  const state = toolCallState(block);
  const detail = tool?.detail?.trim();
  const body = detail && detail !== label ? detail : undefined;
  const result = preview?.output?.trimEnd() || undefined;
  // Most adapters replace detail with the returned text on completion. Older
  // shell previews may carry output separately and leave the request in detail.
  const output = tool?.output ?? result ?? (state !== "pending" ? body : undefined);
  const input = tool?.input ?? (result && body && body !== result ? body : undefined);
  // A running detail can be a request or partial output; do not mislabel it.
  const details = !input && !output ? body : undefined;
  const path = preview?.path
    ? (resolveWorkspacePath(preview.path, cwd) ?? preview.path)
    : undefined;
  const showsDiff =
    !!preview &&
    (preview.contentOnly ||
      !!preview.lines?.some((line) => line.kind !== "context"));
  return {
    label,
    state,
    input,
    output,
    details,
    readOutput:
      output && state === "accepted" && isReadTool(tool?.kind, label, preview)
        ? returnedReadLines(output)
        : undefined,
    path,
    preview: showsDiff ? preview : undefined,
  };
}

const STATE_LABEL = {
  accepted: "Completed",
  rejected: "Failed",
  pending: "Running",
} as const;

/** Bottom sheet with a finished tool call's input, output and diff. */
export function MobileToolSheet({
  open = true,
  onExited,
  block,
  cwd,
  onOpenFile,
  onBack,
  onClose,
  embedded = false,
}: {
  open?: boolean;
  onExited?: () => void;
  block: Block;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  /** Returns to the step list this call was opened from. */
  onBack?: () => void;
  onClose: () => void;
  /** Render as a page inside the activity sheet's navigation stack. */
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const { copyText } = useContext(TranscriptPlatformContext);
  const [copied, setCopied] = useState<string>();
  const [wrap, setWrap] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(true);
  const [diffReady, setDiffReady] = useState(false);
  const diffId = useId();
  const { label, state, input, output, details, readOutput, path, preview } =
    useMemo(() => toolDetails(block, cwd), [block, cwd]);
  const arrives = useMessageArrivals(
    ["call", ...(input ? ["input"] : []), ...(output ? ["output"] : []), ...(details ? ["details"] : [])]
      .map(id => ({ id: `${block.id}:${id}` })),
    useSurfaceVisibility() && open,
  );

  const copy = (key: string, text: string) => {
    void copyText(text).then(() => {
      setCopied(key);
      window.setTimeout(
        () => setCopied((value) => (value === key ? undefined : value)),
        1200,
      );
    });
  };

  const outputNotice = readOutput ? (
    <p className="mobile-detail-note mobile-read-notice" role="note">
      <span>
        {readOutput.start === 1
          ? t(
              "Tool returned the first {count} lines; this may not be the complete file.",
              { count: readOutput.count },
            )
          : readOutput.start !== undefined
            ? t(
                "Tool returned lines {start}–{end}; this may not be the complete file.",
                { start: readOutput.start, end: readOutput.end! },
              )
            : t(
                "Tool returned {count} lines; this may not be the complete file.",
                { count: readOutput.count },
              )}
      </span>
      {path && onOpenFile ? (
        <span>{t("Tap “View file” to see the complete contents.")}</span>
      ) : null}
    </p>
  ) : undefined;

  const section = (
    key: string,
    title: string,
    text: string,
    notice?: ReactNode,
  ) => (
    <TranscriptContentMotion key={key} arrive={arrives(`${block.id}:${key}`)}>
      <section className="mobile-detail-section">
        <div className="mobile-detail-section-head">
          <h3>{t(title)}</h3>
          <button
            type="button"
            className="mobile-detail-copy"
            aria-label={t(copied === key ? "Copied" : "Copy")}
            onClick={() => copy(key, text)}
          >
            {copied === key ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        {notice}
        {isLongText(text)
          ? <ReadonlyTextView text={text} stateKey={`${block.id}:${key}`} />
          : <pre className="mobile-detail-pre">{text}</pre>}
      </section>
    </TranscriptContentMotion>
  );

  // The sheet is titled by the tool, like "Bash" or "Read"; the call itself
  // is the first section, so a long command never crowds the title row.
  const reviewDiff = !!path && !!preview?.lines?.length;
  const verb = toolCategory(block) === "edit" ? editVerb(label) : (label.split(/\s/, 1)[0] ?? "");
  const name = verb ? verb[0].toUpperCase() + verb.slice(1) : t("Tool details");
  const content = (
      <div className="mobile-tool-sheet" data-state={state}>
        {/* A command the call did not echo back as input is shown under the title. */}
        {toolCategory(block) === "run" && !input
          ? section("call", "Command", label)
          : null}
        {preview ? (
          <div className="mobile-detail-section mobile-tool-diff">
            {reviewDiff && path ? (
              // The call's own diff opens in place, styled like the Git review.
              <div className="mobile-git-file-entry">
                <button
                  type="button"
                  className="mobile-git-file-row"
                  aria-expanded={diffExpanded}
                  aria-busy={diffExpanded && !diffReady || undefined}
                  aria-controls={diffId}
                  title={path}
                  onClick={() => setDiffExpanded((value) => !value)}
                >
                  {diffExpanded && !diffReady ? (
                    <LoaderCircle size={16} aria-hidden="true" className="mobile-git-file-chevron motion-safe:animate-spin" />
                  ) : (
                    <MotionChevronRight size={16} aria-hidden="true" className="mobile-git-file-chevron" animate={{ rotate: diffExpanded ? motionGeometry.disclosureAngle : 0 }} transition={panelTransition} />
                  )}
                  <span className="mobile-git-file-path"><bdi dir="ltr">{displayPath(path, cwd)}</bdi></span>
                  <MobileDiffCounts additions={preview.additions ?? 0} deletions={preview.deletions ?? 0} />
                </button>
                <AnimatedCollapse expanded={diffExpanded} ready={diffReady} motion="height">
                  <div id={diffId} className="mobile-git-file">
                    <MobileToolDiff path={displayPath(path, cwd)} lines={preview.lines!}
                      startLine={preview.startLine} wrap={wrap} onReady={setDiffReady} />
                  </div>
                </AnimatedCollapse>
              </div>
            ) : <FilePreview
              key={path ?? block.id}
              preview={preview}
              status={state}
              cwd={cwd}
              variant="list"
            />}
          </div>
        ) : null}
        {input ? section("input", "Input", input) : null}
        {output ? section("output", "Output", output, outputNotice) : null}
        {details ? section("details", "Details", details) : null}
        {!preview && !input && !output && !details ? (
          <p className="mobile-muted mobile-detail-note">
            {t("This tool call has no further details.")}
          </p>
        ) : null}
        {path && onOpenFile ? (
          <Button variant="secondary"
            type="button"
            className="mobile-detail-action"
            onClick={() => onOpenFile(path)}
          >
            <FileIcon size={16} />
            {t("View file")}
          </Button>
        ) : null}
      </div>
  );
  const header = { title: name, subtitle: t(STATE_LABEL[state]), action: reviewDiff ? (
    <IconButton
      type="button"
      className="mobile-sheet-header-button mobile-git-wrap"
      label={t("Wrap lines")}
      title={t("Wrap lines")}
      aria-pressed={wrap}
      onClick={() => setWrap((value) => !value)}
    >
      <WrapText size={22} />
    </IconButton>
  ) : undefined };
  if (embedded) return (
    <>
      <MobileSheetHeader {...header} onBack={onBack} onClose={onClose} />
      <div className="mobile-sheet-page-scroll" data-mobile-page-scroll>{content}</div>
    </>
  );
  return (
    <MobileSheet open={open} onExited={onExited} title="Tool details" onBack={onBack} onClose={onClose}
      detents header={header}>
      {content}
    </MobileSheet>
  );
}
