import type { HarnessId } from "../model/session";
import type { SessionAccessIssue } from "../../../integrations/harness/providers/sessionAccessErrors";
import { useTranslation } from "../../../shared/i18n/useTranslation";

const RECOVERY: Partial<Record<HarnessId, string>> = {
  codex:
    "Stopping a Codex reply or closing its pane may leave the session in use. Wait for other work to finish before restarting the original app.",
  claude:
    "For a Claude background session, attach to the existing session to continue, or stop that session before retrying here.",
  omp: "OMP may start a separate conversation when the original is occupied. Close the original session before retrying if you want to continue the same conversation.",
  fx: "Close the session in the original fx client, then retry here.",
  hermes:
    "Close the original Hermes window or terminal. For a gateway session, close that session in its gateway before retrying here.",
  cursor:
    "Attach to the existing Cursor persistent session to continue, or stop that session before retrying here.",
};

export function SessionAccessNotice({
  harness,
  issue,
  message,
}: {
  harness: HarnessId;
  issue: SessionAccessIssue;
  message: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-session-access-notice={issue}
      role="status"
      className="my-1 min-w-0 rounded-lg border border-content/10 bg-content/3 px-3 py-2.5 text-sm"
    >
      <p className="font-medium text-content/80">
        {t(
          issue === "occupied"
            ? "Session is in use elsewhere"
            : "Session is temporarily unavailable",
        )}
      </p>
      <p className="mt-1 text-content/60">
        {t(
          issue === "occupied"
            ? "Another client is keeping this session open. You can still read the saved conversation here."
            : "You can still read the saved conversation here. Wait for the current operation to finish and retry. If another client has this session open, continue there or close that session first.",
        )}
      </p>
      {issue === "occupied" ? (
        <p className="mt-1 text-content/60">
          {t(
            RECOVERY[harness] ??
              "Continue in the original client, or close its session and retry here.",
          )}
        </p>
      ) : null}
      <details className="mt-2 text-content/50">
        <summary className="cursor-pointer select-none">
          {t("Original provider error")}
        </summary>
        <pre className="mt-1 min-w-0 whitespace-pre-wrap break-words text-xs">
          {message}
        </pre>
      </details>
    </div>
  );
}
