import { Omi } from "../shared/ui/branding/Omi";
import { motion } from "motion/react";
import { popTransition, motionGeometry } from "../shared/motion/tokens";
import { MobileSpinner } from "./MobileSpinner";
import { useTranslation } from "../shared/i18n/useTranslation";

function formatLastOnline(at: number, now: number, language: string) {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(language, sameDay ? { timeStyle: "short" } : { dateStyle: "long" })
    .format(at);
}

/** Home's body while the selected device is unreachable or still connecting. */
export function MobileHostUnavailable({ failed, retrying, lastOnline, now, onRetry }: {
  failed: boolean;
  retrying: boolean;
  lastOnline?: number;
  now: number;
  onRetry: () => void;
}) {
  const { language, t } = useTranslation();
  const spinning = retrying || !failed;
  return (
    <div className="mobile-host-unavailable" role={failed ? "alert" : "status"} aria-busy={spinning}>
      <motion.span initial={false} animate={{ opacity: spinning ? 1 : 0, scale: spinning ? 1 : motionGeometry.popScale }} transition={popTransition} className="mobile-host-unavailable-spinner" data-visible={spinning} aria-hidden="true">
        <MobileSpinner size={24} className={spinning ? "mobile-spin" : undefined} />
      </motion.span>
      <Omi compact expression={failed ? "error" : "connecting"} animated={!failed || retrying} className="mobile-host-unavailable-logo" />
      <strong>{t(failed ? "Couldn’t connect" : "Connecting…")}</strong>
      {lastOnline !== undefined && (
        <span>{t("Last online: {time}", { time: formatLastOnline(lastOnline, now, language) })}</span>
      )}
      {failed && (
        <button type="button" disabled={retrying} onClick={onRetry} className="hover:opacity-80 active:opacity-70">{t("Retry")}</button>
      )}
    </div>
  );
}
