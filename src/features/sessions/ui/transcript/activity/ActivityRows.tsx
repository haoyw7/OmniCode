import { DisclosureChevron } from "../../../../../shared/ui/DisclosureChevron";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { localizeChildExitError } from "../../../../../integrations/harness/core/childErrors";
import { CircleAlert } from "../../../../../shared/ui/icons";
import { useState } from "react";
import { localizeOrchestrationMessage } from "../../../../orchestration/ui/orchestrationMessages";
import { AnimatedCollapse } from "../../../../../shared/ui/AnimatedCollapse";
import type { ApprovalDecision } from "../../../../../integrations/harness";
import { ToolRow } from "../tools/ToolRow";
import { useLivePhaseScroll } from "../useLivePhaseScroll";
import { type Block } from "../../../model/session";
import { AgentMarkdown } from "../../AgentMarkdown";
import { proseSummary } from "../../../model/transcriptActivity";
import { monoCodeToolCall } from "../../../model/monocodeToolCall";
import { INTERJECTION_BODY, interjectionChrome } from "../Dividers";
import { ActivityPhaseIcon } from "./ActivityPhaseIcon";
import { formatElapsed, useElapsedFrom } from "../transcriptClock";
import { MonoCodeCallRow } from "../ToolCall";



/** A status row folded into the trail: one muted line, nothing to open. */
export function ActivityStatusRow({ block }: { block: Block }) {
  const { t } = useTranslation();
  const text = localizeOrchestrationMessage(
    localizeChildExitError(block.text, t),
    t,
  );
  return (
    <div className="flex min-w-0 items-center gap-1.5 py-1">
      <CircleAlert
        aria-hidden="true"
        className="size-3.5 shrink-0 text-content/45"
        strokeWidth={1.75}
      />
      <span
        title={text}
        className="min-w-0 flex-1 truncate font-sans text-sm text-foreground-subtlest"
      >
        {text.trim()}
      </span>
    </div>
  );
}

/**
 * An interjection inside the work trail: one compact line naming where it came
 * from and what it said. It opens on a click, so folding the work never costs
 * you a note you wanted to read.
 */
export function ActivityInterjectionRow({ block }: { block: Block }) {
  const { t: uiT } = useTranslation();
  const [open, setOpen] = useState(false);
  const meta = block.interjection;
  if (!meta) return null;
  const chrome = interjectionChrome(meta);
  const summary = proseSummary(block.text);
  const label = (
    <span className="min-w-0 flex-1 truncate font-sans text-sm">
      <span className="text-content/55">{chrome.label}</span>
      {chrome.severityText ? (
        <span className={`text-[11px] ${chrome.severityClass}`}>
          {" "}
          {chrome.severityText}
        </span>
      ) : null}
      {summary ? (
        <span className="text-foreground-subtlest transition-colors duration-200 group-hover:text-content/75">
          {" · "}
          {summary}
        </span>
      ) : null}
    </span>
  );

  if (!block.text.trim()) {
    return (
      <div
        aria-label={uiT("{value0} note", { value0: String(chrome.label) })}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        <ActivityPhaseIcon kind="note" />
        {label}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={
          open
            ? uiT("Hide the {value0} note", { value0: String(chrome.label) })
            : `${chrome.label}: ${summary}`
        }
        onClick={() => setOpen((value) => !value)}
        className="group flex min-w-0 items-center gap-1.5 py-1 text-left"
      >
        <ActivityPhaseIcon kind="note" />
        {label}
      </button>
      <AnimatedCollapse expanded={open}>
        <div className="min-w-0 pb-2">
          <pre className={INTERJECTION_BODY}>{block.text}</pre>
        </div>
      </AnimatedCollapse>
    </div>
  );
}

/**
 * The line that keeps a long think from reading as a stall: how long the
 * agent has been thinking, or thought, and the thought's first line. Opening
 * the fold around it does not open the thought itself — reasoning is only ever
 * read on purpose, one line until you ask for it. Opened while it streams, the
 * thought scrolls in a short window pinned to its newest line.
 */
export function ActivityThinkingRow({
  block,
  cwd,
  expandable = false,
  onOpenFile,
}: {
  block: Block;
  cwd?: string;
  expandable?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const [open, setOpen] = useState(false);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const streaming = !!block.streaming;
  useLivePhaseScroll(scroller, open && streaming, block.text);
  const elapsed = useElapsedFrom(block.startedAt, !streaming);
  const summary = proseSummary(block.text);
  // Thoughts from before timing was recorded keep their one-line summary.
  const timing = streaming
    ? block.startedAt != null
      ? uiT("Thinking for {value0}", { value0: formatElapsed(elapsed) ?? "" })
      : uiT("Thinking")
    : block.durationMs != null
      ? uiT("Thought for {value0}", {
          value0: formatElapsed(block.durationMs) ?? "",
        })
      : undefined;
  const text = timing
    ? summary
      ? `${timing} · ${summary}`
      : timing
    : summary || uiT("Thinking");
  const content = timing ? (
    <>
      <span className="text-content/60">{timing}</span>
      {summary ? (
        <span>
          {" · "}
          {summary}
        </span>
      ) : null}
    </>
  ) : (
    text
  );
  const pulse = streaming ? "zen-thinking-pulse" : "";
  const icon = <ActivityPhaseIcon kind="think" className={pulse} />;
  const label = (
    <span
      className="min-w-0 flex-1 truncate font-sans text-sm text-foreground-subtlest"
    >
      {content}
    </span>
  );

  if (!expandable) {
    return (
      <div
        aria-label={uiT("Thinking: {value0}", { value0: String(text) })}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {icon}
        {label}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={
          open
            ? uiT("Hide thinking")
            : uiT("Show thinking: {value0}", { value0: String(text) })
        }
        onClick={() => setOpen((value) => !value)}
        className="group flex min-w-0 items-center gap-1.5 py-1 text-left"
      >
        {icon}
        <span
          className="min-w-0 flex-1 truncate font-sans text-sm text-foreground-subtlest transition-colors duration-200 group-hover:text-content/75"
        >
          {content}
        </span>
        <DisclosureChevron expanded={open} className="size-3.5 shrink-0" />
      </button>
      <AnimatedCollapse expanded={open}>
        {() => (
          <div
            ref={setScroller}
            className={`zen-detail-panel ${
              streaming ? "max-h-60 overflow-auto" : ""
            }`}
          >
            <AgentMarkdown
              className="agent-reasoning"
              text={block.text}
              cwd={cwd}
              onOpenFile={onOpenFile}
            />
          </div>
        )}
      </AnimatedCollapse>
    </div>
  );
}

/**
 * A line the agent wrote mid-run, kept to one line. It opens on click, so
 * folding the work never costs you a paragraph you wanted to read.
 */
export function ActivityNoteRow({
  block,
  cwd,
  expandable = false,
  onOpenFile,
}: {
  block: Block;
  cwd?: string;
  expandable?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const [open, setOpen] = useState(false);
  const text = proseSummary(block.text);
  const icon = <ActivityPhaseIcon kind="note" />;

  if (!expandable) {
    return (
      <div
        aria-label={uiT("Agent said: {value0}", { value0: String(text) })}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-content/70">
          {text}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={
          open
            ? uiT("Hide the full note")
            : uiT("Agent said: {value0}", { value0: String(text) })
        }
        onClick={() => setOpen((value) => !value)}
        className="group flex min-w-0 items-center gap-1.5 py-1 text-left"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-content/70 transition-colors duration-200 group-hover:text-content">
          {text}
        </span>
      </button>
      <AnimatedCollapse expanded={open}>
        {() => (
          <div className="min-w-0 pb-2">
            <AgentMarkdown text={block.text} cwd={cwd} onOpenFile={onOpenFile} />
          </div>
        )}
      </AnimatedCollapse>
    </div>
  );
}

export function ActivityToolRow({
  block,
  cwd,
  live = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const appCall = monoCodeToolCall(block);
  if (appCall) {
    return (
      <MonoCodeCallRow block={block} call={appCall} onApproval={onApproval} />
    );
  }
  return (
    <ToolRow
      block={block}
      cwd={cwd}
      live={live}
      variant="activity"
      compact
      onApproval={onApproval}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
}
