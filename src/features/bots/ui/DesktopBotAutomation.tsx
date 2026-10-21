import { Button } from "../../../shared/ui/forms/Button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { botRpcQuery } from "../model/botPanelQueries";
import { useCallback, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotPatch } from "../model/botView";
import type { BotView } from "../model/bots";
import type { HostModelCatalog, HostProject, HostSessionSummary } from "../../connections/model/protocol";
import { botErrorMessage } from "../model/botErrors";
import { BotSettings } from "./BotSettings";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import "./desktop-bot-details.css";

/** A separate revisioned draft for schedules/follow rules, with existing live habit controls. */
type Props = { bot: BotView; rpc: BotRpc; onSaved: () => void };
export function DesktopBotAutomation(props: Props) {
  return <Automation key={props.bot.id} {...props} />;
}
function Automation({ bot, rpc, onSaved }: Props) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const [base, setBase] = useState(bot), [version, setVersion] = useState(0);
  const modelsRead = useQuery({ ...botRpcQuery<HostModelCatalog>(rpc, "models.list"), enabled: visible }, queryClient);
  const projectsRead = useQuery({ ...botRpcQuery<HostProject[]>(rpc, "projects.list"), enabled: visible }, queryClient);
  const savedRead = useQuery({ ...botRpcQuery<BotView>(rpc, "bots.get", { botId: bot.id }), enabled: false }, queryClient);
  const catalog = modelsRead.data ?? { models: {}, errors: {} }, projects = projectsRead.data ?? [];
  const catalogState = modelsRead.isError || projectsRead.isError ? "failed" : modelsRead.data && projectsRead.data ? "ready" : "loading";
  const command = useRef<{ signature: string; id: string } | undefined>(undefined), controls = useRef(new Map<string, string>());
  const load = () => Promise.all([modelsRead.refetch(), projectsRead.refetch()]);
  const saveMutation = useMutation({ mutationFn: (patch: BotPatch) => withToast(async () => {
    const signature = JSON.stringify([bot.id, base.revision, patch]);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
      const receipt = await rpc<{ revision: number }>("bots.configure", { botId: bot.id, commandId: command.current.id, expectedRevision: base.revision, patch });
      setBase(current => ({ ...current, ...patch, workingDirectory: current.workingDirectory, revision: receipt.revision }));
      setVersion(value => value + 1); command.current = undefined; onSaved();
  }, { loading: t("Saving…"), success: false, error: cause => t(botErrorMessage(cause)) }) }, queryClient);
  const busy = saveMutation.isPending || savedRead.isFetching;
  const cause = saveMutation.error ?? savedRead.error ?? modelsRead.error ?? projectsRead.error;
  const error = cause ? botErrorMessage(cause) : undefined;
  const save = async (patch: BotPatch) => { if (!busy) await saveMutation.mutateAsync(patch).catch(() => undefined); };
  const reload = async () => {
    if (busy) return;
    saveMutation.reset();
    const latest = await savedRead.refetch();
    if (latest.isSuccess) { setBase(latest.data); setVersion(value => value + 1); command.current = undefined; }
  };
  const control = async (input: Record<string, unknown>) => {
    const signature = JSON.stringify(input), commandId = controls.current.get(signature) ?? crypto.randomUUID();
    controls.current.set(signature, commandId);
    await rpc("bots.control", { botId: bot.id, commandId, ...input });
    controls.current.delete(signature); onSaved();
  };
  const loadSessions = useCallback(async (projectIds: string[]) => (await Promise.all(projectIds.map(async projectId =>
    (await queryClient.fetchQuery(botRpcQuery<HostSessionSummary[]>(rpc, "sessions.list", { projectId }))).map(row => ({ id: row.id, title: row.title || row.id, harness: row.harness, projectId, activityAt: row.activityAt ?? row.lastUserMessageAt ?? row.createdAt }))
  ))).flat(), [rpc]);
  return <section className="desktop-bot-automation" aria-label={t("Bot automation")}>
    {/* Reloading discards the draft, so it is offered only after a save fails. */}
    {error && <p className="desktop-bot-automation-error" role="alert">{t(error)} <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => void reload()}>{t("Reload saved configuration")}</Button></p>}
    <BotSettings key={`${bot.id}:${version}`} panel="automation" value={base} catalog={catalog} catalogState={catalogState} onRetryCatalog={() => void load()} projects={projects} loadSessions={loadSessions} busy={busy}
      onSave={save} reminders={bot.reminders} onCancelReminder={reminderId => control({ action: "cancelReminder", reminderId })}
      habits={{ items: bot.habits ?? [], timeZone: bot.timezone ?? "UTC", control: input => control(input) }} />
  </section>;
}
