import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { Input } from "../../../shared/ui/forms/Input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { botRpcQuery } from "../model/botPanelQueries";
import { Button } from "../../../shared/ui/forms/Button";
import { useContext, useEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import { botErrorMessage } from "../model/botErrors";
import type { BotModelOverride, BotThread, BotView } from "../model/bots";
import type { HostModelCatalog, RemoteProvider } from "../../connections/model/protocol";
import { carryModelSettings, findRemoteModel, remoteModelControls } from "../../connections/model/remoteModels";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { Archive } from "../../../shared/ui/icons";
import { Switch } from "../../../shared/ui/forms/Switch";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { BotModelPickerContext } from "./BotChatChrome";
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
  const [base, setBase] = useState(thread);
  const schema = z.object({
    title: z.string().max(200, t("Use at most {count} characters", { count: 200 })).refine(value => value === base.title || !!value.trim(), t("Enter a name")),
    override: z.custom<BotModelOverride>().optional().refine(value => !value || !!value.model, t("Choose a model")),
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { title: thread.title, override: thread.modelOverride } });
  const [title, override] = useWatch({ control: form.control, name: ["title", "override"] });
  const setTitle = (value: string) => form.setValue("title", value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  const setOverride = (value: BotModelOverride | undefined) => form.setValue("override", value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  const catalogRead = useQuery({ ...botRpcQuery<HostModelCatalog>(rpc, "models.list"), enabled: visible && !!override }, queryClient);
  const catalog = catalogRead.data, catalogError = catalogRead.error ? botErrorMessage(catalogRead.error) : undefined;
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const actionMutation = useMutation({ mutationFn: (action: () => Promise<void>) => withToast(action,
    { loading: t("Saving…"), success: false, error: cause => t(botErrorMessage(cause)) }) }, queryClient);
  const busy = actionMutation.isPending, error = actionMutation.error ? botErrorMessage(actionMutation.error) : undefined;
  const dirty = signature(title, override) !== signature(base.title, base.modelOverride);
  useEffect(() => {
    if (dirty || busy) return;
    setBase(thread); setTitle(thread.title); setOverride(thread.modelOverride);
  }, [thread, dirty, busy]);
  const loadModels = () => catalogRead.refetch();
  const save = form.handleSubmit(({ title, override }) => {
    if (busy || !dirty) return;
    const patch = { ...(title !== base.title ? { title: title.trim() } : {}), modelOverride: override ?? null };
    const text = JSON.stringify([base.revision, patch]);
    if (command.current?.signature !== text) command.current = { signature: text, id: crypto.randomUUID() };
    const commandId = command.current.id;
    actionMutation.mutate(async () => {
      const saved = await rpc<BotThread>("botThreads.configure", { botId: bot.id, threadId: thread.id, commandId, expectedRevision: base.revision, patch });
      await onSaved();
      setBase(saved); setTitle(saved.title); setOverride(saved.modelOverride); command.current = undefined;
    });
  });
  const archive = (action: () => Promise<void>) => { if (!busy) actionMutation.mutate(action); };
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
  const ModelPicker = useContext(BotModelPickerContext);
  const reset = () => { setBase(thread); setTitle(thread.title); setOverride(thread.modelOverride); actionMutation.reset(); command.current = undefined; };
  const modelError = catalogError ?? catalog?.errors[shownOverride.harness];
  return <section className="desktop-bots-thread-settings">
    <form className="desktop-bot-page" noValidate onSubmit={save}>
      <div className="desktop-bot-page-body">
        <section className="desktop-bot-section">
          <h3 className="desktop-bot-section-title">{t("Thread")}</h3>
          <div className="desktop-bot-row-group">
            <label className="desktop-bot-row"><span className="desktop-bot-row-title">{t("Thread title")}</span><Input className="desktop-bot-row-input" aria-label={t("Thread title")} maxLength={200} aria-invalid={!!form.formState.errors.title} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
            <div className="desktop-bot-row-block">
              <label className="desktop-bot-row"><span className="desktop-bot-row-title">{t("Follow bot model")}<small>{HARNESS_TITLE[bot.harness]} · {bot.model}</small></span>
                <Switch size="sm" aria-label={t("Follow bot model")} checked={!override} disabled={busy} onCheckedChange={(follow) => setOverride(follow ? undefined : { harness: bot.harness, model: bot.model, modelSettings: { ...bot.modelSettings } })} /></label>
              <AnimatedCollapse expanded={!!override}><div className="desktop-bot-row-detail">
                {ModelPicker ? <ModelPicker catalog={catalog ?? { models: {}, errors: {} }} catalogState={catalog ? "ready" : catalogError ? "failed" : "loading"}
                  harness={shownOverride.harness} model={shownOverride.model} savedModel={base.modelOverride?.model ?? bot.model}
                  values={shownOverride.modelSettings ?? {}} disabled={busy} onChange={selectModel} onRefresh={() => void loadModels()}
                  onSettingsChange={(modelSettings) => setOverride({ ...shownOverride, modelSettings })} /> : <>
                  <SearchableSelect label={t("Thread agent")} value={shownOverride.harness} disabled={busy}
                    options={harnesses.map((harness) => ({ value: harness, label: HARNESS_TITLE[harness], icon: <HarnessIcon harness={harness} /> }))}
                    onChange={(harness) => selectModel(harness as RemoteProvider, catalog?.models[harness as RemoteProvider]?.[0]?.id ?? "")} />
                  <SearchableSelect label={t("Thread model override")} value={shownOverride.model} disabled={busy}
                    options={[...(models.some((model) => model.id === shownOverride.model) ? [] : [{ value: shownOverride.model, label: shownOverride.model || t("Select model") }]), ...models.map((model) => ({ value: model.id, label: model.name }))]}
                    onChange={(model) => selectModel(shownOverride.harness, model)} />
                  {controls.map((control) => <SearchableSelect key={control.id} label={t(control.label)} value={shownOverride.modelSettings?.[control.id] ?? control.value} disabled={busy}
                    options={control.options.map((option) => ({ value: option.value, label: t(option.label) }))}
                    onChange={(value) => setOverride({ ...shownOverride, modelSettings: { ...shownOverride.modelSettings, [control.id]: value } })} />)}
                </>}
                {modelError && <p role="alert">{t(modelError)} <Button size="sm" variant="secondary" type="button" onClick={() => void loadModels()}>{t("Retry")}</Button></p>}
              </div></AnimatedCollapse>
            </div>
          </div>
          <FieldError errors={[form.formState.errors.title, form.formState.errors.override]} />
          <p className="desktop-bot-section-note">{t("Changes apply on the next turn")}</p>
          {error && <p className="desktop-bot-section-note" role="alert">{t(error)}</p>}
        </section>
        <section className="desktop-bot-section">
          <h3 className="desktop-bot-section-title">{t("Archive")}</h3>
          <div className="desktop-bot-row-group">
            <Button variant="ghost" size="content" type="button" className="desktop-bot-row" data-tone="danger" disabled={busy || thread.id === bot.defaultThreadId} onClick={() => void archive(onArchiveThread)}><Archive size={16} aria-hidden="true" /><span className="desktop-bot-row-title">{t("Archive thread")}</span></Button>
            <Button variant="ghost" size="content" type="button" className="desktop-bot-row" data-tone="danger" disabled={busy || bot.id === defaultBotId} onClick={() => void archive(onArchiveBot)}><Archive size={16} aria-hidden="true" /><span className="desktop-bot-row-title">{t("Archive bot")}</span></Button>
          </div>
          <p className="desktop-bot-section-note">{t("Archiving stops current work. Restoring keeps the conversation history.")}
            {thread.id === bot.defaultThreadId && <> {t("Default thread cannot be archived")}</>}
            {bot.id === defaultBotId && <> {t("Default bot cannot be archived")}</>}</p>
        </section>
      </div>
      <AnimatedCollapse expanded={dirty || !!error} className="desktop-bot-page-footer">
        <footer>{dirty && <small role="status">{t("Unsaved changes")}</small>}
          <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={reset}>{t("Reset thread draft")}</Button>
          <Button size="sm" variant="primary" type="submit" disabled={busy || !dirty || (title !== base.title && !title.trim()) || (!!override && !override.model)}>{t(busy ? "Saving…" : "Save thread")}</Button>
        </footer>
      </AnimatedCollapse>
    </form>
  </section>;
}
