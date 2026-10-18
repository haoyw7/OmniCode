import { useEffect, useId, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import { botErrorMessage } from "../model/botErrors";
import type { BotModelOverride, BotThread, BotView } from "../model/bots";
import type { HostModelCatalog, RemoteProvider } from "../../connections/model/protocol";
import { carryModelSettings, findRemoteModel, remoteModelControls } from "../../connections/model/remoteModels";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { ChevronRight } from "../../../shared/ui/icons";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useTranslation } from "../../../shared/i18n/useTranslation";

type Props = {
  bot: BotView; thread: BotThread; defaultBotId?: string; rpc: BotRpc;
  onSaved: () => Promise<unknown>; onArchiveBot: () => Promise<void>; onArchiveThread: () => Promise<void>;
};
const signature = (title: string, override?: BotModelOverride) => JSON.stringify([title, override ?? null]);

/** This draft belongs to the retained Thread surface, independently of Bot defaults. */
export function DesktopBotThreadSettings({ bot, thread, defaultBotId, rpc, onSaved, onArchiveBot, onArchiveThread }: Props) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [open, setOpen] = useState(false);
  const disclosure = useId();
  const [base, setBase] = useState(thread);
  const [title, setTitle] = useState(thread.title);
  const [override, setOverride] = useState(thread.modelOverride);
  const [catalog, setCatalog] = useState<HostModelCatalog>();
  const [catalogError, setCatalogError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const dirty = signature(title, override) !== signature(base.title, base.modelOverride);
  useEffect(() => {
    if (dirty || busy) return;
    setBase(thread); setTitle(thread.title); setOverride(thread.modelOverride);
  }, [thread, dirty, busy]);
  const loadModels = async () => {
    try { setCatalog(await rpc<HostModelCatalog>("models.list")); setCatalogError(undefined); }
    catch (cause) { setCatalogError(botErrorMessage(cause)); }
  };
  useEffect(() => { if (visible && open && override && !catalog && !catalogError) void loadModels(); }, [visible, open, !!override, rpc]);
  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true); setError(undefined);
    const patch = { ...(title !== base.title ? { title: title.trim() } : {}), modelOverride: override ?? null };
    const text = JSON.stringify([base.revision, patch]);
    if (command.current?.signature !== text) command.current = { signature: text, id: crypto.randomUUID() };
    try {
      const saved = await rpc<BotThread>("botThreads.configure", { botId: bot.id, threadId: thread.id, commandId: command.current.id, expectedRevision: base.revision, patch });
      await onSaved();
      setBase(saved); setTitle(saved.title); setOverride(saved.modelOverride); command.current = undefined;
    } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const archive = async (action: () => Promise<void>) => {
    setBusy(true); setError(undefined);
    try { await action(); } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const selectModel = (harness: RemoteProvider, model: string) => {
    const next = findRemoteModel(catalog?.models[harness] ?? [], model);
    setOverride({ harness, model, modelSettings: carryModelSettings(next?.settings ?? [], override?.modelSettings ?? {}) });
  };
  const lastOverride = useRef<BotModelOverride>({ harness: bot.harness, model: bot.model, modelSettings: bot.modelSettings });
  if (override) lastOverride.current = override;
  const shownOverride = override ?? lastOverride.current;
  const models = catalog?.models[shownOverride.harness] ?? [];
  const harnesses = [...new Set([...(Object.keys(catalog?.models ?? {}) as RemoteProvider[]), shownOverride.harness])];
  const controls = remoteModelControls(catalog, shownOverride.harness, shownOverride.model, shownOverride.modelSettings ?? {}, base.modelOverride?.model ?? bot.model).settings;
  return <section className="desktop-bots-thread-settings">
    <button className="desktop-bots-management-toggle" type="button" aria-expanded={open} aria-controls={disclosure} onClick={() => setOpen((value) => !value)}><span>{t("Thread settings")}</span><ChevronRight size={16} /></button>
    <AnimatedCollapse expanded={open}><div id={disclosure}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>{t("Thread title")}<input data-ui="input" aria-label={t("Thread title")} maxLength={200} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="desktop-bots-model-follow"><input data-ui="checkbox" type="checkbox" checked={!override} disabled={busy} onChange={(event) => setOverride(event.target.checked ? undefined : { harness: bot.harness, model: bot.model, modelSettings: { ...bot.modelSettings } })} />{t("Follow bot model")}</label>
      <AnimatedCollapse expanded={!!override}>
        <div className="desktop-bots-model-override">
          <label>{t("Agent")}<span className="desktop-bots-model-picker"><HarnessIcon harness={shownOverride.harness} className="size-4 shrink-0" /><select data-ui="select" aria-label={t("Thread agent")} value={shownOverride.harness} disabled={busy} onChange={(event) => {
            const harness = event.target.value as RemoteProvider;
            selectModel(harness, catalog?.models[harness]?.[0]?.id ?? "");
          }}>{harnesses.map((harness) => <option key={harness} value={harness}>{HARNESS_TITLE[harness]}</option>)}</select></span></label>
          <label>{t("Thread model override")}<select data-ui="select" aria-label={t("Thread model override")} value={shownOverride.model} disabled={busy} onChange={(event) => selectModel(shownOverride.harness, event.target.value)}>
            {!models.some((model) => model.id === shownOverride.model) && <option value={shownOverride.model}>{shownOverride.model || t("Select model")}</option>}
            {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select></label>
          {controls.map((control) => <label key={control.id}>{t(control.label)}<select data-ui="select" aria-label={t(control.label)} value={shownOverride.modelSettings?.[control.id] ?? control.value} disabled={busy} onChange={(event) => setOverride({ ...shownOverride, modelSettings: { ...shownOverride.modelSettings, [control.id]: event.target.value } })}>
            {control.options.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
          </select></label>)}
          {(catalogError || catalog?.errors[shownOverride.harness]) && <p role="alert">{t(catalogError ?? catalog!.errors[shownOverride.harness]!)} <button type="button" onClick={() => void loadModels()}>{t("Retry")}</button></p>}
        </div>
      </AnimatedCollapse>
      <small>{t("Changes apply on the next turn")}</small>
      {error && <p role="alert">{t(error)}</p>}
      <div className="desktop-bots-management-actions">
        <button type="submit" disabled={busy || !dirty || (title !== base.title && !title.trim()) || (!!override && !override.model)}>{t(busy ? "Saving…" : "Save thread")}</button>
        <button type="button" disabled={busy || (!dirty && !error)} onClick={() => { setBase(thread); setTitle(thread.title); setOverride(thread.modelOverride); setError(undefined); command.current = undefined; }}>{t("Reset thread draft")}</button>
      </div>
    </form>
    <div className="desktop-bots-archive-actions">
      <p>{t("Archiving stops current work. Restoring keeps the conversation history.")}</p>
      <button type="button" disabled={busy || thread.id === bot.defaultThreadId} onClick={() => void archive(onArchiveThread)}>{t("Archive thread")}</button>
      {thread.id === bot.defaultThreadId && <small>{t("Default thread cannot be archived")}</small>}
      <button type="button" disabled={busy || bot.id === defaultBotId} onClick={() => void archive(onArchiveBot)}>{t("Archive bot")}</button>
      {bot.id === defaultBotId && <small>{t("Default bot cannot be archived")}</small>}
    </div>
    </div></AnimatedCollapse>
  </section>;
}
