import { Button } from "../../../shared/ui/forms/Button";
import { Textarea } from "../../../shared/ui/forms/Textarea";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { MessageSquarePlus, X } from "../../../shared/ui/icons";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import { diffCommentLocation, formatDiffComment } from "../model/diffComment";
import { MOD } from "../../../platform/tauri/platform";
import { requestAddToChat } from "../../sessions/model/quoteDraft";
import type { UnifiedLine } from "../model/unifiedDiff";

export type DiffCommentComposerTarget = {
  line: UnifiedLine;
  anchor: PopoverAnchor;
};

export function DiffCommentComposer({
  path,
  target,
  onDismiss,
}: {
  path: string;
  target: DiffCommentComposerTarget;
  onDismiss: () => void;
}) {
  const { t: uiT } = useTranslation();
  const form = useForm({ resolver: zodResolver(z.object({ comment: z.string().trim().min(1, uiT("This field is required")) })), defaultValues: { comment: "" } });
  const comment = useWatch({ control: form.control, name: "comment" });
  const location = diffCommentLocation({ path, line: target.line });
  const addToChat = form.handleSubmit(({ comment }) => {
    const text = formatDiffComment({ path, line: target.line }, comment);
    if (!text) return;
    requestAddToChat(text, "plain");
    onDismiss();
  });

  return (
    <Popover
      anchor={target.anchor}
      side="right"
      align="start"
      gap={6}
      width={320}
      onDismiss={onDismiss}
      role="dialog"
      aria-label={uiT("Comment on {value0}", { value0: String(location) })}
      className="p-2"
    >
      <form
        noValidate onSubmit={addToChat}
      >
        <div className="mb-1.5 flex items-center gap-2 px-0.5">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-content/55"
            title={location}
          >
            {location}
          </span>
          <Button variant="ghost" size="content"
            type="button"
            title={uiT("Cancel comment")}
            aria-label={uiT("Cancel comment")}
            onClick={onDismiss}
            className="grid size-5 shrink-0 place-items-center rounded text-content/45 hover:bg-content/6 hover:text-content"
          >
            <X className="size-3" />
          </Button>
        </div>
        <Textarea data-ui="textarea"
          autoFocus
          rows={3}
          {...form.register("comment")}
          aria-invalid={!!form.formState.errors.comment}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              comment.trim()
            ) {
              event.preventDefault();
              addToChat();
            }
          }}
          placeholder={uiT("Leave a comment…")}
          className="max-h-40 min-h-18 w-full resize-y rounded-lg border border-content/10 bg-background-base/70 px-2.5 py-2 text-[13px] leading-5 text-content outline-none focus-visible:focus-fill placeholder:text-content/35"
        />
        <FieldError errors={[form.formState.errors.comment]} />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[10px] text-content/35">
            {MOD}
            {uiT("↩ to add")}
          </span>
          <Button variant="primary" size="sm"
            type="submit"
            disabled={!comment.trim()}
            className="gap-1.5"
          >
            <MessageSquarePlus className="size-3.5" />
            {uiT("Add to chat")}
          </Button>
        </div>
      </form>
    </Popover>
  );
}
