import { useEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotView, BotsSnapshot } from "../model/bots";
import { BOT_ACTIONS } from "../model/botActions";
import { botErrorMessage } from "../model/botErrors";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import "./desktop-bot-details.css";

type Fields = { avatar: string; workingDirectory: string; slots: string; custom: boolean; actions: string[]; computer: boolean; callableBotIds: string[] };
const fields = (bot: BotView): Fields => ({ avatar: bot.avatar ?? "", workingDirectory: bot.workingDirectory ?? "", slots: String(bot.maxConcurrentRuns ?? 3), custom: bot.tools?.enabledActions !== undefined, actions: [...(bot.tools?.enabledActions ?? BOT_ACTIONS)], computer: bot.tools?.computer ?? false, callableBotIds: [...(bot.callableBotIds ?? [])].filter(id => id !== bot.id) });

type Props = { bot: BotView; rpc: BotRpc; onSaved: () => void; delegationSupported?: boolean };
export function DesktopBotRuntimeSettings(props: Props) {
  return <RuntimeSettings key={props.bot.id} {...props} />;
}
function RuntimeSettings({ bot, rpc, onSaved, delegationSupported = false }: Props) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [callableBots, setCallableBots] = useState<BotView[]>([]);
  const [botsError, setBotsError] = useState<string>();
  const [botsLoading, setBotsLoading] = useState(false);
  const [botsAttempt, setBotsAttempt] = useState(0);
  const [base, setBase] = useState(() => ({ revision: bot.revision, fields: fields(bot) }));
  const [draft, setDraft] = useState(base.fields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!visible || !open || !delegationSupported) return;
    let stopped = false;
    setBotsLoading(true);
    void rpc<BotsSnapshot>("bots.list").then(snapshot => {
      if (!stopped) { setCallableBots(snapshot.bots.filter(item => item.id !== bot.id && !item.archivedAt)); setBotsError(undefined); }
    }, cause => { if (!stopped) setBotsError(botErrorMessage(cause)); }).finally(() => { if (!stopped) setBotsLoading(false); });
    return () => { stopped = true; };
  }, [visible, open, delegationSupported, bot.id, rpc, botsAttempt]);
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.fields);
  useEffect(() => {
    if (!dirty && !busy && !command.current && bot.revision > base.revision) {
      const next = fields(bot); setBase({ revision: bot.revision, fields: next }); setDraft(next);
    }
  }, [bot, base.revision, dirty, busy]);
  const update = (patch: Partial<Fields>) => setDraft(value => ({ ...value, ...patch }));
  const validAvatar = [...draft.avatar.trim()].length <= 8 && !/[\u0000-\u001f\u007f-\u009f]/u.test(draft.avatar);
  const slots = Number(draft.slots), validSlots = Number.isInteger(slots) && slots >= 1 && slots <= 10;
  const save = async () => {
    if (busy || !dirty || conflict || !validAvatar || !validSlots) return;
    const patch = { avatar: draft.avatar.trim(), workingDirectory: draft.workingDirectory.trim() || null, maxConcurrentRuns: slots,
      tools: { computer: draft.computer, ...(draft.custom ? { enabledActions: draft.actions } : {}) },
      ...(delegationSupported ? { callableBotIds: draft.callableBotIds.filter(id => id !== bot.id) } : {}) };
    const signature = JSON.stringify([bot.id, base.revision, patch]);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    setBusy(true); setError(undefined);
    try {
      const receipt = await rpc<{ revision: number }>("bots.configure", { botId: bot.id, commandId: command.current.id, expectedRevision: base.revision, patch });
      setBase({ revision: receipt.revision, fields: draft }); command.current = undefined; onSaved();
    } catch (cause) {
      const message = botErrorMessage(cause); setError(message); setConflict(/changed elsewhere/i.test(message));
    } finally { setBusy(false); }
  };
  const reload = async () => {
    setBusy(true); setError(undefined);
    try {
      const latest = await rpc<BotView>("bots.get", { botId: bot.id });
      const next = fields(latest); setBase({ revision: latest.revision, fields: next }); setDraft(next); setConflict(false); command.current = undefined;
    } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <form className="desktop-bot-runtime" aria-label={t("Bot runtime settings")} onSubmit={event => { event.preventDefault(); void save(); }}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{t("Runtime")}{dirty ? " •" : ""}</button>
    <AnimatedCollapse expanded={open}><div>
    <p>{t("Changes apply to the next turn. Manage permissions in Bot settings.")}</p>
    <fieldset disabled={busy}>
      <label>{t("Avatar")}<input data-ui="input" value={draft.avatar} maxLength={32} aria-invalid={!validAvatar || undefined} onChange={event => update({ avatar: event.target.value })} placeholder={t("Emoji or initials")} /></label>
      {!validAvatar && <small role="alert">{t("Avatar must be at most 8 characters without control characters")}</small>}
      <label>{t("Working directory")}<input data-ui="input" value={draft.workingDirectory} onChange={event => update({ workingDirectory: event.target.value })} placeholder={t("Use a separate directory for each thread")} /></label>
      <label>{t("Concurrent runs")}<input data-ui="input" type="number" min={1} max={10} step={1} value={draft.slots} aria-invalid={!validSlots || undefined} onChange={event => update({ slots: event.target.value })} /></label>
      {!validSlots && <small role="alert">{t("Choose between 1 and 10 concurrent runs.")}</small>}
      <label className="desktop-bot-check"><input data-ui="checkbox" type="checkbox" checked={draft.computer} onChange={event => update({ computer: event.target.checked })} />{t("Reserve the Host computer during this Bot's runs")}</label>
      {delegationSupported && <section className="desktop-bot-callable-list" aria-label={t("Callable bots")}>
        <h3>{t("Callable bots")}</h3>
        <p>{t("Only selected Bots on this Host can be called. Bots cannot call themselves or delegate again.")}</p>
        {botsLoading && <small role="status">{t("Loading…")}</small>}
        {botsError && <p role="alert">{t(botsError)} <button type="button" onClick={() => setBotsAttempt(value => value + 1)}>{t("Retry")}</button></p>}
        {[...new Set([...callableBots.map(item => item.id), ...draft.callableBotIds])].filter(id => id !== bot.id).map(id => {
          const target = callableBots.find(item => item.id === id);
          return <label className="desktop-bot-check" key={id}><input data-ui="checkbox" type="checkbox" checked={draft.callableBotIds.includes(id)} onChange={event => update({ callableBotIds: event.target.checked ? [...draft.callableBotIds, id] : draft.callableBotIds.filter(item => item !== id) })} /><span>{target?.name ?? t("Unavailable Bot")}</span></label>;
        })}
        {!botsLoading && !botsError && !callableBots.length && !draft.callableBotIds.length && <small>{t("No other bots on this Host")}</small>}
        {!draft.callableBotIds.length && <small>{t("No bots are allowed to be called")}</small>}
      </section>}
      <button type="button" aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}>{t("Host tools")}</button>
      <AnimatedCollapse expanded={toolsOpen}><div className="desktop-bot-tool-options">
        <p>{t("These choices restrict Host control actions. Provider tools and user MCP servers keep their own permissions.")}</p>
        <label className="desktop-bot-check"><input data-ui="checkbox" type="checkbox" checked={!draft.custom} onChange={event => update({ custom: !event.target.checked })} />{t("All permitted Host actions")}</label>
        <AnimatedCollapse expanded={draft.custom}><div className="desktop-bot-action-list">{[...new Set([...BOT_ACTIONS, ...draft.actions])].map(action => <label className="desktop-bot-check" key={action}><input data-ui="checkbox" type="checkbox" checked={draft.actions.includes(action)} onChange={event => update({ actions: event.target.checked ? [...draft.actions, action] : draft.actions.filter(item => item !== action) })} /><span>{action}</span></label>)}</div></AnimatedCollapse>
      </div></AnimatedCollapse>
    </fieldset>
    {error && <p role="alert">{t(error)}</p>}
    <footer>{dirty && <small role="status">{t("Unsaved changes")}</small>}
      <button type="button" disabled={busy} onClick={() => void reload()}>{t("Reload saved configuration")}</button>
      <button type="submit" disabled={!dirty || busy || conflict || !validAvatar || !validSlots}>{t("Save runtime settings")}</button>
    </footer>
    </div></AnimatedCollapse>
  </form>;
}
