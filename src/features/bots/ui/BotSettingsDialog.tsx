import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter, type ModalSize } from "../../../shared/ui/Modal";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { SurfaceAppearance } from "../../../shared/ui/SurfaceAppearance";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { ChevronRight } from "../../../shared/ui/icons";

export function BotSettingsDialog({ title, summary, preview, open, busy, invalid, size = "md", onOpen, onCancel, onApply, children }: {
  title: string; summary: string; preview?: string; open: boolean; busy?: boolean; invalid?: boolean;
  size?: ModalSize; onOpen: () => void; onCancel: () => void; onApply: () => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (!visible && open) onCancel();
    if (visible && !open && wasOpen.current) trigger.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [visible, open, onCancel]);

  return <>
    <Button ref={trigger} variant="ghost" className="desktop-bot-settings-entry" aria-haspopup="dialog" aria-expanded={open} disabled={busy} onClick={onOpen}>
      <span className="desktop-bot-settings-entry-copy">
        <span className="desktop-bot-settings-entry-title">{title}</span>
        <span className="desktop-bot-settings-entry-summary">{summary}</span>
        {preview && <span className="desktop-bot-settings-entry-preview">{preview}</span>}
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </Button>
    <SurfaceAppearance.Provider value="settings">
      <PresenceBoundary>{open && visible ? <Modal title={title} description={t("Changes apply when you save settings.")} size={size} fitViewport className="desktop-bot-settings-dialog" onClose={onCancel}>
        <form className="assistant-settings desktop-bot-dialog-settings" noValidate onSubmit={event => {
          event.preventDefault();
          event.stopPropagation();
          if (!busy && !invalid) onApply();
        }}>
          <div className="desktop-bot-dialog-fields">{children}</div>
          <ModalFooter className="desktop-bot-dialog-footer">
            {summary && <span className="desktop-bot-dialog-status" aria-live="polite">{summary}</span>}
            <Button variant="secondary" onClick={onCancel}>{t("Cancel")}</Button>
            <Button variant="primary" type="submit" disabled={busy || invalid}>{t("Apply")}</Button>
          </ModalFooter>
        </form>
      </Modal> : null}</PresenceBoundary>
    </SurfaceAppearance.Provider>
  </>;
}
