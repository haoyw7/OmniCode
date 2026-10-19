import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { BotSettings } from "../features/bots/ui/BotSettings";
import type { BotPatch } from "../features/bots/model/botView";
import type { BotRpc } from "../features/bots/model/botRpc";
import type { BotThread, BotView } from "../features/bots/model/bots";
import { botErrorMessage } from "../features/bots/model/botErrors";
import type { HostModelCatalog, HostProject } from "../features/connections/model/protocol";
import { useTranslation } from "../shared/i18n/useTranslation";
import { IconButton } from "../shared/ui/forms/IconButton";
import { ArrowLeft } from "../shared/ui/icons";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobileAssistantSelect, type MobileAssistantHandle } from "./MobileAssistant";

export function MobileBotCreate({ ref, rpc, onClose, onCreated }: {
  ref?: Ref<MobileAssistantHandle>;
  rpc: BotRpc;
  onClose: () => void;
  onCreated: (bot: BotView, thread: BotThread) => void;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [catalog, setCatalog] = useState<HostModelCatalog>({ models: {}, errors: {} });
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "failed">("loading");
  const [catalogError, setCatalogError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const command = useRef<{ text: string; id: string } | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const back = () => { if (!pending.current) onClose(); };
  useImperativeHandle(ref, () => ({ back }));
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    setCatalogState("loading"); setCatalogError(undefined);
    void Promise.all([rpc<HostModelCatalog>("models.list"), rpc<HostProject[]>("projects.list")]).then(([models, list]) => {
      if (!disposed) { setCatalog(models); setProjects(list); setCatalogState("ready"); }
    }, cause => {
      if (!disposed) { setCatalogError(botErrorMessage(cause)); setCatalogState("failed"); }
    });
    return () => { disposed = true; };
  }, [rpc, visible, attempt]);
  const create = async (patch: BotPatch) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(undefined);
    const text = JSON.stringify(patch);
    if (command.current?.text !== text) command.current = { text, id: crypto.randomUUID() };
    try {
      const result = await rpc<{ bot: BotView; thread: BotThread }>("bots.create", { commandId: command.current.id, patch });
      if (mounted.current) onCreated(result.bot, result.thread);
    } catch (cause) {
      if (mounted.current) setError(botErrorMessage(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <main className="mobile-bots mobile-bots-create" inert={!visible} aria-hidden={!visible || undefined}
    onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); back(); } }}>
    <header className="mobile-header mobile-bots-header">
      <IconButton label={t("Back")} disabled={busy} onClick={back}><ArrowLeft size={24} /></IconButton>
      <div className="mobile-header-title"><strong role="heading" aria-level={1}>{t("New bot")}</strong></div>
    </header>
    <div className="mobile-bots-create-content" data-mobile-page-scroll>
      {error && <p className="mobile-bots-error" role="alert">{t(error)}</p>}
      <BotSettings value={null} mobile Select={MobileAssistantSelect} submitLabel="Create bot"
        catalog={catalog} catalogState={catalogState} catalogError={catalogError}
        onRetryCatalog={() => setAttempt(value => value + 1)} projects={projects} busy={busy}
        onSave={create} onCancel={back} />
    </div>
  </main>;
}
