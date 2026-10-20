import { Input } from "../../../shared/ui/forms/Input";
import { Button } from "../../../shared/ui/forms/Button";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { Switch } from "../../../shared/ui/forms/Switch";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotView, BotsSnapshot } from "../model/bots";
import { BOT_ACTIONS } from "../model/botActions";
import { botErrorMessage } from "../model/botErrors";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { ChevronDown, Folder, X } from "../../../shared/ui/icons";
import { basename } from "../../../platform/tauri/fs";
import { HostFolderBrowser, type HostFolderListing } from "../../../shared/ui/HostFolderBrowser";
import { BotAvatar } from "./BotAvatar";
import "./desktop-bot-details.css";

type Fields = { workingDirectory: string; slots: string; custom: boolean; actions: string[]; computer: boolean; callableBotIds: string[] };
const fields = (bot: BotView): Fields => ({ workingDirectory: bot.workingDirectory ?? "", slots: String(bot.maxConcurrentRuns ?? 3), custom: bot.tools?.enabledActions !== undefined, actions: [...(bot.tools?.enabledActions ?? BOT_ACTIONS)], computer: bot.tools?.computer ?? false, callableBotIds: [...(bot.callableBotIds ?? [])].filter(id => id !== bot.id) });

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
  const [browsing, setBrowsing] = useState(false);
  useEffect(() => {
    if (!visible || !delegationSupported) return;
    let stopped = false;
    setBotsLoading(true);
    void rpc<BotsSnapshot>("bots.list").then(snapshot => {
      if (!stopped) { setCallableBots(snapshot.bots.filter(item => item.id !== bot.id && !item.archivedAt)); setBotsError(undefined); }
    }, cause => { if (!stopped) setBotsError(botErrorMessage(cause)); }).finally(() => { if (!stopped) setBotsLoading(false); });
    return () => { stopped = true; };
  }, [visible, delegationSupported, bot.id, rpc, botsAttempt]);
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.fields);
  useEffect(() => {
    if (!dirty && !busy && !command.current && bot.revision > base.revision) {
      const next = fields(bot); setBase({ revision: bot.revision, fields: next }); setDraft(next);
    }
  }, [bot, base.revision, dirty, busy]);
  const update = (patch: Partial<Fields>) => setDraft(value => ({ ...value, ...patch }));
  const slots = Number(draft.slots), validSlots = Number.isInteger(slots) && slots >= 1 && slots <= 10;
  const save = async () => {
    if (busy || !dirty || conflict || !validSlots) return;
    const patch = { workingDirectory: draft.workingDirectory.trim() || null, maxConcurrentRuns: slots,
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
  const switchRow = (label: string, checked: boolean, onChange: (checked: boolean) => void, key?: string, leading?: ReactNode) =>
    <label className="desktop-bot-row" key={key}>{leading}<span className="desktop-bot-row-title">{label}</span><Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label={label} /></label>;
  const actions = [...new Set([...BOT_ACTIONS, ...draft.actions])];
  const callableIds = [...new Set([...callableBots.map(item => item.id), ...draft.callableBotIds])].filter(id => id !== bot.id);
  return <form className="desktop-bot-runtime" aria-label={t("Bot runtime settings")} onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset className="desktop-bot-page-body" disabled={busy}>
      <section className="desktop-bot-section">
        <h3 className="desktop-bot-section-title">{t("Run environment")}</h3>
        <div className="desktop-bot-row-group">
          <div className="desktop-bot-row-block">
            <div className="desktop-bot-row">
              <span className="desktop-bot-row-title">{t("Working directory")}</span>
              <button type="button" className="desktop-bot-runtime-directory" aria-label={t("Choose working directory")} aria-expanded={browsing} title={draft.workingDirectory || undefined} onClick={() => setBrowsing(value => !value)}>
                <Folder size={14} aria-hidden="true" />
                <span data-empty={!draft.workingDirectory || undefined}>{draft.workingDirectory ? basename(draft.workingDirectory) : t("Use a separate directory for each thread")}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {draft.workingDirectory && <IconButton size="sm" label={t("Clear working directory")} onClick={() => update({ workingDirectory: "" })}><X /></IconButton>}
            </div>
            <AnimatedCollapse expanded={browsing}><div className="desktop-bot-runtime-browser">
              <HostFolderBrowser browse={path => rpc<HostFolderListing>("projects.browse", { path })} initialPath={draft.workingDirectory || undefined} disabled={busy}
                pickLabel={t("Use this folder")} onCancel={() => setBrowsing(false)}
                onPick={path => { update({ workingDirectory: path }); setBrowsing(false); }} />
            </div></AnimatedCollapse>
          </div>
          <label className="desktop-bot-row"><span className="desktop-bot-row-title">{t("Concurrent runs")}</span><Input className="desktop-bot-runtime-number" type="number" min={1} max={10} step={1} value={draft.slots} aria-invalid={!validSlots || undefined} onChange={event => update({ slots: event.target.value })} /></label>
          {switchRow(t("Reserve the Host computer during this Bot's runs"), draft.computer, computer => update({ computer }))}
        </div>
        {!validSlots && <small className="desktop-bot-section-note" role="alert">{t("Choose between 1 and 10 concurrent runs.")}</small>}
      </section>
      {delegationSupported && <section className="desktop-bot-section">
        <h3 className="desktop-bot-section-title">{t("Callable bots")}{draft.callableBotIds.length > 0 && <span>{draft.callableBotIds.length}</span>}</h3>
        <p className="desktop-bot-section-note">{t("Only selected Bots on this Host can be called. Bots cannot call themselves or delegate again.")}</p>
        <div className="desktop-bot-row-group" role="group" aria-label={t("Callable bots")}>
          {callableIds.map(id => {
            const target = callableBots.find(item => item.id === id);
            return switchRow(target?.name ?? t("Unavailable Bot"), draft.callableBotIds.includes(id), checked => update({ callableBotIds: checked ? [...draft.callableBotIds, id] : draft.callableBotIds.filter(item => item !== id) }), id, <BotAvatar bot={{ id, avatar: target?.avatar }} size={24} />);
          })}
          {botsLoading && !callableIds.length && <p className="desktop-bot-row" role="status">{t("Loading…")}</p>}
          {botsError && <p className="desktop-bot-row" role="alert"><span className="desktop-bot-row-title">{t(botsError)}</span><Button size="sm" variant="secondary" type="button" onClick={() => setBotsAttempt(value => value + 1)}>{t("Retry")}</Button></p>}
          {!botsLoading && !botsError && !callableIds.length && <p className="desktop-bot-row">{t("No other bots on this Host")}</p>}
        </div>
      </section>}
      <div className="desktop-bot-row-group"><section className="assistant-settings-section" data-open={toolsOpen}>
        <button type="button" className="assistant-settings-disclosure" aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}>
          <span className="assistant-settings-disclosure-title">{t("Host tools")}</span>
          <span className="assistant-settings-summary">{draft.custom ? `${draft.actions.length}/${actions.length}` : t("All")}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <AnimatedCollapse expanded={toolsOpen}><div className="desktop-bot-tool-options">
          <p>{t("These choices restrict Host control actions. Provider tools and user MCP servers keep their own permissions.")}</p>
          {switchRow(t("All permitted Host actions"), !draft.custom, all => update({ custom: !all }))}
          <AnimatedCollapse expanded={draft.custom}><div className="desktop-bot-action-list">{actions.map(action => switchRow(action, draft.actions.includes(action), checked => update({ actions: checked ? [...draft.actions, action] : draft.actions.filter(item => item !== action) }), action))}</div></AnimatedCollapse>
        </div></AnimatedCollapse>
      </section></div>
      <p className="desktop-bot-section-note">{t("Changes apply to the next turn. Manage permissions in Bot settings.")}</p>
    </fieldset>
    {error && <p className="desktop-bot-runtime-error" role="alert">{t(error)}</p>}
    {/* Like the Bot settings save bar, actions only appear when there is a draft or conflict. */}
    <AnimatedCollapse expanded={dirty || conflict} className="desktop-bot-page-footer">
      <footer>{dirty && <small role="status">{t("Unsaved changes")}</small>}
        <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => void reload()}>{t("Reload saved configuration")}</Button>
        <Button size="sm" variant="primary" type="submit" disabled={!dirty || busy || conflict || !validSlots}>{t("Save runtime settings")}</Button>
      </footer>
    </AnimatedCollapse>
  </form>;
}
