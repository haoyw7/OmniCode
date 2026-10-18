import { useRef, useState } from "react";
import type { BotMessage, SessionReference } from "../model/botView";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ArrowUpRight, ChevronRight, LoaderCircle } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESS_TITLE, sessionDisplayTitle } from "../../sessions/model/session";
import { Button } from "../../../shared/ui/forms/Button";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { botErrorMessage } from "../model/botErrors";
export function BotSessionCard({
  message,
  onOpen,
  accessible = true,
  mobile = false,
  onTimeline,
}: {
  message: Extract<BotMessage, { kind: "session-card" }>;
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
  const model = message.model.startsWith(`${message.harness}:`) ? message.model.slice(message.harness.length + 1) : message.model;
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
      <div className="assistant-task-identity">
        <div className="assistant-task-context">
          <strong>{message.projectName}</strong>
          <span className="assistant-task-harness" role="img" aria-label={HARNESS_TITLE[message.harness] ?? message.harness} title={HARNESS_TITLE[message.harness] ?? message.harness}>
            <HarnessIcon harness={message.harness} className="size-[15px]" />
          </span>
          <span className="assistant-task-model">{model}</span>
        </div>
        <span className="assistant-task-title">{title}</span>
        <small>{t("Session")}: {message.ref.sessionId}</small>
        <span role="status">{t(labels[message.status])}</span>
      </div>
      {(failure || message.error || !accessible || message.status === "unavailable") && <p role="alert">{t(failure || message.error || (!accessible
        ? "This conversation is outside the assistant's current permissions." : "Conversation is unavailable"))}</p>}
      <IconButton label={t(opening ? "Opening…" : "Open session")} aria-busy={opening || undefined} disabled={opening || !accessible || message.status === "unavailable"} onClick={() => void open()}>
        {opening ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
      </IconButton>
      {accessible && onTimeline && <Button variant="ghost" disabled={opening} onClick={() => void open(true)}>{t("View progress")}</Button>}
    </article>
  );
  return (
    <article
      className="assistant-card"
      data-session-id={message.ref.sessionId}
      data-status={message.status}
    >
      <div className="assistant-card-heading">
        {!mobile && <span className="assistant-card-icon" aria-hidden="true">
          <HarnessIcon
            harness={message.harness}
            className="size-[15px]"
          />
        </span>}
        <div className="assistant-card-title">
          <strong title={title}>{title}</strong>
          <span className="assistant-card-context">
            {message.projectName} ·{" "}
            {HARNESS_TITLE[message.harness] ?? message.harness} ·{" "}
            {message.model}
          </span>
        </div>
        <span
          role="status"
          className="assistant-pill"
          aria-label={message.status === "running" ? t(labels.running) : undefined}
        >
          {message.status === "running" ? (
            <LoaderCircle
              className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : t(labels[message.status])}
        </span>
      </div>
      {message.error && <p>{message.error}</p>}
      {failure && <p role="alert">{t(failure)}</p>}
      <button
        type="button"
        aria-label={mobile ? `${t(opening ? "Opening…" : "Open session")}: ${title}` : undefined}
        aria-busy={opening || undefined}
        disabled={opening || !accessible || message.status === "unavailable"}
        onClick={() => void open()}
      >
        {!mobile && t(opening ? "Opening…" : "Open session")}
        {opening ? (
          <LoaderCircle
            size={mobile ? 18 : 14}
            className="shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : <ChevronRight size={mobile ? 18 : 14} aria-hidden="true" />}
      </button>
    </article>
  );
}
