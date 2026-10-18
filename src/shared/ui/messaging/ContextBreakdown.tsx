import { useId, useState, type ReactNode } from "react";
import { AnimatedCollapse } from "../AnimatedCollapse";
import { DisclosureChevron } from "../DisclosureChevron";

export type ContextBreakdownRow = {
  name: string;
  tokens: string;
  percent: string;
  fraction?: number;
  tone: string;
  deferred?: boolean;
  hint?: string;
};

/** Presentation only: providers, accounting and localized copy belong to consumers. */
export function ContextBreakdown({ summary, total, rows, groups, footer }: {
  summary: string;
  total: string;
  rows: ContextBreakdownRow[];
  groups: { name: string; rows: ContextBreakdownRow[] }[];
  footer: ReactNode;
}) {
  return <div data-ui="context-breakdown">
    <div className="context-breakdown-summary"><span>{summary}</span><span>{total}</span></div>
    <ContextBreakdownBar segments={rows} />
    <div className="context-breakdown-rows">
      {rows.map((row, index) => <UsageRow key={index} row={row} />)}
    </div>
    {groups.map((group) => <ToolGroup key={group.name} {...group} />)}
    <div className="context-breakdown-footer">{footer}</div>
  </div>;
}

/** Proportional usage bar; segments share one denominator capped at the window. */
export function ContextBreakdownBar({ segments }: { segments: Pick<ContextBreakdownRow, "fraction" | "tone">[] }) {
  const totalFraction = Math.max(1, segments.reduce((sum, row) => sum + (row.fraction ?? 0), 0));
  return <div className="context-breakdown-bar" aria-hidden="true">
    {segments.map((row, index) => row.fraction ? <span key={index} data-tone={row.tone}
      style={{ width: `${row.fraction / totalFraction * 100}%` }} /> : null)}
  </div>;
}

function UsageRow({ row }: { row: ContextBreakdownRow }) {
  return <div className="context-breakdown-row" data-deferred={row.deferred || undefined} title={row.hint}>
    <span className="context-breakdown-swatch" data-tone={row.tone} aria-hidden="true" />
    <span className="context-breakdown-name">{row.name}</span>
    <span className="context-breakdown-tokens">{row.tokens}</span>
    <span className="context-breakdown-percent">{row.percent}</span>
  </div>;
}

function ToolGroup({ name, rows }: { name: string; rows: ContextBreakdownRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div className="context-breakdown-group">
    <button type="button" className="context-breakdown-toggle" aria-expanded={expanded}
      aria-controls={id} onClick={() => setExpanded((value) => !value)}>
      <DisclosureChevron expanded={expanded} className="size-3 shrink-0" />
      <span>{name}</span><span>{rows.length}</span>
    </button>
    <AnimatedCollapse expanded={expanded}>
      <div id={id} className="context-breakdown-tool-list">
        {rows.map((row, index) => <UsageRow key={index} row={row} />)}
      </div>
    </AnimatedCollapse>
  </div>;
}
