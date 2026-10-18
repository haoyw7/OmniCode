import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Clock, Gauge, Play } from "../../../shared/ui/icons";
import {
  ComposerNotice,
  ComposerNoticeButton,
} from "../../../shared/ui/ComposerNotice";
import type { UsageLimit } from "../model/session";
import { formatUsageLimitReset } from "../model/usageLimit";
import { useNow } from "../../../shared/hooks/useNow";

export function UsageLimitNotice({
  limit,
  onResume,
  onResumeAtReset,
  onDismiss,
}: {
  limit: UsageLimit;
  onResume?: () => void;
  /** Omitted where nothing can resume the session at the reset. */
  onResumeAtReset?: (enabled: boolean) => void;
  onDismiss?: () => void;
}) {
  const { t: uiT } = useTranslation();
  // Tick the countdown, and flip to "Resume" once the window resets.
  const now = useNow(30_000, limit.resetsAt != null && limit.resetsAt > Date.now());
  const waiting = limit.resetsAt != null && limit.resetsAt > now;

  return (
    <div className="px-2 pb-2" data-usage-limit>
      <ComposerNotice
        tone="warning"
        size="compact"
        role="status"
        icon={<Gauge className="size-3.5" />}
        detail={
          limit.resetsAt == null
            ? undefined
            : waiting
              ? uiT("Resets {value0}", {
                  value0: String(formatUsageLimitReset(limit.resetsAt, now)),
                })
              : uiT("Limit has reset")
        }
        actions={
          !waiting ? (
            <ComposerNoticeButton onClick={onResume}>
              <Play className="size-3.5" />
              {uiT("Resume")}
            </ComposerNoticeButton>
          ) : !onResumeAtReset ? null : limit.resumeAtReset ? (
            <ComposerNoticeButton
              title={uiT("Cancel the automatic resume")}
              onClick={() => onResumeAtReset(false)}
            >
              <Clock className="size-3.5" />
              {uiT("Resuming at reset")}
            </ComposerNoticeButton>
          ) : (
            <ComposerNoticeButton
              title={uiT("Continue this session once the limit resets")}
              onClick={() => onResumeAtReset(true)}
            >
              <Clock className="size-3.5" />
              {uiT("Resume at reset")}
            </ComposerNoticeButton>
          )
        }
        onDismiss={onDismiss}
        dismissLabel={uiT("Dismiss usage limit notice")}
      >
        {uiT("Usage limit reached")}
      </ComposerNotice>
    </div>
  );
}
