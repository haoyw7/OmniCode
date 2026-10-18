// Monocode shim for ZCode's intl hook: ZCode message ids resolve to English UI
// text (WORKFLOW_MESSAGES), which Monocode's translate() localizes.
import { useMemo } from "react";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { translate } from "../../../../shared/i18n/language";
import { WORKFLOW_MESSAGES } from "./messages";

export type Locale = "zh-CN" | "en-US";

export interface IntlInstance {
  formatMessage(descriptor: { id: string; defaultMessage?: string }, values?: Record<string, string | number>): string;
}

function englishFor(descriptor: { id: string; defaultMessage?: string }): string {
  return WORKFLOW_MESSAGES[descriptor.id] ?? descriptor.defaultMessage ?? descriptor.id;
}

/** Non-React callers (formatters run outside components). */
export const workflowIntl: IntlInstance = {
  formatMessage: (descriptor, values) => translate(englishFor(descriptor), values),
};

export function useWorkflowIntl(): { intl: IntlInstance; locale: Locale } {
  const { language, t } = useTranslation();
  return useMemo(() => ({
    intl: { formatMessage: (descriptor, values) => t(englishFor(descriptor), values) },
    locale: language === "zh-CN" ? "zh-CN" : "en-US",
  }), [language, t]);
}
