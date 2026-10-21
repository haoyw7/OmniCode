import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
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
  const mutation = useMutation({ mutationFn: async (answer: QuestionAnswer) => onAnswer(answer) }, queryClient);
  const sending = mutation.isPending;
  const error = mutation.error ? t(mutation.error instanceof Error ? mutation.error.message : String(mutation.error)) : undefined;
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
          try {
            const accepted = await mutation.mutateAsync({ blockId, reply });
            if (accepted !== false) onClose();
          } catch { /* Keep the rejected reply editable and show the mutation error. */ }
        }}
      />
      {error ? (
        <p role="alert" className="px-3 pb-3 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
