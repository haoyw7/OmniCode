import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, invalidateAfterChange } from "../../../shared/lib/queryClient";
import { botDelegationsQuery, loadMoreBotDelegations, botDelegationQuery, botNamesQuery, delegationBelongs } from "../model/botPanelQueries";
import { Button } from "../../../shared/ui/forms/Button";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotDelegation, BotScope } from "../model/bots";
import { botErrorMessage } from "../model/botErrors";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Bot, ChevronRight, RefreshCw } from "../../../shared/ui/icons";
import "./desktop-bot-delegations.css";

type Names = Readonly<Record<string, string>>;
type ScopedProps = { scope: BotScope; rpc: BotRpc; botNames?: Names; onOpenThread?: (scope: BotScope) => void };
const labels: Record<BotDelegation["status"], string> = { running: "Running", completed: "Completed", busy: "Bot busy", failed: "Failed", cancelled: "Cancelled", timed_out: "Timed out", interrupted: "Interrupted" };
const matches = (a: { botId: string; threadId?: string }, b: BotScope) => a.botId === b.botId && a.threadId === b.threadId;
const belongs = delegationBelongs;
function useBotNames(rpc: BotRpc, supplied?: Names): Names {
  const visible = useSurfaceVisibility();
  const query = useQuery({ ...botNamesQuery(rpc), enabled: visible && !supplied }, queryClient);
  return supplied ?? query.data ?? {};
}

/** One retained activity surface owns polling; message cards refresh on chat revisions. */
export function DesktopBotDelegations(props: ScopedProps) {
  return <Delegations key={JSON.stringify(props.scope)} {...props} />;
}
function Delegations({ scope, rpc, botNames, onOpenThread }: ScopedProps) {
  const { t } = useTranslation(), visible = useSurfaceVisibility(), names = useBotNames(rpc, botNames);
  const query = useQuery({ ...botDelegationsQuery(rpc, scope), enabled: visible, refetchInterval: visible ? 2000 : false }, queryClient);
  const page = query.data, rows = page?.delegations ?? [], loading = query.isFetching;
  const error = query.error ? botErrorMessage(query.error) : undefined;
  const refresh = async () => { await query.refetch({ cancelRefetch: false, throwOnError: true }); };
  const more = () => loadMoreBotDelegations(rpc, scope).catch(() => undefined);
  return <section className="desktop-bot-delegations desktop-bot-page-body" aria-label={t("Delegations")}>
    <header><IconButton size="sm" label={t("Refresh")} onClick={() => void refresh().catch(() => undefined)}><RefreshCw size={16} /></IconButton></header>
    {error && <p className="desktop-bot-section-note" role="alert">{t(error)}</p>}
    {!rows.length && <p className="desktop-bot-section-note" role="status">{t(page ? "No delegations yet" : "Loading delegations…")}</p>}
    {rows.length > 0 && <div className="desktop-bot-row-group">{rows.map(value => <Delegation key={value.id} value={value} scope={scope} rpc={rpc} names={names} onRefresh={refresh} onOpenThread={onOpenThread} />)}</div>}
    {page?.hasMore && <Button size="sm" variant="ghost" type="button" disabled={loading} onClick={() => void more()}>{t(loading ? "Loading…" : "Load older delegations")}</Button>}
  </section>;
}

export function DesktopBotDelegationCard(props: ScopedProps & { delegationId: string; revision: number }) {
  return <Card key={JSON.stringify([props.scope, props.delegationId])} {...props} />;
}
function Card({ scope, rpc, delegationId, revision, botNames, onOpenThread }: ScopedProps & { delegationId: string; revision: number }) {
  const { t } = useTranslation(), visible = useSurfaceVisibility(), names = useBotNames(rpc, botNames);
  const query = useQuery({ ...botDelegationQuery(rpc, scope, delegationId), enabled: visible }, queryClient);
  const value = query.data, error = query.error ? botErrorMessage(query.error) : undefined;
  const refresh = useCallback(async () => { await query.refetch({ cancelRefetch: false, throwOnError: true }); }, [query.refetch]);
  const previousRevision = useRef(revision);
  useEffect(() => {
    const changed = previousRevision.current !== revision;
    previousRevision.current = revision;
    if (!visible || !changed) return;
    void invalidateAfterChange(botDelegationQuery(rpc, scope, delegationId).queryKey);
  }, [visible, revision, rpc, scope, delegationId]);
  return <div className="desktop-bot-delegation-message">
    {error && <p role="alert">{t(error)} <Button size="sm" variant="secondary" type="button" onClick={() => void refresh().catch(() => undefined)}>{t("Retry")}</Button></p>}
    {value ? <Delegation value={value} scope={scope} rpc={rpc} names={names} onRefresh={refresh} onOpenThread={onOpenThread} /> : !error && <p role="status">{t("Loading delegations…")}</p>}
  </div>;
}

function Delegation({ value, scope, rpc, names, onRefresh, onOpenThread }: {
  value: BotDelegation; scope: BotScope; rpc: BotRpc; names: Names; onRefresh: () => Promise<void>; onOpenThread?: (scope: BotScope) => void;
}) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const [expanded, setExpanded] = useState(false);
  const command = useRef<string | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: async () => {
      command.current ??= crypto.randomUUID();
      await rpc("botDelegations.cancel", { botId: scope.botId, threadId: scope.threadId, delegationId: value.id, commandId: command.current });
      await onRefresh(); command.current = undefined;
    },
  }, queryClient);
  const busy = mutation.isPending;
  const error = mutation.error ? botErrorMessage(mutation.error) : undefined;
  const cancel = () => {
    if (visible && !busy && value.status === "running" && belongs(value, scope)) mutation.mutate();
  };
  if (!belongs(value, scope)) return null;
  const source = names[value.source.botId] ?? value.source.botId, target = names[value.target.botId] ?? value.target.botId;
  const other = matches(value.source, scope) ? value.target : value.source;
  return <article className="desktop-bot-delegation-card" data-status={value.status}>
    <Button variant="ghost" size="content" type="button" className="desktop-bot-delegation-heading" aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>
      <Bot size={16} aria-hidden="true" /><strong>{source} → {target}</strong><span>{t(labels[value.status])}</span><ChevronRight size={14} aria-hidden="true" />
    </Button>
    {value.result && <p className="desktop-bot-delegation-preview">{value.result.slice(0, 200)}</p>}
    <AnimatedCollapse expanded={expanded}><div className="desktop-bot-delegation-body">
      <h4>{t("Delegation request")}</h4><p className="desktop-bot-delegation-text">{value.prompt}</p>
      {value.result && <><h4>{t("Delegation result")}</h4><p className="desktop-bot-delegation-text">{value.result}</p>{value.resultTruncated && <small>{t("Delegation result was truncated")}</small>}</>}
      {value.error && <p role="alert">{t(value.error)}</p>}
      <p><span>{t("Delegation deadline")}: </span><time dateTime={new Date(value.deadlineAt).toISOString()}>{new Date(value.deadlineAt).toLocaleString()}</time></p>
    </div></AnimatedCollapse>
    <footer>
      {onOpenThread && other.threadId && <Button size="sm" variant="secondary" type="button" disabled={!visible} onClick={() => onOpenThread({ botId: other.botId, threadId: other.threadId! })}>{t(matches(value.source, scope) ? "Open target thread" : "Open source thread")}</Button>}
      {value.status === "running" && <Button size="sm" variant="ghost" type="button" disabled={busy || !visible} onClick={() => void cancel()}>{t("Cancel delegation")}</Button>}
    </footer>
    {error && <p role="alert">{t(error)}</p>}
  </article>;
}
