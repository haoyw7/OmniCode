import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { useLayoutEffect, useRef, useState } from "react";
import { TerminalSpinner } from "../TerminalSpinner";
import { Shimmer } from "../../../../shared/ui/Shimmer";
import { HARNESS_TITLE, type Block, type InterjectionMeta } from "../../model/session";
import { HarnessIcon } from "../HarnessIcon";



export function HandoffDivider({ block }: { block: Block }) {
  const { t: uiT } = useTranslation();
  const meta = block.handoff;
  if (!meta) return null;

  const preparing = meta.status === "preparing";
  const label = preparing ? "Preparing a handoff" : HARNESS_TITLE[meta.to];

  return (
    <div className="px-4 @md:px-6 py-5">
      <div className="flex items-center gap-3">
        <div className="h-px min-w-4 flex-1 bg-content/12" />
        <div
          role="separator"
          aria-label={
            preparing
              ? uiT("Preparing a handoff to {value0}", {
                  value0: String(HARNESS_TITLE[meta.to]),
                })
              : uiT("Continued with {value0}", { value0: String(label) })
          }
          className="flex max-w-[min(100%,20rem)] items-center gap-1.5 px-1.5 font-sans text-[12px] text-content/55"
        >
          {preparing ? (
            <>
              <TerminalSpinner className="inline-block w-3.5 shrink-0 select-none text-center text-[11px] leading-none text-content/45" />
              <Shimmer duration={1.4}>{label}</Shimmer>
            </>
          ) : (
            <>
              <HarnessIcon harness={meta.to} className="size-3.5 shrink-0" />
            </>
          )}
        </div>
        <div className="h-px min-w-4 flex-1 bg-content/12" />
      </div>
    </div>
  );
}

/** The label and severity chrome an interjection wears, wherever it sits. */
export function interjectionChrome(meta: InterjectionMeta): {
  label: string;
  severityText?: string;
  severityClass: string;
} {
  const label =
    meta.customType === "advisor"
      ? "Advisor"
      : meta.customType === "custom"
        ? "Notice"
        : meta.customType;
  const severityText =
    meta.severity === "blocker"
      ? "Blocker"
      : meta.severity === "concern"
        ? "Concern"
        : meta.severity === "nit"
          ? "Nit"
          : undefined;
  const severityClass =
    meta.severity === "blocker"
      ? "text-red-400"
      : meta.severity === "concern"
        ? "text-amber-400"
        : "text-content/55";
  return { label, severityText, severityClass };
}

/** The advisory body under an interjection, wherever the note is surfaced. */
export const INTERJECTION_BODY =
  "min-w-0 whitespace-pre-wrap break-words font-sans text-[12.5px] leading-5 text-content/70";

/** A mid-turn interjection, e.g. OMP advisor notes: a labeled boundary with
 * a collapsible advisory body below it. */
export function InterjectionDivider({ block }: { block: Block }) {
  const { t: uiT } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !block.text) {
      setOverflows(false);
      return;
    }
    const measure = () => {
      if (!expanded) {
        setOverflows(el.scrollHeight > el.clientHeight + 1);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [block.text, expanded]);

  const meta = block.interjection;
  if (!meta) return null;
  const { label, severityText, severityClass } = interjectionChrome(meta);
  return (
    <div className="px-4 @md:px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="h-px min-w-4 flex-1 bg-content/12" />
        <div
          role="separator"
          aria-label={uiT("Interjection: {value0}", { value0: String(label) })}
          className="flex items-center gap-2 px-1.5 font-sans text-[12px] text-content/55"
        >
          <span>{label}</span>
          {severityText ? (
            <span className={`text-[11px] ${severityClass}`}>
              {severityText}
            </span>
          ) : null}
        </div>
        <div className="h-px min-w-4 flex-1 bg-content/12" />
      </div>
      {block.text ? (
        <div className="mt-2 px-2">
          <pre
            ref={textRef}
            className={`${INTERJECTION_BODY} ${expanded ? "" : "line-clamp-2"}`}
          >
            {block.text}
          </pre>
          {overflows ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 py-1 font-sans text-xs text-content/55 hover:text-content"
            >
              {expanded ? uiT("Show less") : uiT("Show more")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
