import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useRef, useState } from "react";
import {
  contextRatio,
  contextTooltip,
  type ContextUsage,
} from "../model/contextUsage";
import { Popover } from "../../../shared/ui/Popover";

const SIZE = 14;
const STROKE = 2;

/** Ring turns amber then red as the window fills. */
function ringClass(ratio: number): string {
  if (ratio >= 0.9) return "text-red-400";
  if (ratio >= 0.75) return "text-amber-400";
  return "text-content/45";
}

/**
 * Circular gauge for how full the model context window is.
 *
 * Renders nothing until the harness reports both halves — Cursor's ACP stream
 * carries no usage at all, and a ring guessing at a number is worse than no
 * ring.
 */
export function ContextMeter({
  usage,
  onCompact,
  compactDisabled = false,
}: {
  usage?: ContextUsage;
  onCompact?: () => void;
  compactDisabled?: boolean;
}) {
  const { t: uiT } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const ratio = contextRatio(usage);
  if (!usage || ratio === null) return null;

  const { headline, detail } = contextTooltip(usage);
  const actionsOpen = open && onCompact != null;

  return (
    <div
      ref={root}
      className="relative shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {onCompact ? (
        <button
          type="button"
          title={uiT("Context usage")}
          aria-label={uiT("{value0}, {value1}. Open context actions", {
            value0: String(headline),
            value1: String(detail),
          })}
          aria-expanded={actionsOpen}
          onClick={() => setOpen((value) => !value)}
          className="-m-1 grid rounded-sm p-1 outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <MeterRing ratio={ratio} />
        </button>
      ) : (
        <MeterRing ratio={ratio} label={`${headline}, ${detail}`} />
      )}
      <PresenceBoundary propagate>{hovered || actionsOpen ? (
        <Popover
          anchor={root}
          side="top"
          align="end"
          onDismiss={onCompact ? () => setOpen(false) : undefined}
          className={`w-max px-2.5 py-1.5 ${actionsOpen ? "" : "pointer-events-none"}`}
        >
          <div className="text-[12px] leading-4 text-content">{headline}</div>
          <div className="text-[11px] leading-4 text-content/50">{detail}</div>
          {actionsOpen ? (
            <button
              type="button"
              disabled={compactDisabled}
              title={
                compactDisabled
                  ? uiT("Wait for the current operation to finish")
                  : uiT("Compact this conversation's context")
              }
              onClick={() => {
                setOpen(false);
                onCompact?.();
              }}
              className="mt-1.5 w-full rounded-md bg-content/10 px-2 py-1 text-[11px] text-content hover:bg-content/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uiT("Compact now")}
            </button>
          ) : null}
        </Popover>
      ) : null}</PresenceBoundary>
    </div>
  );
}

export function MeterRing({
  ratio,
  label,
  size = SIZE,
  stroke = STROKE,
}: {
  ratio: number;
  label?: string;
  size?: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={ringClass(ratio)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="opacity-25"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
