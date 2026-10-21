import { useTranslation } from "../shared/i18n/useTranslation";
import { Button } from "../shared/ui/forms/Button";
import { Lock } from "../shared/ui/icons";
import { useRef } from "react";
import { useMobileComposerDock } from "./useMobileComposerDock";

export function MobileOccupiedSessionNotice({
  retrying, disabled, onRetry, onFork,
}: {
  retrying: boolean;
  disabled: boolean;
  onRetry: () => void;
  onFork: () => void;
}) {
  const { t } = useTranslation();
  const dock = useRef<HTMLDivElement>(null);
  useMobileComposerDock(dock);
  return (
    <div className="mobile-composer-dock" ref={dock}>
      <div className="mobile-session-occupied" role="status">
        <Lock size={16} aria-hidden="true" />
        <div className="mobile-session-occupied-copy">
          <strong>{t("Open in another app")}</strong>
          <p>{t("Close the session there before continuing here.")}</p>
        </div>
        <div className="mobile-session-occupied-actions">
          <Button variant="ghost" disabled={disabled || retrying} onClick={onRetry}>
            {t(retrying ? "Checking session status…" : "Retry")}
          </Button>
          <Button variant="ghost" disabled={disabled} onClick={onFork}>
            {t("Fork chat")}
          </Button>
        </div>
      </div>
    </div>
  );
}
