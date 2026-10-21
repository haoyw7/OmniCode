import { Button } from "../../../shared/ui/forms/Button";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { botWorkerQuery } from "../model/botPanelQueries";
import type { SessionReference } from "../model/botView";
import type { BotRpc } from "../model/botRpc";
import { AgentTranscript } from "../../sessions/ui/AgentTranscript";
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
  const query = useQuery({ ...botWorkerQuery(rpc, target), enabled: active, refetchInterval: active ? 2000 : false }, queryClient);
  const snapshot = query.data;
  const error = errorMessage(query.error);
  return (
    <section className="assistant-worker" aria-label={t("Worker details")}>
      <header>
        <strong>{snapshot?.session.title ?? t("Worker details")}</strong>
        <span>{t("Read only")}</span>
        <Button variant="ghost" size="content" type="button" onClick={onClose}>
          {t("Close")}
        </Button>
      </header>
      {error && <p role="alert">{t(error)}</p>}
      {snapshot && (
        <AgentTranscript
          blocks={snapshot.session.blocks}
          busy={snapshot.status === "running"}
          cwd={snapshot.session.cwd}
          harness={snapshot.session.harness}
          model={snapshot.session.model}
          modelSettings={snapshot.session.modelSettings}
          executionState={snapshot.session.executionState}
          managed
        />
      )}
    </section>
  );
}
