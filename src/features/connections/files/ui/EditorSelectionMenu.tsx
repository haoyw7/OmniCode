import { Button } from "../../../../shared/ui/forms/Button";
import { PresenceBoundary } from "../../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { useEffect, useRef } from "react";
import { MessageSquarePlus } from "../../../../shared/ui/icons";
import { Popover } from "../../../../shared/ui/Popover";
import {
  formatEditorSelectionReference,
  type EditorCodeSelection,
} from "../model/editorSelection";
import { requestAddToChat } from "../../../sessions/model/quoteDraft";

export type EditorSelectionTarget = EditorCodeSelection & {
  anchor: DOMRect;
};

export function EditorSelectionMenu({
  selection,
  onDismiss,
}: {
  selection: EditorSelectionTarget | null;
  onDismiss: () => void;
}) {
  const { t: uiT } = useTranslation();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // A rect captured from CodeMirror is in viewport coordinates. Once the
  // editor moves, dismiss the action instead of leaving it over stale text.
  useEffect(() => {
    if (!selection) return;
    const dismiss = () => onDismissRef.current();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selection]);

  return (
    <PresenceBoundary propagate>{selection ? (
    <Popover
      anchor={selection.anchor}
      side="top"
      align="center"
      gap={6}
      onDismiss={onDismiss}
      role="toolbar"
      aria-label={uiT("Selected code actions")}
      className="p-1"
    >
      <Button variant="ghost" size="sm"
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          requestAddToChat(formatEditorSelectionReference(selection), "plain");
          onDismiss();
        }}
      >
        <MessageSquarePlus
          aria-hidden="true"
          className="size-3.5"
        />
        {uiT("Add to chat")}
      </Button>
    </Popover>
    ) : null}</PresenceBoundary>
  );
}
