import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { withToast } from "../shared/ui/primitives/Sonner";
import { botRpcQuery } from "../features/bots/model/botPanelQueries";
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
  const modelsRead = useQuery({ ...botRpcQuery<HostModelCatalog>(rpc, "models.list"), enabled: visible }, queryClient);
  const projectsRead = useQuery({ ...botRpcQuery<HostProject[]>(rpc, "projects.list"), enabled: visible }, queryClient);
  const catalog = modelsRead.data ?? { models: {}, errors: {} }, projects = projectsRead.data ?? [];
  const catalogCause = modelsRead.error ?? projectsRead.error;
  const catalogError = catalogCause ? botErrorMessage(catalogCause) : undefined;
  const catalogState = catalogCause ? "failed" : modelsRead.data && projectsRead.data ? "ready" : "loading";
  const pending = useRef(false);
  const command = useRef<{ text: string; id: string } | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const back = () => { if (!pending.current) onClose(); };
  useImperativeHandle(ref, () => ({ back }));
  const mutation = useMutation({ mutationFn: ({ patch, commandId }: { patch: BotPatch; commandId: string }) => withToast(() => rpc<{ bot: BotView; thread: BotThread }>("bots.create", { commandId, patch }),
    { loading: t("Saving…"), success: false, error: cause => t(botErrorMessage(cause)) }) }, queryClient);
  const busy = mutation.isPending, error = mutation.error ? botErrorMessage(mutation.error) : undefined;
  const create = async (patch: BotPatch) => {
    if (pending.current) return;
    pending.current = true;
    const text = JSON.stringify(patch);
    if (command.current?.text !== text) command.current = { text, id: crypto.randomUUID() };
    try {
      const result = await mutation.mutateAsync({ commandId: command.current.id, patch });
      if (mounted.current) onCreated(result.bot, result.thread);
    } catch {
      // Mutation exposes the error beside the retained draft.
    } finally {
      pending.current = false;
    }
  };
  return <main className="mobile-bots mobile-bots-create" inert={!visible} aria-hidden={!visible || undefined}
    onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); back(); } }}>
    <header className="mobile-header mobile-bots-header">
      <IconButton label={t("Back")} disabled={busy} onClick={back}><ArrowLeft /></IconButton>
      <div className="mobile-header-title"><strong role="heading" aria-level={1}>{t("New bot")}</strong></div>
    </header>
    <div className="mobile-bots-create-content" data-mobile-page-scroll>
      {error && <p className="mobile-bots-error" role="alert">{t(error)}</p>}
      <BotSettings value={null} mobile Select={MobileAssistantSelect} submitLabel="Create bot"
        catalog={catalog} catalogState={catalogState} catalogError={catalogError}
        onRetryCatalog={() => { void modelsRead.refetch(); void projectsRead.refetch(); }} projects={projects} busy={busy}
        onSave={create} onCancel={back} />
    </div>
  </main>;
}
