import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Button } from "../../../shared/ui/forms/Button";
import { Lock } from "../../../shared/ui/icons";
import { pollNativeSessionAccess } from "../data/nativeSessions";

export function OccupiedSessionNotice({ onFork }: { onFork?: () => void }) {
  const { t } = useTranslation();
  const retry = useMutation({ mutationFn: pollNativeSessionAccess }, queryClient);
  return (
    <div className="desktop-session-occupied" role="status">
      <Lock size={16} aria-hidden="true" />
      <div className="desktop-session-occupied-copy">
        <strong>{t("Open in another app")}</strong>
        <p>{t("Close the session there before continuing here.")}</p>
      </div>
      <div className="desktop-session-occupied-actions">
        <Button variant="ghost" size="lg" disabled={retry.isPending}
          onClick={() => retry.mutate()}>
          {t(retry.isPending ? "Checking session status…" : "Retry")}
        </Button>
        <Button variant="ghost" size="lg" disabled={!onFork} onClick={onFork}>
          {t("Fork chat")}
        </Button>
      </div>
    </div>
  );
}
