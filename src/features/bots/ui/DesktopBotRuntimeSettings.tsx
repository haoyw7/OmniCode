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
  const botsRead = useQuery({ ...botRpcQuery<BotsSnapshot>(rpc, "bots.list"), enabled: visible && delegationSupported }, queryClient);
  const callableBots = (botsRead.data?.bots ?? []).filter(item => item.id !== bot.id && !item.archivedAt);
  const botsError = botsRead.error ? botErrorMessage(botsRead.error) : undefined;
  const botsLoading = botsRead.isFetching;
  const [base, setBase] = useState(() => ({ revision: bot.revision, fields: fields(bot) }));
  const schema = z.object({
    workingDirectory: z.string(), slots: z.string().refine(value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10, t("Choose between 1 and 10 concurrent runs.")),
    custom: z.boolean(), actions: z.array(z.string()), computer: z.boolean(), callableBotIds: z.array(z.string()),
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: base.fields, mode: "onChange" });
  const draft = useWatch({ control: form.control }) as Fields;
  const { reset: setDraft } = form;
  const [conflict, setConflict] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const savedRead = useQuery({ ...botRpcQuery<BotView>(rpc, "bots.get", { botId: bot.id }), enabled: false }, queryClient);
  const saveMutation = useMutation({ mutationFn: (draft: Fields) => withToast(async () => {
    const patch = { workingDirectory: draft.workingDirectory.trim() || null, maxConcurrentRuns: Number(draft.slots),
      tools: { computer: draft.computer, ...(draft.custom ? { enabledActions: draft.actions } : {}) },
      ...(delegationSupported ? { callableBotIds: draft.callableBotIds.filter(id => id !== bot.id) } : {}) };
    const signature = JSON.stringify([bot.id, base.revision, patch]);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    const receipt = await rpc<{ revision: number }>("bots.configure", { botId: bot.id, commandId: command.current.id, expectedRevision: base.revision, patch });
    setBase({ revision: receipt.revision, fields: draft }); command.current = undefined; onSaved();
  }, { loading: t("Saving…"), success: false, error: cause => t(botErrorMessage(cause)) }),
    onError: cause => setConflict(/changed elsewhere/i.test(botErrorMessage(cause))),
  }, queryClient);
  const busy = saveMutation.isPending || savedRead.isFetching;
  const cause = saveMutation.error ?? savedRead.error;
  const error = cause ? botErrorMessage(cause) : undefined;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.fields);
  useEffect(() => {
    if (!dirty && !busy && !command.current && bot.revision > base.revision) {
      const next = fields(bot); setBase({ revision: bot.revision, fields: next }); setDraft(next);
    }
  }, [bot, base.revision, dirty, busy]);
  const update = (patch: Partial<Fields>) => {
    for (const key of Object.keys(patch) as (keyof Fields)[]) form.setValue(key, patch[key]!, { shouldDirty: true, shouldValidate: true });
  };
  const validSlots = schema.shape.slots.safeParse(draft.slots).success;
  const save = form.handleSubmit(values => {
    if (busy || !dirty || conflict) return;
    saveMutation.mutate(values);
  });
  const reload = async () => {
    if (busy) return;
    saveMutation.reset();
    const { data: latest, isSuccess } = await savedRead.refetch();
    if (isSuccess && latest) {
      const next = fields(latest); setBase({ revision: latest.revision, fields: next }); setDraft(next); setConflict(false); command.current = undefined;
    }
  };
  const switchRow = (label: string, checked: boolean, onChange: (checked: boolean) => void, key?: string, leading?: ReactNode) =>
    <label className="desktop-bot-row" key={key}>{leading}<span className="desktop-bot-row-title">{label}</span><Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label={label} /></label>;
  const actions = [...new Set([...BOT_ACTIONS, ...draft.actions])];
  const callableIds = [...new Set([...callableBots.map(item => item.id), ...draft.callableBotIds])].filter(id => id !== bot.id);
  return <form className="desktop-bot-runtime" aria-label={t("Bot runtime settings")} noValidate onSubmit={save}>
    <fieldset className="desktop-bot-page-body" disabled={busy}>
      <section className="desktop-bot-section">
        <h3 className="desktop-bot-section-title">{t("Run environment")}</h3>
        <div className="desktop-bot-row-group">
          <div className="desktop-bot-row-block">
            <div className="desktop-bot-row">
              <span className="desktop-bot-row-title">{t("Working directory")}</span>
              <Button variant="ghost" size="content" type="button" className="desktop-bot-runtime-directory" aria-label={t("Choose working directory")} aria-expanded={browsing} title={draft.workingDirectory || undefined} onClick={() => setBrowsing(value => !value)}>
                <Folder size={14} aria-hidden="true" />
                <span data-empty={!draft.workingDirectory || undefined}>{draft.workingDirectory ? basename(draft.workingDirectory) : t("Use a separate directory for each thread")}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
              {draft.workingDirectory && <IconButton size="sm" label={t("Clear working directory")} onClick={() => update({ workingDirectory: "" })}><X /></IconButton>}
            </div>
            <AnimatedCollapse expanded={browsing}><div className="desktop-bot-runtime-browser">
              <HostFolderBrowser browse={path => rpc<HostFolderListing>("projects.browse", { path })} initialPath={draft.workingDirectory || undefined} disabled={busy}
                pickLabel={t("Use this folder")} onCancel={() => setBrowsing(false)}
                onPick={path => { update({ workingDirectory: path }); setBrowsing(false); }} />
            </div></AnimatedCollapse>
          </div>
          <label className="desktop-bot-row"><span className="desktop-bot-row-title">{t("Concurrent runs")}</span><Input className="desktop-bot-runtime-number" type="number" min={1} max={10} step={1} value={draft.slots} aria-invalid={!!form.formState.errors.slots} onChange={event => update({ slots: event.target.value })} /></label>
          {switchRow(t("Reserve the Host computer during this Bot's runs"), draft.computer, computer => update({ computer }))}
        </div>
        <FieldError className="desktop-bot-section-note" errors={[form.formState.errors.slots]} />
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
          {botsError && <p className="desktop-bot-row" role="alert"><span className="desktop-bot-row-title">{t(botsError)}</span><Button size="sm" variant="secondary" type="button" onClick={() => void botsRead.refetch()}>{t("Retry")}</Button></p>}
          {!botsLoading && !botsError && !callableIds.length && <p className="desktop-bot-row">{t("No other bots on this Host")}</p>}
        </div>
      </section>}
      <div className="desktop-bot-row-group"><section className="assistant-settings-section" data-open={toolsOpen}>
        <Button variant="ghost" size="content" type="button" className="assistant-settings-disclosure" aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}>
          <span className="assistant-settings-disclosure-title">{t("Host tools")}</span>
          <span className="assistant-settings-summary">{draft.custom ? `${draft.actions.length}/${actions.length}` : t("All")}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </Button>
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
