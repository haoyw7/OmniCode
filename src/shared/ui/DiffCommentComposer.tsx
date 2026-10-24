import { useTranslation } from "../i18n/useTranslation";
import { useState } from "react";
import { MessageSquarePlus, X } from "./icons";
import { Popover, type PopoverAnchor } from "./Popover";

export function DiffCommentComposer({
  location,
  anchor,
  modifierLabel,
  onSubmit,
  onDismiss,
}: {
  location: string;
  anchor: PopoverAnchor;
  modifierLabel: string;
  onSubmit: (comment: string) => void;
  onDismiss: () => void;
}) {
  const { t: uiT } = useTranslation();
  const [comment, setComment] = useState("");
  const addToChat = () => {
    if (!comment.trim()) return;
    onSubmit(comment);
    onDismiss();
  };

  return (
    <Popover
      anchor={anchor}
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
        onSubmit={(event) => {
          event.preventDefault();
          addToChat();
        }}
      >
        <div className="mb-1.5 flex items-center gap-2 px-0.5">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-content/55"
            title={location}
          >
            {location}
          </span>
          <button
            type="button"
            title={uiT("Cancel comment")}
            aria-label={uiT("Cancel comment")}
            onClick={onDismiss}
            className="grid size-5 shrink-0 place-items-center rounded text-content/45 hover:bg-content/6 hover:text-content"
          >
            <X className="size-3" />
          </button>
        </div>
        <textarea data-ui="textarea"
          autoFocus
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
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
          className="max-h-40 min-h-18 w-full resize-y rounded-lg border border-content/10 bg-background-base/70 px-2.5 py-2 text-[13px] leading-5 text-content outline-none placeholder:text-content/35 focus:border-content/20"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[10px] text-content/35">
            {modifierLabel}
            {uiT("↩ to add")}
          </span>
          <button
            type="submit"
            disabled={!comment.trim()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-content px-2.5 text-[12px] font-medium text-background-base hover:opacity-80 disabled:cursor-default disabled:opacity-40"
          >
            <MessageSquarePlus className="size-3.5" />
            {uiT("Add to chat")}
          </button>
        </div>
      </form>
    </Popover>
  );
}
