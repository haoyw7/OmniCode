import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useLayoutEffect, useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Modal } from "../../../shared/ui/Modal";
import type { BotMemoryDetailProps } from "./BotChatChrome";

// The assistant overlay sits at z-index 100, above the shared dialog layer.
const OVERLAY_DIALOG_LAYER = 101;

/** Desktop panel for one remembered fact: the full text, editable or forgettable. */
export function BotMemoryDialog({
  open,
  text,
  meta,
  busy,
  error,
  onClose,
  onSave,
  onForget,
}: BotMemoryDetailProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(text);
  useLayoutEffect(() => {
    if (open) setDraft(text);
  }, [open, text]);
  const changed = !!draft.trim() && draft !== text;
  return (
    <PresenceBoundary>{open ? <Modal
      title={t("Memory")}
      description={meta}
      size="sm"
      className="desktop-bot-memory-modal"
      layer={OVERLAY_DIALOG_LAYER}
      onClose={onClose}
    >
      <div className="assistant-settings assistant-memory-dialog">
        <textarea data-ui="textarea"
          aria-label={t("Edit fact")}
          value={draft}
          maxLength={1000}
          disabled={busy}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing &&
              changed
            ) {
              event.preventDefault();
              onSave(draft);
            }
          }}
        />
        {error && (
          <small className="assistant-field-error" role="alert">
            {error}
          </small>
        )}
        <footer className="assistant-settings-footer">
          <button data-ui="button" data-variant="secondary"
            type="button"
            className="assistant-danger"
            disabled={busy}
            onClick={onForget}
          >
            {t("Forget")}
          </button>
          <button data-ui="button" data-variant="secondary" type="button" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </button>
          <button data-ui="button" data-variant="primary"
            type="button"
            className="assistant-primary"
            disabled={busy || !changed}
            onClick={() => onSave(draft)}
          >
            {t("Save")}
          </button>
        </footer>
      </div>
    </Modal> : null}</PresenceBoundary>
  );
}
