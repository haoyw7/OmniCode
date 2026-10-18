import { useCallback, useEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotDelegation, BotDelegations, BotScope, BotsSnapshot } from "../model/bots";
import { botErrorMessage } from "../model/botErrors";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Bot, ChevronRight } from "../../../shared/ui/icons";
import "./desktop-bot-delegations.css";

type Names = Readonly<Record<string, string>>;
type ScopedProps = { scope: BotScope; rpc: BotRpc; botNames?: Names; onOpenThread?: (scope: BotScope) => void };
const labels: Record<BotDelegation["status"], string> = { running: "Running", completed: "Completed", busy: "Bot busy", failed: "Failed", cancelled: "Cancelled", timed_out: "Timed out", interrupted: "Interrupted" };
const matches = (a: { botId: string; threadId?: string }, b: BotScope) => a.botId === b.botId && a.threadId === b.threadId;
const belongs = (value: BotDelegation, scope: BotScope) => matches(value.source, scope) || matches(value.target, scope);
const merge = (rows: BotDelegation[], next: BotDelegation[]) => [...new Map([...rows, ...next].map(value => [value.id, value])).values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));

function useBotNames(rpc: BotRpc, supplied?: Names): Names {
  const visible = useSurfaceVisibility(), [names, setNames] = useState<Names>({});
  useEffect(() => {
    if (!visible || supplied) return;
    let stopped = false;
    void rpc<BotsSnapshot>("bots.list", { includeArchived: true }).then(snapshot => {
      if (!stopped) setNames(Object.fromEntries(snapshot.bots.map(bot => [bot.id, bot.name])));
    }, () => {});
    return () => { stopped = true; };
  }, [rpc, visible, supplied]);
  return supplied ?? names;
}

/** One retained activity surface owns polling; message cards refresh on chat revisions. */
export function DesktopBotDelegations(props: ScopedProps) {
  return <Delegations key={JSON.stringify(props.scope)} {...props} />;
}
function Delegations({ scope, rpc, botNames, onOpenThread }: ScopedProps) {
  const { t } = useTranslation(), visible = useSurfaceVisibility(), names = useBotNames(rpc, botNames);
  const [rows, setRows] = useState<BotDelegation[]>([]), [page, setPage] = useState<BotDelegations>();
  const [error, setError] = useState<string>(), [loading, setLoading] = useState(false);
  const sequence = useRef(0), inFlight = useRef(false), alive = useRef(true);
  const boundary = useRef<BotDelegations["next"]>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const request = ++sequence.current;
    inFlight.current = true;
    try {
      let before: BotDelegations["next"], result: BotDelegations, collected: BotDelegation[] = [];
      const oldest = boundary.current;
      do {
        result = await rpc<BotDelegations>("botDelegations.list", { botId: scope.botId, threadId: scope.threadId, limit: 30, ...(before ? { before } : {}) });
        if (!alive.current || request !== sequence.current) return;
        collected = merge(collected, result.delegations.filter(value => belongs(value, scope)));
        before = result.next;
      } while (oldest && result.hasMore && before && (before.createdAt > oldest.createdAt || (before.createdAt === oldest.createdAt && before.id > oldest.id)));
      const last = collected.at(-1);
      boundary.current = last ? { createdAt: last.createdAt, id: last.id } : undefined; setRows(collected); setPage(result); setError(undefined);
    } catch (cause) { if (alive.current && request === sequence.current) setError(botErrorMessage(cause)); }
    finally { inFlight.current = false; }
  }, [rpc, scope.botId, scope.threadId]);
  useEffect(() => {
    if (!visible) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, 2000); };
    void poll();
    return () => { stopped = true; sequence.current++; clearTimeout(timer); };
  }, [visible, refresh]);
  const more = async () => {
    if (loading || inFlight.current || !page?.hasMore || !page.next) return;
    const request = sequence.current;
    inFlight.current = true; setLoading(true);
    try {
      const result = await rpc<BotDelegations>("botDelegations.list", { botId: scope.botId, threadId: scope.threadId, limit: 30, before: page.next });
      if (alive.current && request === sequence.current) {
        const incoming = merge([], result.delegations.filter(value => belongs(value, scope))), last = incoming.at(-1);
        if (last) boundary.current = { createdAt: last.createdAt, id: last.id };
        setRows(current => merge(current, incoming)); setPage(result); setError(undefined);
      }
    } catch (cause) { if (alive.current && request === sequence.current) setError(botErrorMessage(cause)); }
    finally { inFlight.current = false; if (alive.current) setLoading(false); }
  };
  return <section className="desktop-bot-delegations" aria-label={t("Delegations")}>
    <header><h3>{t("Delegations")}</h3><button type="button" onClick={() => void refresh()}>{t("Refresh")}</button></header>
    {error && <p role="alert">{t(error)}</p>}
    {!rows.length && <p role="status">{t(page ? "No delegations yet" : "Loading delegations…")}</p>}
    {rows.map(value => <Delegation key={value.id} value={value} scope={scope} rpc={rpc} names={names} onRefresh={refresh} onOpenThread={onOpenThread} />)}
    {page?.hasMore && <button type="button" disabled={loading} onClick={() => void more()}>{t(loading ? "Loading…" : "Load older delegations")}</button>}
  </section>;
}

export function DesktopBotDelegationCard(props: ScopedProps & { delegationId: string; revision: number }) {
  return <Card key={JSON.stringify([props.scope, props.delegationId])} {...props} />;
}
function Card({ scope, rpc, delegationId, revision, botNames, onOpenThread }: ScopedProps & { delegationId: string; revision: number }) {
  const { t } = useTranslation(), visible = useSurfaceVisibility(), names = useBotNames(rpc, botNames);
  const [value, setValue] = useState<BotDelegation>(), [error, setError] = useState<string>();
  const sequence = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await rpc<BotDelegation>("botDelegations.get", { botId: scope.botId, threadId: scope.threadId, delegationId });
      if (!alive.current || request !== sequence.current) return;
      if (next.id !== delegationId || !belongs(next, scope)) { setValue(undefined); setError("Delegation unavailable in this thread"); return; }
      setValue(next); setError(undefined);
    } catch (cause) { if (alive.current && request === sequence.current) setError(botErrorMessage(cause)); }
  }, [rpc, scope.botId, scope.threadId, delegationId]);
  useEffect(() => {
    if (!visible) return;
    void refresh();
    return () => { sequence.current++; };
  }, [visible, revision, refresh]);
  return <div className="desktop-bot-delegation-message">
    {error && <p role="alert">{t(error)} <button type="button" onClick={() => void refresh()}>{t("Retry")}</button></p>}
    {value ? <Delegation value={value} scope={scope} rpc={rpc} names={names} onRefresh={refresh} onOpenThread={onOpenThread} /> : !error && <p role="status">{t("Loading delegations…")}</p>}
  </div>;
}

function Delegation({ value, scope, rpc, names, onRefresh, onOpenThread }: {
  value: BotDelegation; scope: BotScope; rpc: BotRpc; names: Names; onRefresh: () => Promise<void>; onOpenThread?: (scope: BotScope) => void;
}) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const command = useRef<string | undefined>(undefined);
  const cancel = async () => {
    if (!visible || busy || value.status !== "running" || !belongs(value, scope)) return;
    setBusy(true); setError(undefined); command.current ??= crypto.randomUUID();
    try {
      await rpc("botDelegations.cancel", { botId: scope.botId, threadId: scope.threadId, delegationId: value.id, commandId: command.current });
      await onRefresh(); command.current = undefined;
    } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  if (!belongs(value, scope)) return null;
  const source = names[value.source.botId] ?? value.source.botId, target = names[value.target.botId] ?? value.target.botId;
  const other = matches(value.source, scope) ? value.target : value.source;
  return <article className="desktop-bot-delegation-card" data-status={value.status}>
    <button type="button" className="desktop-bot-delegation-heading" aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>
      <Bot size={16} aria-hidden="true" /><strong>{source} → {target}</strong><span>{t(labels[value.status])}</span><ChevronRight size={14} aria-hidden="true" />
    </button>
    {value.result && <p className="desktop-bot-delegation-preview">{value.result.slice(0, 200)}</p>}
    <AnimatedCollapse expanded={expanded}><div className="desktop-bot-delegation-body">
      <h4>{t("Delegation request")}</h4><p className="desktop-bot-delegation-text">{value.prompt}</p>
      {value.result && <><h4>{t("Delegation result")}</h4><p className="desktop-bot-delegation-text">{value.result}</p>{value.resultTruncated && <small>{t("Delegation result was truncated")}</small>}</>}
      {value.error && <p role="alert">{t(value.error)}</p>}
      <p><span>{t("Delegation deadline")}: </span><time dateTime={new Date(value.deadlineAt).toISOString()}>{new Date(value.deadlineAt).toLocaleString()}</time></p>
    </div></AnimatedCollapse>
    <footer>
      {onOpenThread && other.threadId && <button type="button" disabled={!visible} onClick={() => onOpenThread({ botId: other.botId, threadId: other.threadId! })}>{t(matches(value.source, scope) ? "Open target thread" : "Open source thread")}</button>}
      {value.status === "running" && <button type="button" disabled={busy || !visible} onClick={() => void cancel()}>{t("Cancel delegation")}</button>}
    </footer>
    {error && <p role="alert">{t(error)}</p>}
  </article>;
}
