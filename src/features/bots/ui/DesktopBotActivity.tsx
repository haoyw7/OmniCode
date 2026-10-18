import { useCallback, useEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotRun, BotRuns, BotScope } from "../model/bots";
import { botErrorMessage } from "../model/botErrors";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import "./desktop-bot-details.css";

const statuses = { queued: "Queued", running: "Running", waiting_approval: "Approval needed", completed: "Completed", cancelled: "Cancelled", failed: "Failed", interrupted: "Interrupted" } as const;
const merge = (older: BotRun[], newer: BotRun[]) => [...new Map([...older, ...newer].map(run => [run.id, run])).values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
export function DesktopBotActivity({ scope, rpc }: { scope: BotScope; rpc: BotRpc }) {
  return <Activity key={JSON.stringify(scope)} scope={scope} rpc={rpc} />;
}
function Activity({ scope, rpc }: { scope: BotScope; rpc: BotRpc }) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const [runs, setRuns] = useState<BotRun[]>([]), [page, setPage] = useState<BotRuns>();
  const [error, setError] = useState<string>(), [loading, setLoading] = useState(false);
  const alive = useRef(true), request = useRef(0), inFlight = useRef(false);
  const oldest = useRef<BotRuns["next"]>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const sequence = ++request.current;
    try {
      let before: BotRuns["next"], result: BotRuns, rows: BotRun[] = [];
      const boundary = oldest.current;
      do {
        result = await rpc<BotRuns>("botThreads.runs", { botId: scope.botId, threadId: scope.threadId, limit: 30, ...(before ? { before } : {}) });
        if (!alive.current || sequence !== request.current) return;
        rows = merge(rows, result.runs);
        before = result.next;
        // Refresh every visible page, including long-running older records pushed
        // down by newly queued work. Stop once the previous page boundary is met.
      } while (boundary && result.hasMore && before &&
        (before.createdAt > boundary.createdAt || (before.createdAt === boundary.createdAt && before.id > boundary.id)));
      const last = rows.at(-1);
      oldest.current = last ? { createdAt: last.createdAt, id: last.id } : undefined; setRuns(rows); setPage(result); setError(undefined);
    } catch (cause) { if (alive.current && sequence === request.current) setError(botErrorMessage(cause)); }
    finally { inFlight.current = false; }
  }, [rpc, scope.botId, scope.threadId]);
  useEffect(() => {
    if (!visible) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, 2000); };
    void poll();
    return () => { stopped = true; request.current++; clearTimeout(timer); };
  }, [visible, refresh]);
  const more = async () => {
    if (loading || inFlight.current || !page?.hasMore || !page.next) return;
    const sequence = request.current;
    inFlight.current = true; setLoading(true);
    try {
      const result = await rpc<BotRuns>("botThreads.runs", { botId: scope.botId, threadId: scope.threadId, limit: 30, before: page.next });
      if (alive.current && sequence === request.current) {
        const last = merge([], result.runs).at(-1);
        if (last) oldest.current = { createdAt: last.createdAt, id: last.id };
        setRuns(current => merge(current, result.runs)); setPage(result); setError(undefined);
      }
    } catch (cause) { if (alive.current && sequence === request.current) setError(botErrorMessage(cause)); }
    finally { inFlight.current = false; if (alive.current) setLoading(false); }
  };
  return <section className="desktop-bot-activity" aria-label={t("Bot activity")}>
    <header><h3>{t("Activity")}</h3><button type="button" onClick={() => void refresh()}>{t("Refresh")}</button></header>
    {error && <p role="alert">{t(error)}</p>}
    {!runs.length && <p role="status">{t(page ? "No runs yet." : "Loading activity…")}</p>}
    <ol>{runs.map(run => <Run key={run.id} run={run} />)}</ol>
    {page?.hasMore && <button type="button" disabled={loading} onClick={() => void more()}>{t(loading ? "Loading…" : "Load older runs")}</button>}
  </section>;
}
function Run({ run }: { run: BotRun }) {
  const { t } = useTranslation(), [expanded, setExpanded] = useState(false);
  const date = new Date(run.startedAt ?? run.createdAt);
  return <li data-status={run.status}>
    <button type="button" className="desktop-bot-run-heading" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span>{run.config && <HarnessIcon harness={run.config.harness} />}<strong>{t(statuses[run.status])}</strong></span>
      <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>
    </button>
    {run.config && <p className="desktop-bot-run-model">{run.config.model}</p>}
    {run.error && <p role="alert">{t(run.error)}</p>}
    <AnimatedCollapse expanded={expanded}><dl>
      {run.endedAt && <><dt>{t("Finished")}</dt><dd>{new Date(run.endedAt).toLocaleString()}</dd></>}
      {run.config?.workingDirectory && <><dt>{t("Working directory")}</dt><dd>{run.config.workingDirectory}</dd></>}
      {run.capabilities && <><dt>{t("System instructions")}</dt><dd>{t(run.capabilities.systemInstructions === "native" ? "Native system channel" : "Context block fallback")}</dd>
        <dt>{t("Host tools")}</dt><dd>{t(run.capabilities.toolBridge === "control-cli" ? "Host control CLI" : "Unavailable")}</dd>
        <dt>{t("Host MCP")}</dt><dd>{t(run.capabilities.mcp === "native" ? "Native" : "Unavailable")}</dd>
        <dt>{t("Capability differences")}</dt><dd><ul>{run.capabilities.limitations.map(text => <li key={text}>{t(text)}</li>)}</ul></dd></>}
    </dl></AnimatedCollapse>
  </li>;
}
