import { PresenceBoundary } from "../../../../shared/ui/PresenceBoundary";
import { formatGenerationRate, sanitizeGenerationSample } from "../../model/generationSample";
import { timestampTitle } from "../timestampTitle";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { Check, ChartBreakoutSquare } from "../../../../shared/ui/icons";
import { useRef, useState } from "react";
import { HandoffButton, SecondOpinionButton } from "../SecondOpinionButton";
import { Popover } from "../../../../shared/ui/Popover";
import { type HarnessId, type ModelTarget, type TurnMetrics } from "../../model/session";
import { HarnessIcon } from "../HarnessIcon";
import { CopyTurnButton } from "../CopyTurnButton";
import { formatClockTime, formatElapsed, formatWorkingDuration } from "./transcriptClock";
import { SaveNoteButton } from "./TurnActions";



/**
 * What a finished turn leaves under the answer: what you can do with it, and
 * when it landed. Clients that use the live footer keep the completed clock here.
 */
export function TurnDuration({
  elapsedMs,
  metrics,
  labelHidden = false,
  modelName,
  harness,
  completedAt,
  copyText: output,
  onSaveNote,
  fromHarness,
  fromModel,
  onSecondOpinion,
  onHandoff,
}: {
  elapsedMs: number | null;
  metrics?: TurnMetrics;
  /** True when the fold line above already keeps the time for this turn. */
  labelHidden?: boolean;
  modelName?: string;
  harness?: HarnessId;
  completedAt?: number;
  copyText?: string;
  onSaveNote?: (text: string) => void | Promise<void>;
  fromHarness?: HarnessId;
  /** The turn's own model, so a same-harness second opinion can hide it. */
  fromModel?: string;
  onSecondOpinion?: (target: ModelTarget) => void;
  onHandoff?: (target: ModelTarget) => void;
}) {
  const { language } = useTranslation();
  const label = formatWorkingDuration(elapsedMs, modelName, true);
  const dot = (
    <span
      aria-hidden
      className="size-[3px] shrink-0 rounded-full bg-content/25"
    />
  );
  return (
    <div
      aria-label={label}
      data-transcript-turn-footer
      data-ui="response-actions"
      className="flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden px-4 @md:px-6 pt-1 pb-3 font-sans text-sm text-content/40"
    >
      <span data-ui="response-action-group" className="flex shrink-0 items-center gap-1">
        {output ? (
          <>
            <CopyTurnButton text={output} />
            {onSaveNote ? (
              <SaveNoteButton text={output} onSave={onSaveNote} />
            ) : null}
          </>
        ) : (
          <Check className="size-3.5" />
        )}
        {fromHarness && onHandoff ? (
          <HandoffButton from={fromHarness} onPick={onHandoff} />
        ) : null}
        {fromHarness && onSecondOpinion ? (
          <SecondOpinionButton
            from={fromHarness}
            fromModel={fromModel}
            onPick={onSecondOpinion}
            includeCurrent
            excludeFromModel
          />
        ) : null}
        <TurnMetricsBadge metrics={metrics} />
      </span>
      {labelHidden ? null : (
        <span data-ui="response-metadata" className="flex min-w-0 items-center gap-2.5">
          {dot}
          {harness || modelName?.trim() ? (
            <>
              <span className="flex min-w-0 items-center gap-1.5">
                {harness ? (
                  <HarnessIcon harness={harness} className="size-3.5 shrink-0" />
                ) : null}
                {modelName?.trim() ? (
                  <span className="min-w-0 truncate" title={modelName.trim()}>
                    {modelName.trim()}
                  </span>
                ) : null}
              </span>
              {dot}
            </>
          ) : null}
          <span className="shrink-0 tabular-nums">{formatElapsed(elapsedMs)}</span>
        </span>
      )}
      {completedAt != null ? (
        <span data-ui="response-metadata" className="flex shrink-0 items-center gap-2.5">
          {dot}
          <time
            dateTime={new Date(completedAt).toISOString()}
            title={timestampTitle(completedAt, language)}
            className="shrink-0 text-content/35"
          >
            {formatClockTime(completedAt)}
          </time>
        </span>
      ) : null}
    </div>
  );
}

export function TurnMetricsBadge({ metrics }: { metrics?: TurnMetrics }) {
  const { t: uiT, language } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  if (!metrics || !hasTurnMetrics(metrics)) return null;

  const sample = sanitizeGenerationSample(metrics.generationSample);
  const headline = [
    metrics.cacheHitPercent != null
      ? uiT("Cache hit {percent}%", { percent: Math.round(metrics.cacheHitPercent) })
      : null,
    sample
      ? uiT("Text generation {rate} tok/s", { rate: formatGenerationRate(sample, language) })
      : uiT("Generation rate unavailable"),
  ].filter(Boolean).join(" · ");
  const sampleDetail = sample ? uiT("Latest text segment · {source}", {
    source: sample.tokenSource === "provider" ? uiT("Provider-reported tokens") : uiT("Text tokens"),
  }) : "";
  const usageDetail = [
    metrics.inputTokens != null
      ? uiT("{count} input", { count: formatMetricCount(metrics.inputTokens) }) : null,
    metrics.outputTokens != null
      ? uiT("{count} output", { count: formatMetricCount(metrics.outputTokens) }) : null,
    metrics.cacheReadTokens != null
      ? uiT("{count} cached", { count: formatMetricCount(metrics.cacheReadTokens) }) : null,
  ].filter(Boolean).join(" · ");
  const detail = usageDetail ? uiT("Provider usage: {usage}", { usage: usageDetail }) : "";
  const label = [headline, sampleDetail, detail].filter(Boolean).join(". ");

  return (
    <div
      ref={root}
      data-ui="response-metrics"
      className="relative shrink-0 ml-[3px]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <span
        data-ui="response-metrics-trigger"
        role="img"
        tabIndex={0}
        aria-label={uiT("Turn metrics: {value0}", { value0: String(label) })}
        title={uiT("Turn metrics")}
        className="grid rounded-md p-1 text-content/40 outline-none hover:bg-content/5 hover:text-content/70 focus-visible:ring-1 focus-visible:ring-accent"
      >
        <ChartBreakoutSquare className="size-3.5" />
      </span>
      <PresenceBoundary propagate>{hovered ? (
        <Popover
          anchor={root}
          side="top"
          align="start"
          className="pointer-events-none w-max max-w-[calc(100vw-2rem)] px-2.5 py-1.5"
        >
          <div className="text-[12px] leading-4 text-content">{headline}</div>
          {sampleDetail ? <div className="text-[11px] leading-4 text-content/50">{sampleDetail}</div> : null}
          {detail ? (
            <div className="text-[11px] leading-4 text-content/50">
              {detail}
            </div>
          ) : null}
        </Popover>
      ) : null}</PresenceBoundary>
    </div>
  );
}

function hasTurnMetrics(metrics: TurnMetrics): boolean {
  return (
    metrics.generationSample !== undefined ||
    metrics.cacheHitPercent != null ||
    (metrics.inputTokens ?? 0) > 0 ||
    (metrics.outputTokens ?? 0) > 0 ||
    (metrics.cacheReadTokens ?? 0) > 0 ||
    (metrics.cacheWriteTokens ?? 0) > 0
  );
}

// Building an Intl formatter resolves locale data; each turn badge formats
// several values, so reuse one per option set instead of one per call.
const metricCountFormats: Intl.NumberFormat[] = [];
function formatMetricCount(value: number): string {
  const digits = value >= 1000 ? 1 : 0;
  metricCountFormats[digits] ??= new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: digits,
  });
  return metricCountFormats[digits].format(Math.max(0, Math.round(value)));
}
