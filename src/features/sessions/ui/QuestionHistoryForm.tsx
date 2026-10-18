import { useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import type { QuestionAnswer, UserQuestionRecord } from "../model/userQuestion";
import { QuestionForm } from "./QuestionForm";

/** Shared late-reply handling for inline history and mobile sheets. */
export function QuestionHistoryForm({
  blockId,
  question,
  disabled = false,
  onAnswer,
  onClose,
  onCollapse,
  variant,
}: {
  blockId: string;
  question: UserQuestionRecord;
  disabled?: boolean;
  onAnswer: (answer: QuestionAnswer) => boolean | void | Promise<boolean | void>;
  onClose: () => void;
  onCollapse?: () => void;
  variant?: "card" | "dock";
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <fieldset
      disabled={disabled || sending || !visible}
      className="mobile-shared-question m-0 min-w-0 border-0 p-0"
    >
      <QuestionForm
        prompt={{ ...question, autoResolveAt: undefined }}
        onCollapse={onCollapse}
        variant={variant}
        onReply={async (_, reply) => {
          if (disabled || sending || !visible) return;
          if (reply.kind === "skipped") {
            onClose();
            return;
          }
          setSending(true);
          setError(undefined);
          try {
            const accepted = await onAnswer({ blockId, reply });
            if (accepted !== false) onClose();
          } catch (reason) {
            setError(t(reason instanceof Error ? reason.message : String(reason)));
          } finally {
            setSending(false);
          }
        }}
      />
      {error ? (
        <p role="alert" className="px-3 pb-3 text-[12px] text-red-400">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
