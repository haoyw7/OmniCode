import { MobileSpinner } from "./MobileSpinner";
import type { ButtonHTMLAttributes } from "react";
import type { HostSessionSummary } from "../contracts/protocol";
import { sessionDisplayTitle } from "../features/sessions/model/session";
import { sessionRecencyAt } from "../domain/sessionActivity";
import { HarnessIcon } from "../shared/ui/HarnessIcon";
import { SessionWorktreeIcon } from "../shared/ui/SessionWorktreeIcon";
import { useTranslation } from "../shared/i18n/useTranslation";
import { Pin, TriangleAlert } from "../shared/ui/icons";
import { formatRelativeTime } from "../shared/lib/relativeTime";

/** One conversation in a list page: its agent, title, then its state or age. */
export function MobileSessionRow({
  session,
  now,
  unread,
  hostName,
  ...button
}: {
  session: HostSessionSummary;
  now: number;
  unread: boolean;
  /** The paired device a row comes from when Home lists every device. */
  hostName?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { language, t } = useTranslation();
  const state =
    session.needsInput ? "input" : session.status === "running" ? "running" : "idle";
  return (
    <button
      type="button"
      className="mobile-home-session"
      data-session-id={session.id}
      data-list-row
      data-state={state}
      {...button}
    >
      <HarnessIcon
        harness={session.harness}
        className="mobile-home-session-icon"
      />
      <strong>
        <span className="min-w-0 truncate">
          {sessionDisplayTitle(session.title, session.harness) ||
            t("Untitled conversation")}
        </span>
        <SessionWorktreeIcon session={session} />
      </strong>
      {session.pinned && (
        <Pin size={14} className="mobile-home-session-pin" aria-label={t("Pinned")} />
      )}
      {hostName && <small className="mobile-home-session-host">{hostName}</small>}
      {state === "running" ? (
        <span className="mobile-home-session-state" role="img" aria-label={t("Working")}>
          <MobileSpinner size={16} className="mobile-spin" aria-hidden="true" />
        </span>
      ) : state === "input" ? (
        <span className="mobile-home-session-state" role="img" aria-label={t("Needs input")}>
          <TriangleAlert size={16} aria-hidden="true" />
        </span>
      ) : (
        <time dateTime={new Date(sessionRecencyAt(session)).toISOString()}>
          {formatRelativeTime(sessionRecencyAt(session), now, language)}
        </time>
      )}
      {unread && (
        <span className="mobile-unread-dot" role="img" aria-label={t("Unread reply")} />
      )}
    </button>
  );
}
