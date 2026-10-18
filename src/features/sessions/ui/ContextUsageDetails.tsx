import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ContextBreakdown } from "../../../shared/ui/messaging/ContextBreakdown";
import { contextBreakdownRows, formatContextTokens } from "../model/contextBreakdown";
import { contextPercent, type ContextUsage } from "../model/contextUsage";

/** Reused by the desktop status card and the mobile session status sheet. */
export function ContextUsageDetails({ usage }: { usage: ContextUsage }) {
  const { t, language } = useTranslation();
  const snapshot = usage.breakdown;
  const displayRows = contextBreakdownRows(usage);
  const rows = displayRows.map((row) => ({
    name: row.label ? t(row.label) : row.name,
    tokens: formatContextTokens(row.tokens),
    percent: row.percent === null ? "—" : `${row.percent.toFixed(1)}%`,
    fraction: row.percent === null ? undefined : row.percent / 100,
    tone: row.tone,
    deferred: row.kind === "deferred",
    hint: row.kind === "deferred" ? t("Not loaded; excluded from context usage")
      : row.name.toLowerCase() === "messages" && snapshot?.toolResultTokens
        ? t("Tool results are listed separately when reported") : undefined,
  }));
  const groups = (["mcp", "system"] as const).flatMap((group) => {
    const tools = displayRows.length ? snapshot?.tools?.filter((tool) => tool.group === group) ?? [] : [];
    return tools.length ? [{ name: t(group === "mcp" ? "MCP tools" : "System tools"), rows: tools.map((tool) => ({
      name: tool.name,
      tokens: formatContextTokens(tool.tokens),
      percent: tool.deferred || !usage.window ? "—" : `${(tool.tokens / usage.window * 100).toFixed(1)}%`,
      tone: group === "mcp" ? "mcp" : "tools",
      deferred: tool.deferred,
      hint: [tool.server, tool.deferred ? t("Not loaded; excluded from context usage") : ""].filter(Boolean).join(" · "),
    })) }] : [];
  });
  const percent = contextPercent(usage);
  return <ContextBreakdown
    summary={percent === null ? t("Context used") : t("{percent}% used", { percent })}
    total={usage.window ? `${formatContextTokens(usage.used)} / ${formatContextTokens(usage.window)}` : formatContextTokens(usage.used)}
    rows={rows} groups={groups}
    footer={snapshot && rows.length ? <>
      {snapshot.estimated ? <p>{t("Category counts are estimates.")}</p> : null}
      {snapshot.toolResultTokens === undefined && !snapshot.categories.some((row) => row.name.toLowerCase() === "tool results")
        ? <p>{t("Tool results are included in messages; separate counts were not reported.")}</p> : null}
      <p>{t("Updated {time}. Refreshes after each turn.", { time: new Date(snapshot.updatedAt).toLocaleString(language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) })}</p>
    </> : <p>{t("Category details have not been reported yet.")}</p>}
  />;
}
