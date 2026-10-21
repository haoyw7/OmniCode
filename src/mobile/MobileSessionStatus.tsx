import { useEffect, useId, useState, type RefObject } from "react";
import { Check, Copy } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import type {
  HostModelCatalog,
  HostSession,
} from "../features/connections/model/protocol";
import {
  contextPercent,
} from "../features/sessions/model/contextUsage";
import {
  contextBreakdownRows,
  formatContextTokens,
} from "../features/sessions/model/contextBreakdown";
import { MobileSheet } from "./MobileSheet";
import { MobileHostStatus } from "./MobileHostStatus";
import { mobileTranscriptPlatform } from "./transcriptPlatform";
import type { HostConnectionStatus } from "./client";
import { mobileContextUsage } from "./contextUsage";
import { ContextUsageDetails } from "../features/sessions/ui/ContextUsageDetails";
import { ContextBreakdownBar } from "../shared/ui/messaging/ContextBreakdown";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";
import { DisclosureChevron } from "../shared/ui/DisclosureChevron";
import { HarnessIcon } from "../features/sessions/ui/HarnessIcon";
import { HARNESS_TITLE } from "../features/sessions/model/session";
import {
  configurationForSession,
  configurationLabels,
} from "./MobileModelControls";

const RUN_STATUS_LABEL: Record<HostSession["status"], string> = {
  idle: "Idle",
  running: "Running",
  interrupted: "Interrupted",
};

function StatusField({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="mobile-status-field">
      <div className="mobile-status-field-label">
        <strong>{t(label)}</strong>
        {copyable && (
          <button
            type="button"
            className="hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70 mobile-status-copy"
            aria-label={t(copied ? "Copied" : "Copy")}
            title={t(copied ? "Copied" : "Copy")}
            onClick={() =>
              void mobileTranscriptPlatform
                .copyText(value)
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            {copied ? <Check /> : <Copy />}
          </button>
        )}
      </div>
      <span className="mobile-status-field-value" title={value}>
        {value}
      </span>
    </div>
  );
}

/** Read-only overview of where the current conversation runs. */
export function MobileSessionStatus({
  open = true,
  onExited,
  snapshot,
  catalog,
  hostName,
  hostStatus,
  anchor,
  onClose,
}: {
  open?: boolean;
  onExited?: () => void;
  snapshot: HostSession;
  catalog?: HostModelCatalog;
  hostName: string;
  hostStatus: HostConnectionStatus;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const session = snapshot.session;
  const [contextExpanded, setContextExpanded] = useState(false);
  const contextDetailsId = useId();
  const directory = session.executionCwd || session.cwd;
  const context = mobileContextUsage(session, catalog);
  const percent = contextPercent(context);
  const contextRows = context ? contextBreakdownRows(context) : [];
  const contextSegments = contextRows.length
    ? contextRows.map((row) => ({
        tone: row.tone,
        fraction: row.percent === null ? undefined : row.percent / 100,
      }))
    : percent === null
      ? []
      : [{ tone: "messages", fraction: percent / 100 }];
  const configuration = configurationForSession(snapshot);
  const { modelName, effort } = configurationLabels(
    catalog,
    configuration,
    configuration.model,
  );
  const agentLabel = [
    HARNESS_TITLE[configuration.harness],
    modelName,
    effort && t(effort),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <MobileSheet open={open} onExited={onExited}
      title="Status"
      header={{ title: t("Status") }}
      anchor={anchor}
      onClose={onClose}
    >
      <div className="mobile-status">
        <div className="mobile-status-summary">
          <span className="mobile-status-host">
            <strong>{hostName}</strong>
            <MobileHostStatus status={hostStatus} />
          </span>
          <small>
            {t(
              hostStatus.state === "connected"
                ? "Remote session connected"
                : "Remote session unavailable",
            )}
            {" · "}
            {t(RUN_STATUS_LABEL[snapshot.status])}
          </small>
        </div>
        <div className="mobile-menu-divider" role="separator" />
        <section className="mobile-status-context">
          <button
            type="button"
            className="hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70 mobile-status-context-toggle"
            aria-expanded={contextExpanded}
            aria-controls={contextDetailsId}
            onClick={() => setContextExpanded((value) => !value)}
          >
            <strong>{t("Context")}</strong>
            <span>
              {percent === null ? "—" : t("{percent}% used", { percent })}
            </span>
            <DisclosureChevron
              expanded={contextExpanded}
              direction="down"
              className="size-4 shrink-0"
            />
          </button>
          {context && (
            <>
              {contextSegments.length > 0 && (
                <ContextBreakdownBar segments={contextSegments} />
              )}
              <small className="mobile-status-context-total">
                {context.window
                  ? t("{used} / {window} tokens", {
                      used: formatContextTokens(context.used),
                      window: formatContextTokens(context.window),
                    })
                  : t("{tokens} tokens", {
                      tokens: formatContextTokens(context.used),
                    })}
              </small>
            </>
          )}
          <AnimatedCollapse expanded={contextExpanded}>
            <div id={contextDetailsId} className="mobile-status-context-details">
              {context ? (
                <ContextUsageDetails usage={context} />
              ) : (
                <p>{t("Not reported by this agent yet")}</p>
              )}
            </div>
          </AnimatedCollapse>
        </section>
        <StatusField
          label={session.providerSessionId ? "Thread" : "Session ID"}
          value={session.providerSessionId || session.id}
          copyable
        />
        <StatusField label="Directory" value={directory} copyable />
        {session.branch && (
          <StatusField label="Branch" value={session.branch} />
        )}
        <div className="mobile-status-field mobile-status-agent">
          <div className="mobile-status-field-label">
            <strong>{t("Agent")}</strong>
          </div>
          <span className="mobile-status-agent-name" title={agentLabel}>
            <HarnessIcon harness={configuration.harness} className="size-4" />
            <span>{agentLabel}</span>
          </span>
        </div>
      </div>
    </MobileSheet>
  );
}
