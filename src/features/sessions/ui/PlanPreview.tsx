import { Button } from "../../../shared/ui/forms/Button";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  Check,
  Copy,
  Download,
  ChevronDown,
  ListChecks,
  PanelRight,
  Play,
} from "../../../shared/ui/icons";
import { planTitle } from "../model/plan";
import { planBuildable } from "../model/planDecision";
import type {
  HarnessId,
  PlanBlockMeta,
  PlanBuildTarget,
} from "../model/session";
import { AgentMarkdown } from "./AgentMarkdown";
import { BuildTargetButton } from "./SecondOpinionButton";
import { TranscriptPlatformContext } from "./TranscriptPlatform";

type Props = {
  text: string;
  streaming?: boolean;
  busy?: boolean;
  plan?: PlanBlockMeta;
  harness?: HarnessId;
  model?: string;
  modelSettings?: Record<string, string>;
  cwd?: string;
  /** The decision card below owns Build, so the header omits it. */
  deciding?: boolean;
  /** Desktop opens the plan in a pane; other clients open their own view. */
  paneButton?: boolean;
  onOpen?: () => void;
  onBuild?: (target?: PlanBuildTarget) => void;
};

/** A safe Markdown file name drawn from the plan's title. */
export function planFileName(text: string): string {
  const name = planTitle(text)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${name || "plan"}.md`;
}

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-content/60 hover:bg-content/5 hover:text-content disabled:opacity-40";

/** Copy and download actions shared by the inline card and full plan views. */
export function PlanActions({ text }: { text: string }) {
  const { t: uiT } = useTranslation();
  const { copyText, saveText } = useContext(TranscriptPlatformContext);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <>
      {saveText ? (
        <button
          type="button"
          className={`plan-card-action ${iconButton}`}
          title={uiT("Download")}
          aria-label={uiT("Download")}
          disabled={!text.trim()}
          onClick={() => void saveText(planFileName(text), text).catch(() => undefined)}
        >
          <Download className="size-4" />
        </button>
      ) : null}
      <button
        type="button"
        className={`plan-card-action ${iconButton}`}
        title={uiT(copied ? "Copied" : "Copy")}
        aria-label={uiT(copied ? "Copied" : "Copy")}
        disabled={!text.trim()}
        onClick={() =>
          void copyText(text).then(() => setCopied(true), () => undefined)
        }
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </>
  );
}

export function PlanPreview({
  text,
  streaming,
  busy,
  plan,
  harness,
  model,
  modelSettings,
  cwd,
  deciding,
  paneButton = true,
  onOpen,
  onBuild,
}: Props) {
  const { t: uiT } = useTranslation();
  const body = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () =>
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const status =
    plan?.status === "building"
      ? uiT("Building…")
      : plan?.status === "built"
        ? uiT("Built")
        : undefined;
  const showBuild = !!onBuild && !deciding && planBuildable(text, plan, streaming);

  return (
    <div className="plan-card mb-2 overflow-hidden rounded-[16px] border border-content/10 panel-base">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <ListChecks className="size-4 shrink-0 text-content/50" />
        <span className="font-sans text-[13px] text-content/60">
          {uiT("Plan")}
        </span>
        {status ? (
          <span className="font-sans text-[12px] text-content/40">
            · {status}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          {showBuild ? (
            <div className="mr-1 flex items-center font-sans">
              <button
                type="button"
                title={uiT("Build this plan")}
                disabled={busy}
                className={`flex h-6 shrink-0 items-center gap-1 bg-content px-2 font-sans text-[11px] text-background-base hover:bg-content/90 disabled:cursor-not-allowed disabled:opacity-40 ${
                  harness ? "rounded-l-md" : "rounded-md"
                }`}
                onClick={() => onBuild()}
              >
                <Play className="size-3" />
                {uiT("Build")}
              </button>
              {harness ? (
                <BuildTargetButton
                  from={harness}
                  model={model}
                  settings={modelSettings}
                  disabled={busy}
                  onPick={onBuild}
                />
              ) : null}
            </div>
          ) : null}
          <PlanActions text={text} />
          {onOpen && paneButton ? (
            <button
              type="button"
              className={`plan-card-action ${iconButton}`}
              title={uiT("Open plan in pane")}
              aria-label={uiT("Open plan in pane")}
              onClick={onOpen}
            >
              <PanelRight className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div
        ref={body}
        className={`plan-card-body relative max-h-[220px] overflow-hidden px-4 pb-3 ${onOpen ? "cursor-pointer" : ""}`}
        onClick={(event) => {
          if (!onOpen) return;
          if ((event.target as HTMLElement).closest("a,button,summary")) return;
          // Let a reader select text without opening the plan.
          if (window.getSelection()?.toString()) return;
          onOpen();
        }}
      >
        <AgentMarkdown text={text} streaming={streaming} cwd={cwd} />
        {overflowing ? (
          <div className="plan-card-fade pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-background-base" />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Asks whether to implement the latest plan, revise it, or move on. It takes
 * the question panel's place above the composer and shares its styling.
 */
export function PlanDecision({
  busy,
  onImplement,
  onRevise,
  onSkip,
  onCollapse,
}: {
  busy?: boolean;
  onImplement: () => boolean | void;
  onRevise: (feedback: string) => boolean | void;
  onSkip: () => void;
  onCollapse?: () => void;
}) {
  const { t: uiT } = useTranslation();
  const [feedback, setFeedback] = useState("");
  const ready = !!feedback.trim() && !busy;
  return (
    <div
      className="flex min-h-0 flex-col px-1.5 pb-1.5"
      data-question-form
      data-plan-decision
    >
      <form
        className="flex min-h-0 flex-col rounded-lg border border-content/10 bg-content/3 px-3 py-2.5"
        data-question-card
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && onRevise(feedback.trim()) !== false) setFeedback("");
        }}
      >
        <div className="flex shrink-0 items-center gap-1.5" data-question-header>
          <ListChecks
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span
            className="min-w-0 flex-1 truncate text-[11px] text-content/50"
            data-question-title
          >
            {uiT("Plan")}
          </span>
          <Button variant="secondary"
            type="button"
            className="h-6 shrink-0 rounded-md px-1.5 text-[11px] text-content/55 hover:bg-content/6 hover:text-content"
            data-question-secondary
            onClick={onSkip}
          >
            {uiT("Skip")}
          </Button>
          {onCollapse ? (
            <button
              type="button"
              aria-label={uiT("Collapse question")}
              title={uiT("Collapse question")}
              className="grid size-6 shrink-0 place-items-center rounded-md text-content/55 hover:bg-content/6 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
              data-question-collapse
              onClick={onCollapse}
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="mt-2 min-h-0" data-question-body>
          <p
            className="text-[13px] font-medium leading-snug text-content"
            data-question-prompt
          >
            {uiT("Implement this plan?")}
          </p>
          <div
            className="mt-1.5 flex flex-col gap-1"
            role="group"
            data-question-options
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => onImplement()}
              data-question-option
              className="flex w-full items-start gap-2 rounded-md border border-content/10 px-2 py-1.5 text-left hover:bg-content/3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40"
            >
              <span
                className="min-w-0 flex-1 text-[12px] text-content"
                data-question-label
              >
                {uiT("Yes, implement this plan")}
              </span>
            </button>
            <input data-ui="input"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder={uiT("No, describe what to change")}
              aria-label={uiT("No, describe what to change")}
              className="w-full rounded-md border border-content/15 bg-transparent px-2 py-1 text-[12px] text-content outline-none placeholder:text-content/35 focus:border-content/30"
            />
          </div>
        </div>
        {feedback.trim() ? (
          <div
            className="mt-2.5 flex shrink-0 items-center justify-end gap-2"
            data-question-footer
          >
            <Button variant="primary"
              type="submit"
              disabled={!ready}
              className="h-6 rounded-md bg-content px-2.5 text-[11px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
              data-question-submit
            >
              {uiT("Send")}
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
