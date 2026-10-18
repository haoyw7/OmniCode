import { Button } from "../shared/ui/forms/Button";
import { motion } from "motion/react";
import { motionGeometry, panelTransition } from "../shared/motion/tokens";
import { useId, useState } from "react";
import {
  REMOTE_PROVIDERS,
  type HostModelCatalog,
  type HostProviderAccounts,
  type RemoteProvider,
} from "../features/connections/model/protocol";
import { HARNESS_TITLE } from "../features/sessions/model/session";
import { isHarnessAuthError } from "../integrations/harness/core/authSupport";
import { useTranslation } from "../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";
import { ChevronDown, CircleAlert, Info } from "../shared/ui/icons";
import type { MobileAgentDefaults } from "./agentDefaults";

const MotionChevronDown = motion.create(ChevronDown);

type Issue = {
  source: string;
  summary: string;
  detail: string;
  affectsDefaults: boolean;
  needsLogin?: boolean;
};

export function MobileAgentDefaultsStatus({
  catalog,
  catalogError,
  accounts,
  accountsError,
  defaults,
  harness,
  loading,
  disabled,
  onRetry,
}: {
  catalog?: HostModelCatalog;
  catalogError: string;
  accounts?: HostProviderAccounts | null;
  accountsError: string;
  defaults: MobileAgentDefaults;
  harness: RemoteProvider;
  loading: boolean;
  disabled: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  // The saved agent can be missing from a partial catalog that resolves to a fallback.
  const preferred = defaults.harness ?? harness;
  const issues: Issue[] = [];
  if (catalogError) {
    issues.push({
      source: t("Models"),
      summary: t("Unable to load models."),
      detail: catalogError,
      affectsDefaults: true,
    });
  }
  for (const agent of REMOTE_PROVIDERS) {
    const error = catalog?.errors[agent];
    if (error) {
      const needsLogin = isHarnessAuthError(error);
      issues.push({
        source: HARNESS_TITLE[agent],
        summary: t(
          needsLogin ? "Authentication required" : "Unable to load models.",
        ),
        detail: error,
        affectsDefaults: agent === preferred,
        needsLogin,
      });
    }
    for (const account of accounts?.[agent] ?? []) {
      if (!account.defaultError) continue;
      const selectedAccount = defaults.agents?.[agent]?.accountId;
      issues.push({
        source: t("{agent} account", { agent: HARNESS_TITLE[agent] }),
        summary: t("Host default unavailable"),
        detail: t(account.defaultError),
        affectsDefaults:
          agent === preferred &&
          (!selectedAccount || selectedAccount === "default"),
      });
    }
  }
  if (accountsError) {
    issues.push({
      source: t("Accounts"),
      summary: t("Unable to load accounts."),
      detail: accountsError,
      affectsDefaults: true,
    });
  }
  if (!issues.length) return null;
  const affectsDefaults = issues.some((issue) => issue.affectsDefaults);
  const modelsLoaded = !affectsDefaults && !!catalog?.models[preferred]?.length;
  const StatusIcon = affectsDefaults ? CircleAlert : Info;
  return (
    <div className="mobile-defaults-status" aria-busy={loading}>
      <div role={affectsDefaults ? "alert" : "status"}>
        <p
          className="mobile-defaults-status-heading"
          data-attention={affectsDefaults || undefined}
        >
          <StatusIcon size={18} aria-hidden="true" />
          <strong>
            {loading
              ? t("Checking agents…")
              : modelsLoaded
                ? t("{agent} models loaded", { agent: HARNESS_TITLE[preferred] })
                : t(affectsDefaults
                  ? "Default settings need attention"
                  : "Some agents need attention")}
          </strong>
        </p>
        {modelsLoaded && <p>{t("Other agents need attention:")}</p>}
        <ul className="mobile-defaults-status-issues">
          {issues.map((issue, index) => (
            <li key={index} data-attention={issue.affectsDefaults || undefined}>
              <strong>{issue.source}</strong><span>· {issue.summary}</span>
              {issue.needsLogin && (
                <small>
                  {t("Sign in to this agent on the Host computer, then retry.")}
                </small>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="mobile-defaults-status-actions">
        <button
          type="button"
          className="mobile-defaults-status-details"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {t("Error details")}
          <MotionChevronDown size={16} aria-hidden="true" animate={{ rotate: detailsOpen ? motionGeometry.flipAngle : 0 }} transition={panelTransition} />
        </button>
        <Button variant="secondary"
          type="button"

          disabled={disabled || loading}
          onClick={onRetry}
        >
          {t(loading ? "Retrying…" : "Retry")}
        </Button>
      </div>
      <div id={detailsId}>
        <AnimatedCollapse expanded={detailsOpen}>
          <dl className="mobile-defaults-status-raw">
            {issues.map((issue, index) => (
              <div key={index}>
                <dt>{issue.source}</dt>
                <dd>{issue.detail}</dd>
              </div>
            ))}
          </dl>
        </AnimatedCollapse>
      </div>
    </div>
  );
}
