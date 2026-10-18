import { useRef, useState } from "react";
import type { BotMessage, SessionReference } from "../model/botView";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ChevronRight, LoaderCircle } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESS_TITLE, sessionDisplayTitle } from "../../sessions/model/session";
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
  const openingRef = useRef(false);
  const open = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    try {
      if (mobile) await onTimeline?.(message.ref);
      else await onOpen(message.ref);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };
  const title = sessionDisplayTitle(message.title, message.harness);
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
      {accessible && onTimeline ? <button type="button" aria-label={t("View progress")} disabled={opening} onClick={() => void open()}>
        <span>{message.projectName} · <span role="status">{t(labels[message.status])}</span></span><ChevronRight size={18} />
      </button> : <span>{message.projectName} · <span role="status">{t(labels[message.status])}</span></span>}
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
