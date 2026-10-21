import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { botRunsQuery, loadMoreBotRuns } from "../model/botPanelQueries";
import { Button } from "../../../shared/ui/forms/Button";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { ChevronDown, RefreshCw } from "../../../shared/ui/icons";
import { useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotRun, BotScope } from "../model/bots";
import { botErrorMessage } from "../model/botErrors";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import "./desktop-bot-details.css";

const statuses = { queued: "Queued", running: "Running", waiting_approval: "Approval needed", completed: "Completed", cancelled: "Cancelled", failed: "Failed", interrupted: "Interrupted" } as const;
export function DesktopBotActivity({ scope, rpc }: { scope: BotScope; rpc: BotRpc }) {
  return <Activity key={JSON.stringify(scope)} scope={scope} rpc={rpc} />;
}
function Activity({ scope, rpc }: { scope: BotScope; rpc: BotRpc }) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const query = useQuery({ ...botRunsQuery(rpc, scope), enabled: visible, refetchInterval: visible ? 2000 : false }, queryClient);
  const page = query.data, runs = page?.runs ?? [], loading = query.isFetching;
  const error = query.error ? botErrorMessage(query.error) : undefined;
  const refresh = () => query.refetch({ cancelRefetch: false });
  const more = () => loadMoreBotRuns(rpc, scope).catch(() => undefined);
  return <section className="desktop-bot-activity desktop-bot-page-body" aria-label={t("Bot activity")}>
    <header><IconButton size="sm" label={t("Refresh")} onClick={() => void refresh()}><RefreshCw size={16} /></IconButton></header>
    {error && <p className="desktop-bot-section-note" role="alert">{t(error)}</p>}
    {!runs.length && <p className="desktop-bot-section-note" role="status">{t(page ? "No runs yet." : "Loading activity…")}</p>}
    {runs.length > 0 && <ol className="desktop-bot-row-group">{runs.map(run => <Run key={run.id} run={run} />)}</ol>}
    {page?.hasMore && <Button size="sm" variant="ghost" type="button" disabled={loading} onClick={() => void more()}>{t(loading ? "Loading…" : "Load older runs")}</Button>}
  </section>;
}
function Run({ run }: { run: BotRun }) {
  const { t } = useTranslation(), [expanded, setExpanded] = useState(false);
  const date = new Date(run.startedAt ?? run.createdAt);
  return <li className="desktop-bot-row-block" data-status={run.status}>
    <button type="button" className="desktop-bot-row desktop-bot-run-heading" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {run.config && <HarnessIcon harness={run.config.harness} className="size-4 shrink-0" />}
      <span className="desktop-bot-row-title">{t(statuses[run.status])}{run.config && <small>{run.config.model}</small>}</span>
      <time className="desktop-bot-row-meta" dateTime={date.toISOString()}>{date.toLocaleString()}</time>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {run.error && <p className="desktop-bot-row-detail" role="alert">{t(run.error)}</p>}
    <AnimatedCollapse expanded={expanded}><dl className="desktop-bot-row-detail">
      {run.endedAt && <><dt>{t("Finished")}</dt><dd>{new Date(run.endedAt).toLocaleString()}</dd></>}
      {run.config?.workingDirectory && <><dt>{t("Working directory")}</dt><dd>{run.config.workingDirectory}</dd></>}
      {run.capabilities && <><dt>{t("System instructions")}</dt><dd>{t(run.capabilities.systemInstructions === "native" ? "Native system channel" : "Context block fallback")}</dd>
        <dt>{t("Host tools")}</dt><dd>{t(run.capabilities.toolBridge === "control-cli" ? "Host control CLI" : "Unavailable")}</dd>
        <dt>{t("Host MCP")}</dt><dd>{t(run.capabilities.mcp === "native" ? "Native" : "Unavailable")}</dd>
        <dt>{t("Capability differences")}</dt><dd><ul>{run.capabilities.limitations.map(text => <li key={text}>{t(text)}</li>)}</ul></dd></>}
    </dl></AnimatedCollapse>
  </li>;
}
