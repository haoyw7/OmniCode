import { useRef, useState } from "react";
import type { BotMessage, SessionReference } from "../model/botView";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ChevronRight, Folder, LoaderCircle } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESS_TITLE, sessionDisplayTitle } from "../../sessions/model/session";
export function BotSessionCard({
  message,
  onOpen,
  accessible = true,
  mobile = false,
}: {
  message: Extract<BotMessage, { kind: "session-card" }>;
  onOpen: (ref: SessionReference) => Promise<void> | void;
  accessible?: boolean;
  mobile?: boolean;
}) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const open = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    try {
      await onOpen(message.ref);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };
  const title = sessionDisplayTitle(message.title, message.harness);
  const modelName = message.model.startsWith(`${message.harness}:`)
    ? message.model.slice(message.harness.length + 1) : message.model;
  const labels = {
    accepted: "Accepted",
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    unknown: "Needs review",
    unavailable: "Unavailable",
  };
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
            {mobile ? <>
              <span className="assistant-card-project" title={message.projectName}>
                <Folder size={13} aria-hidden="true" />
                <span>{message.projectName}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="assistant-card-provider" role="img" aria-label={HARNESS_TITLE[message.harness]} title={HARNESS_TITLE[message.harness]}>
                <HarnessIcon harness={message.harness} className="size-3.5" />
              </span>
              <span className="assistant-card-model" title={modelName}>{modelName}</span>
            </> : <>
            {message.projectName} ·{" "}
            {HARNESS_TITLE[message.harness] ?? message.harness} ·{" "}
            {message.model}
            </>}
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
