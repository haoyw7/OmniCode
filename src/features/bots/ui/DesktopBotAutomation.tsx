import { useCallback, useEffect, useRef, useState } from "react";
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
  const [catalog, setCatalog] = useState<HostModelCatalog>({ models: {}, errors: {} }), [projects, setProjects] = useState<HostProject[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const command = useRef<{ signature: string; id: string } | undefined>(undefined), controls = useRef(new Map<string, string>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    setCatalogState("loading");
    try {
      const [nextCatalog, nextProjects] = await Promise.all([rpc<HostModelCatalog>("models.list"), rpc<HostProject[]>("projects.list")]);
      if (alive.current) { setCatalog(nextCatalog); setProjects(nextProjects); setCatalogState("ready"); }
    } catch (cause) { if (alive.current) { setCatalogState("failed"); setError(botErrorMessage(cause)); } }
  }, [rpc]);
  useEffect(() => { if (visible && catalogState === "loading") void load(); }, [visible, load]);
  const save = async (patch: BotPatch) => {
    if (busy) return;
    const signature = JSON.stringify([bot.id, base.revision, patch]);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    setBusy(true); setError(undefined);
    try {
      const receipt = await rpc<{ revision: number }>("bots.configure", { botId: bot.id, commandId: command.current.id, expectedRevision: base.revision, patch });
      setBase(current => ({ ...current, ...patch, workingDirectory: current.workingDirectory, revision: receipt.revision }));
      setVersion(value => value + 1); command.current = undefined; onSaved();
    } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const reload = async () => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      const latest = await rpc<BotView>("bots.get", { botId: bot.id }); setBase(latest); setVersion(value => value + 1); command.current = undefined;
    } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const control = async (input: Record<string, unknown>) => {
    const signature = JSON.stringify(input), commandId = controls.current.get(signature) ?? crypto.randomUUID();
    controls.current.set(signature, commandId);
    await rpc("bots.control", { botId: bot.id, commandId, ...input });
    controls.current.delete(signature); onSaved();
  };
  const loadSessions = useCallback(async (projectIds: string[]) => (await Promise.all(projectIds.map(async projectId =>
    (await rpc<HostSessionSummary[]>("sessions.list", { projectId })).map(row => ({ id: row.id, title: row.title || row.id, harness: row.harness, projectId, activityAt: row.activityAt ?? row.lastUserMessageAt ?? row.createdAt }))
  ))).flat(), [rpc]);
  return <section className="desktop-bot-automation" aria-label={t("Bot automation")}>
    <header><button type="button" disabled={busy} onClick={() => void reload()}>{t("Reload saved configuration")}</button></header>
    {error && <p role="alert">{t(error)}</p>}
    <BotSettings key={`${bot.id}:${version}`} panel="automation" value={base} catalog={catalog} catalogState={catalogState} onRetryCatalog={() => void load()} projects={projects} loadSessions={loadSessions} busy={busy}
      onSave={save} reminders={bot.reminders} onCancelReminder={reminderId => control({ action: "cancelReminder", reminderId })}
      habits={{ items: bot.habits ?? [], timeZone: bot.timezone ?? "UTC", control: input => control(input) }} />
  </section>;
}
