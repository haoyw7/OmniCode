import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useLayoutEffect } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";
import type { BotMemoryDetailProps } from "./BotChatChrome";

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
  const form = useForm({
    resolver: zodResolver(z.object({ text: z.string().refine(value => !!value.trim(), t("This field is required")).max(1000, t("Use at most {count} characters", { count: 1000 })) })),
    defaultValues: { text },
  });
  const draft = useWatch({ control: form.control, name: "text" });
  const { reset } = form;
  useLayoutEffect(() => {
    if (open) reset({ text });
  }, [open, text, reset]);
  const changed = !!draft.trim() && draft !== text;
  const save = form.handleSubmit(async ({ text }) => {
    if (busy || !changed) return;
    try { await onSave(text); } catch (cause) { toast.error(cause instanceof Error ? cause.message : String(cause)); }
  });
  return (
    <PresenceBoundary>{open ? <Modal
      title={t("Memory")}
      description={meta}
      size="sm"
      className="desktop-bot-memory-modal"
      onClose={onClose}
    >
      <form noValidate onSubmit={event => { event.stopPropagation(); void save(event); }} className="assistant-settings assistant-memory-dialog">
        <textarea data-ui="textarea"
          aria-label={t("Edit fact")}
          {...form.register("text")}
          aria-invalid={!!form.formState.errors.text}
          maxLength={1000}
          disabled={busy}
          autoFocus
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing &&
              changed
            ) {
              event.preventDefault();
              void save();
            }
          }}
        />
        <FieldError errors={[form.formState.errors.text]} />
        {error && (
          <small className="assistant-field-error" role="alert">
            {error}
          </small>
        )}
        <ModalFooter className="assistant-memory-actions">
          <Button variant="secondary" className="assistant-danger" disabled={busy} onClick={onForget}>
            {t("Forget")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={busy || form.formState.isSubmitting || !changed}>
            {t("Save")}
          </Button>
        </ModalFooter>
      </form>
    </Modal> : null}</PresenceBoundary>
  );
}
