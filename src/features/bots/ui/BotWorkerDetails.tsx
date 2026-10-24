import { useContext, useEffect, useState } from "react";
import type { HostSession } from "../../../contracts/protocol";
import type { SessionReference } from "../model/botView";
import type { BotRpc } from "../model/botRpc";
import { BotWorkerTranscriptContext } from "./BotWorkerPresentation";
import { useTranslation } from "../../../shared/i18n/useTranslation";

export function BotWorkerDetails({
  target,
  rpc,
  onClose,
  active,
}: {
  target: SessionReference;
  rpc: BotRpc;
  onClose: () => void;
  active: boolean;
}) {
  const { t } = useTranslation();
  const Transcript = useContext(BotWorkerTranscriptContext);
  const [snapshot, setSnapshot] = useState<HostSession>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!active) return;
    let disposed = false,
      fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const value = await rpc<HostSession>("sessions.get", {
          sessionId: target.sessionId,
        });
        if (
          !value ||
          value.projectId !== target.projectId ||
          !value.session.orchestrationLeadId
        )
          throw new Error("Conversation is unavailable");
        if (!disposed) {
          setSnapshot(value);
          setError(undefined);
        }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [rpc, target, active]);
  return (
    <section className="assistant-worker" aria-label={t("Worker details")}>
      <header>
        <strong>{snapshot?.session.title ?? t("Worker details")}</strong>
        <span>{t("Read only")}</span>
        <button type="button" onClick={onClose}>
          {t("Close")}
        </button>
      </header>
      {error && <p role="alert">{t(error)}</p>}
      {snapshot && (Transcript
        ? <Transcript snapshot={snapshot} visible={active} />
        : <p role="alert">{t("Conversation is unavailable")}</p>)}
    </section>
  );
}
