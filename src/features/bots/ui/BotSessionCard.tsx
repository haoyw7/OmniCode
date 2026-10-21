import { useRef, useState } from "react";
import type { BotMessage, SessionReference } from "../model/botView";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ArrowUpRight, ChevronRight, ListChecks } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESS_TITLE, sessionDisplayTitle } from "../../sessions/model/session";
import { Button } from "../../../shared/ui/forms/Button";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { botErrorMessage } from "../model/botErrors";
import type { HostModelCatalog } from "../../connections/model/protocol";
import { findRemoteModel } from "../../connections/model/remoteModels";
import { Spinner } from "../../../shared/ui/primitives/Spinner";
export function BotSessionCard({
  message,
  catalog,
  onOpen,
  accessible = true,
  mobile = false,
  onTimeline,
}: {
  message: Extract<BotMessage, { kind: "session-card" }>;
  catalog?: HostModelCatalog;
  onOpen: (ref: SessionReference) => Promise<void> | void;
  accessible?: boolean;
  mobile?: boolean;
  onTimeline?: (ref: SessionReference) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<string>();
  const openingRef = useRef(false);
  const open = async (progress = false) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setFailure(undefined);
    try {
      if (progress) await onTimeline?.(message.ref);
      else await onOpen(message.ref);
    } catch (error) {
      setFailure(botErrorMessage(error));
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };
  const title = sessionDisplayTitle(message.title, message.harness) || message.ref.sessionId;
  const model = findRemoteModel(catalog?.models[message.harness] ?? [], message.model)?.name
    || (message.model.startsWith(`${message.harness}:`) ? message.model.slice(message.harness.length + 1) : message.model);
  const labels = {
    accepted: "Accepted",
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    unknown: "Needs review",
    unavailable: "Unavailable",
  };
  if (mobile) return (
    <article className="assistant-card assistant-task-summary" data-session-id={message.ref.sessionId} data-status={message.status}>
      <div className="assistant-task-row">
        <Button variant="ghost" className="assistant-task-open" aria-label={t(opening ? "Opening…" : "Open session")}
          title={`${message.projectName} · ${model}\n${title}\n${t("Session")}: ${message.ref.sessionId}`}
          aria-busy={opening || undefined} disabled={opening || !accessible || message.status === "unavailable"} onClick={() => void open()}>
          <span className="assistant-task-harness" role="img" aria-label={HARNESS_TITLE[message.harness] ?? message.harness} title={HARNESS_TITLE[message.harness] ?? message.harness}>
            <HarnessIcon harness={message.harness} className="size-[15px]" />
          </span>
          <span className="assistant-task-title">{title}</span>
          {opening ? <Spinner className="size-4" aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}
        </Button>
        <span role="status">{t(labels[message.status])}</span>
        {accessible && onTimeline && <IconButton label={t("View progress")} shape="round" disabled={opening} onClick={() => void open(true)}><ListChecks size={16} aria-hidden="true" /></IconButton>}
      </div>
      {(failure || message.error || !accessible || message.status === "unavailable") && <p role="alert">{t(failure || message.error || (!accessible
        ? "This conversation is outside the assistant's current permissions." : "Conversation is unavailable"))}</p>}
    </article>
  );
  return (
    <article
      className="assistant-card"
      data-session-id={message.ref.sessionId}
      data-status={message.status}
    >
      <div className="assistant-card-heading">
        <div className="assistant-card-title">
          <strong title={title}>{title}</strong>
          <span className="assistant-card-context">
            <span className="assistant-card-project" title={message.projectName}>{message.projectName}</span>
            {model && <span className="assistant-card-model" title={model}>
              <span className="shrink-0" role="img" aria-label={HARNESS_TITLE[message.harness] ?? message.harness} title={HARNESS_TITLE[message.harness] ?? message.harness}>
                <HarnessIcon harness={message.harness} className="size-[13px]" />
              </span>
              <span className="assistant-card-model-name">{model}</span>
            </span>}
          </span>
        </div>
        <span
          role="status"
          className="assistant-pill"
          aria-label={message.status === "running" ? t(labels.running) : undefined}
        >
          {message.status === "running" ? (
            <Spinner className="size-3.5 shrink-0" aria-hidden="true" />
          ) : t(labels[message.status])}
        </span>
      </div>
      {message.error && <p>{message.error}</p>}
      {failure && <p role="alert">{t(failure)}</p>}
      <Button variant="ghost" size="content"
        type="button"
        aria-label={mobile ? `${t(opening ? "Opening…" : "Open session")}: ${title}` : undefined}
        aria-busy={opening || undefined}
        disabled={opening || !accessible || message.status === "unavailable"}
        onClick={() => void open()}
      >
        {!mobile && t(opening ? "Opening…" : "Open session")}
        {opening ? (
          <Spinner className={mobile ? "size-[18px] shrink-0" : "size-3.5 shrink-0"} aria-hidden="true" />
        ) : <ChevronRight size={mobile ? 18 : 14} aria-hidden="true" />}
      </Button>
    </article>
  );
}
